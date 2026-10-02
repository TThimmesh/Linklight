import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, Environment, Grid, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { Link, Rack } from '../lib/types';
import { CABLE_HEX, DEFAULT_CABLE_HEX } from '../lib/types';
import { layoutFace, type FaceLayout } from '../lib/ports';
import { U, emptyUnits, portId, type Placement, type SiteIndex } from '../lib/site';
import { hoverStore, pointerStore, setHover, useStore, type HoverTarget } from '../lib/hooks';
import { SCENE_COLORS, type Theme } from '../lib/theme';
import { DeviceUnit, type DeviceHandlers, type PortVisual } from './DeviceUnit';
import { Enclosure, Trays, enclosureMetrics, type EnclosureMetrics } from './Enclosure';
import { Cables, type CableEnd, type CableSpec } from './Cables';
import { GEO, JACK, MAT } from './parts';
import { useFontsReady } from './textures';

export type Selection =
  | { type: 'device'; deviceId: string }
  | { type: 'port'; deviceId: string; key: string }
  | { type: 'link'; linkId: string };

export interface CameraApi {
  front(): void;
  angle(): void;
  focusDevice(deviceId: string): void;
}

interface Face {
  placement: Placement;
  layout: FaceLayout | null;
  centerY: number;
  frontZ: number;
}

const FOV = 35;
const CLICK_SLOP = 5;

export interface RackSceneProps {
  rack: Rack;
  placements: Placement[];
  links: Link[];
  idx: SiteIndex;
  selection: Selection | null;
  onSelect(sel: Selection | null): void;
  onEmptySlot(u: number): void;
  cameraRef: MutableRefObject<CameraApi | null>;
  theme: Theme;
}

export function RackScene(props: RackSceneProps) {
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // cursor follows whatever is hovered
  useEffect(() => hoverStore.subscribe(() => {
    if (wrap.current) wrap.current.style.cursor = hoverStore.get() ? 'pointer' : 'grab';
  }), []);

  return (
    <div
      ref={wrap}
      className="scene-wrap"
      onPointerMove={e => pointerStore.set({ x: e.clientX, y: e.clientY })}
      onPointerDown={e => { downAt.current = { x: e.clientX, y: e.clientY }; }}
      onPointerLeave={() => setHover(null)}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: FOV, near: 1, far: 3000, position: [40, 50, 120] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={e => {
          const d = downAt.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
          props.onSelect(null);
        }}
      >
        <SceneContents {...props} />
      </Canvas>
    </div>
  );
}

function SceneContents({ rack, placements, links, idx, selection, onSelect, onEmptySlot, cameraRef, theme }: RackSceneProps) {
  const colors = SCENE_COLORS[theme];
  const fontsReady = useFontsReady();
  const hover = useStore(hoverStore);

  const maxDepth = useMemo(() => placements.reduce((m, p) => Math.max(m, p.depth), 10), [placements]);
  const metrics = useMemo(() => enclosureMetrics(rack.kind, rack.units, maxDepth), [rack.kind, rack.units, maxDepth]);

  const faces: Face[] = useMemo(() => placements.map(p => {
    const layout = p.model ? layoutFace(p.model, p.width, p.height) : null;
    const centerY = p.desktop ? p.y0 + 0.1 + p.height / 2 : p.y0 + (p.units * U) / 2;
    const frontZ = p.desktop ? -0.45 : 0.06;
    return { placement: p, layout, centerY, frontZ };
  }), [placements]);

  const faceById = useMemo(() => new Map(faces.map(f => [f.placement.device.id, f])), [faces]);

  const portVisuals = useMemo(() => {
    const out = new Map<string, Map<string, PortVisual>>();
    for (const f of faces) {
      const m = new Map<string, PortVisual>();
      for (const s of f.layout?.slots ?? []) {
        const conns = idx.connsByPort.get(portId(f.placement.device.id, s.key));
        if (!conns?.length) continue;
        m.set(s.key, { linked: true, poe: s.poe !== 'none' && conns.some(c => c.link.poe) });
      }
      out.set(f.placement.device.id, m);
    }
    return out;
  }, [faces, idx]);

  const cables: CableSpec[] = useMemo(() => {
    const endFor = (deviceId: string, key: string): CableEnd | null => {
      const f = faceById.get(deviceId);
      const slot = f?.layout?.slots.find(s => s.key === key);
      if (!f || !slot) return null;
      return {
        pos: new THREE.Vector3(f.placement.x + slot.x, f.centerY + slot.y, f.frontZ + 0.006),
        kind: slot.kind,
        flip: slot.flip,
        scale: slot.w / JACK[slot.kind].w,
      };
    };
    const out: CableSpec[] = [];
    for (const l of links) {
      const k = idx.linkKeys.get(l.id);
      if (!k) continue;
      const fromEnds = faceById.has(l.fromDevice) ? k.from.map(key => endFor(l.fromDevice, key)).filter((e): e is CableEnd => !!e) : [];
      const toEnds = l.toDevice && faceById.has(l.toDevice) ? k.to.map(key => endFor(l.toDevice!, key)).filter((e): e is CableEnd => !!e) : [];
      if (!fromEnds.length && !toEnds.length) continue;
      const fiber = [...fromEnds, ...toEnds].some(e => e.kind !== 'rj45');
      const color = CABLE_HEX[l.cableColor] ?? (fiber ? '#22c3d6' : DEFAULT_CABLE_HEX);
      if (fromEnds.length === 1 && toEnds.length === 1) {
        out.push({ id: `${l.id}`, linkId: l.id, color, a: fromEnds[0], b: toEnds[0], side: 1, floorY: metrics.floorY });
      } else {
        [...fromEnds, ...toEnds].forEach((e, i) => out.push({
          id: `${l.id}#${i}`, linkId: l.id, color, a: e, b: null, side: e.pos.x >= 0 ? 1 : -1, floorY: metrics.floorY,
        }));
      }
    }
    return out;
  }, [links, idx, faceById, metrics.floorY]);

  const empties = useMemo(() => emptyUnits(rack, placements), [rack, placements]);
  const trayBottoms = useMemo(() => {
    const ys = new Set<number>();
    for (const p of placements) if (p.desktop || rack.kind === 'shelf') ys.add(p.y0);
    return [...ys];
  }, [placements, rack.kind]);

  // ---- hover / selection derived per device ----
  const highlightLinkId = hover?.type === 'link' ? hover.linkId : selection?.type === 'link' ? selection.linkId : null;
  const highlightByDevice = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!highlightLinkId) return m;
    const l = links.find(x => x.id === highlightLinkId);
    const k = idx.linkKeys.get(highlightLinkId);
    if (!l || !k) return m;
    m.set(l.fromDevice, new Set(k.from));
    if (l.toDevice) {
      const set = m.get(l.toDevice) ?? new Set<string>();
      k.to.forEach(x => set.add(x));
      m.set(l.toDevice, set);
    }
    return m;
  }, [highlightLinkId, links, idx]);

  const clickOk = (e: ThreeEvent<MouseEvent>) => e.delta <= CLICK_SLOP;
  const handlers: DeviceHandlers = useMemo(() => ({
    portOver: (deviceId, key) => setHover({ type: 'port', deviceId, key }),
    portOut: (deviceId, key) => {
      const h = hoverStore.get();
      if (h?.type === 'port' && h.deviceId === deviceId && h.key === key) setHover(null);
    },
    portClick: (deviceId, key, e) => { if (clickOk(e)) onSelect({ type: 'port', deviceId, key }); },
    deviceOver: deviceId => setHover({ type: 'device', deviceId }),
    deviceOut: deviceId => {
      const h = hoverStore.get();
      if (h?.type === 'device' && h.deviceId === deviceId) setHover(null);
    },
    deviceClick: (deviceId, e) => { if (clickOk(e)) onSelect({ type: 'device', deviceId }); },
  }), [onSelect]);

  const cableOver = useCallback((linkId: string) => setHover({ type: 'link', linkId }), []);
  const cableOut = useCallback((linkId: string) => {
    const h = hoverStore.get();
    if (h?.type === 'link' && h.linkId === linkId) setHover(null);
  }, []);
  const cableClick = useCallback((linkId: string, e: ThreeEvent<MouseEvent>) => {
    if (clickOk(e)) onSelect({ type: 'link', linkId });
  }, [onSelect]);

  return (
    <>
      <color key={`bg-${theme}`} attach="background" args={[colors.bg]} />
      <fog key={`fog-${theme}`} attach="fog" args={[colors.bg, 220, 520]} />
      <SceneLights height={metrics.h} />

      <Surroundings rack={rack} metrics={metrics} colors={colors} />
      <Enclosure kind={rack.kind} units={rack.units} maxDepth={maxDepth} />
      <Trays kind={rack.kind} units={rack.units} maxDepth={maxDepth} bottoms={trayBottoms} />

      {faces.map(f => {
        const id = f.placement.device.id;
        return (
          <DeviceUnit
            key={id}
            placement={f.placement}
            layout={f.layout}
            centerY={f.centerY}
            frontZ={f.frontZ}
            ports={portVisuals.get(id)!}
            hoverKey={hover?.type === 'port' && hover.deviceId === id ? hover.key : null}
            selectedKey={selection?.type === 'port' && selection.deviceId === id ? selection.key : null}
            highlightKeys={highlightByDevice.get(id) ?? null}
            hovered={hover?.type === 'device' && hover.deviceId === id}
            selected={selection?.type === 'device' && selection.deviceId === id}
            fontsReady={fontsReady}
            ears={!f.placement.desktop}
            handlers={handlers}
          />
        );
      })}

      <Cables cables={cables} highlightLinkId={highlightLinkId} onOver={cableOver} onOut={cableOut} onClick={cableClick} />

      {empties.map(u => (
        <EmptySlot key={u} u={u} hovered={hover?.type === 'slot' && hover.u === u} onClick={onEmptySlot} />
      ))}

      <CameraRig apiRef={cameraRef} metrics={metrics} rackKey={`${rack.id}:${rack.kind}:${rack.units}`} faceById={faceById} />

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={1.25} radius={0.7} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      </EffectComposer>
    </>
  );
}

/** Shared by the rack scene and the library preview. */
export function SceneLights({ height }: { height: number }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#c4d2e4', '#1c222a', 0.7]} />
      <directionalLight position={[30, 90, 70]} intensity={2.4} />
      <directionalLight position={[-60, 30, 50]} intensity={0.8} color="#b4c8ff" />
      <directionalLight position={[0, 40, -80]} intensity={0.45} color="#7aa2d6" />
      {/* soft "work light" in front of the rack so gear inside cabinets isn't lost in shadow */}
      <pointLight position={[0, height + 6, 30]} intensity={0.55} decay={0} />
      <Environment resolution={256} environmentIntensity={1.4}>
        <color attach="background" args={['#1b222b']} />
        <Lightformer form="rect" intensity={3} position={[0, 60, 50]} scale={[90, 24, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[-70, 20, 10]} rotation-y={Math.PI / 2} scale={[50, 40, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[70, 20, 10]} rotation-y={-Math.PI / 2} scale={[50, 40, 1]} />
        <Lightformer form="ring" intensity={1.6} color="#9cc8ff" position={[0, 10, 80]} scale={20} />
      </Environment>
    </>
  );
}

function EmptySlot({ u, hovered, onClick }: { u: number; hovered: boolean; onClick(u: number): void }) {
  const target: HoverTarget = { type: 'slot', u };
  return (
    <mesh
      geometry={GEO.box()}
      material={hovered ? MAT.slotHover : MAT.slot}
      scale={[17.4, U - 0.08, 0.3]}
      position={[0, (u - 1) * U + U / 2, -0.2]}
      onPointerOver={e => { e.stopPropagation(); setHover(target); }}
      onPointerMove={e => { e.stopPropagation(); setHover(target); }}
      onPointerOut={() => { const h = hoverStore.get(); if (h?.type === 'slot' && h.u === u) setHover(null); }}
      onClick={e => { e.stopPropagation(); if (e.delta <= CLICK_SLOP) onClick(u); }}
    />
  );
}

function Surroundings({ rack, metrics, colors }: { rack: Rack; metrics: EnclosureMetrics; colors: (typeof SCENE_COLORS)[Theme] }) {
  if (metrics.wallMounted) {
    return (
      <group>
        <mesh position={[0, metrics.h / 2, metrics.backZ - 1]} receiveShadow>
          <planeGeometry args={[600, 400]} />
          <meshStandardMaterial color={colors.wall} roughness={0.92} />
        </mesh>
        {rack.kind === 'wall' && (
          <mesh position={[0, metrics.h / 2, metrics.backZ - 0.9]}>
            <planeGeometry args={[40, metrics.h + 22]} />
            <meshStandardMaterial color="#6e5b47" roughness={0.88} />
          </mesh>
        )}
      </group>
    );
  }
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, metrics.floorY - 0.02, 0]}>
        <planeGeometry args={[1200, 1200]} />
        <meshStandardMaterial color={colors.floor} roughness={0.95} />
      </mesh>
      <Grid
        position={[0, metrics.floorY, 0]}
        args={[600, 600]}
        cellSize={6}
        cellThickness={0.6}
        cellColor={colors.cell}
        sectionSize={24}
        sectionThickness={1}
        sectionColor={colors.section}
        fadeDistance={320}
        fadeStrength={1.6}
        infiniteGrid
      />
    </group>
  );
}

function CameraRig({ apiRef, metrics, rackKey, faceById }: {
  apiRef: MutableRefObject<CameraApi | null>;
  metrics: EnclosureMetrics;
  rackKey: string;
  faceById: Map<string, Face>;
}) {
  const ref = useRef<CameraControls>(null);
  const size = useThree(s => s.size);
  const faces = useRef(faceById);
  faces.current = faceById;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const aspect = size.width / Math.max(1, size.height);
    const cy = (metrics.topY + metrics.floorY) / 2;
    const fullH = metrics.topY - metrics.floorY + 10;
    const dist = Math.max(fullH / 2 / t, (metrics.outerW + 14) / 2 / (t * aspect));

    const api: CameraApi = {
      front: () => { void c.setLookAt(0, cy, dist, 0, cy, 0, true); },
      angle: () => {
        const az = THREE.MathUtils.degToRad(30);
        const el = THREE.MathUtils.degToRad(11);
        const d = dist * 1.05;
        void c.setLookAt(Math.sin(az) * Math.cos(el) * d, cy + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d, 0, cy, -4, true);
      },
      focusDevice: (deviceId: string) => {
        const f = faces.current.get(deviceId);
        if (!f) return;
        const p = f.placement;
        const dW = (p.width + 3) / 2 / (t * aspect);
        const dH = (p.height * 5) / 2 / t;
        const d = Math.max(dW, dH, 14);
        void c.setLookAt(p.x, f.centerY + d * 0.1, f.frontZ + d, p.x, f.centerY, f.frontZ, true);
      },
    };
    apiRef.current = api;
    // initial framing: snap without animating
    const az = THREE.MathUtils.degToRad(30);
    const el = THREE.MathUtils.degToRad(11);
    const d = dist * 1.05;
    void c.setLookAt(Math.sin(az) * Math.cos(el) * d, cy + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d, 0, cy, -4, false);
    // re-frame only when the rack itself changes, not on every edit
  }, [rackKey]);

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={6}
      maxDistance={480}
      smoothTime={0.32}
      dollyToCursor
      maxPolarAngle={Math.PI * 0.62}
    />
  );
}
