import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { FaceLayout, PortSlot } from '../lib/ports';
import type { Placement } from '../lib/site';
import { makeFaceTexture } from './textures';
import { GEO, JACK, MAT } from './parts';

export interface PortVisual {
  linked: boolean;
  poe: boolean;
}

export interface DeviceHandlers {
  portOver(deviceId: string, key: string): void;
  portOut(deviceId: string, key: string): void;
  portClick(deviceId: string, key: string, e: ThreeEvent<MouseEvent>): void;
  deviceOver(deviceId: string): void;
  deviceOut(deviceId: string): void;
  deviceClick(deviceId: string, e: ThreeEvent<MouseEvent>): void;
}

export interface DeviceUnitProps {
  placement: Placement;
  layout: FaceLayout | null;
  centerY: number;
  frontZ: number;
  ports: Map<string, PortVisual>;
  hoverKey: string | null;
  selectedKey: string | null;
  highlightKeys: Set<string> | null;
  hovered: boolean;
  selected: boolean;
  fontsReady: boolean;
  ears: boolean;
  handlers: DeviceHandlers;
  accent?: string;
}

export const DeviceUnit = memo(function DeviceUnit(props: DeviceUnitProps) {
  const { placement: p, layout, centerY, frontZ, ports, hoverKey, selectedKey, highlightKeys, hovered, selected, fontsReady, ears, handlers } = props;
  const faceW = p.width;
  const faceH = p.height;
  const id = p.device.id;
  const patch = p.model?.category === 'patchpanel';

  const texture = useMemo(
    () => makeFaceTexture({ model: p.model, deviceName: p.device.name, faceW, faceH, layout }),
    // fontsReady isn't read, but the faceplate must redraw once the web fonts arrive
    [p.model, p.device.name, faceW, faceH, layout, fontsReady],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  const bodyMat = useMemo(() => {
    const c = new THREE.Color(p.model?.faceColor ?? '#3a3f46').multiplyScalar(0.7);
    return new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.45 });
  }, [p.model?.faceColor]);
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);
  const earMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: p.model?.faceColor ?? '#3a3f46', metalness: 0.55, roughness: 0.5 }),
    [p.model?.faceColor],
  );
  useEffect(() => () => earMat.dispose(), [earMat]);

  const deviceEvents = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); handlers.deviceOver(id); },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); handlers.deviceOver(id); },
    onPointerOut: () => handlers.deviceOut(id),
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); handlers.deviceClick(id, e); },
  };

  const screwYs = p.units >= 2 ? [faceH / 2 - 0.4, -faceH / 2 + 0.4] : [0];

  return (
    <group position={[p.x, centerY, frontZ]}>
      <mesh geometry={GEO.box()} material={bodyMat} scale={[faceW, faceH, p.depth]} position={[0, 0, -p.depth / 2]} {...deviceEvents}>
        {(hovered || selected) && <Edges color={props.accent ?? '#4fb4ff'} threshold={15} />}
      </mesh>
      <mesh geometry={GEO.plane()} scale={[faceW, faceH, 1]} position={[0, 0, 0.003]} {...deviceEvents}>
        <meshStandardMaterial map={texture} metalness={0.25} roughness={0.55} />
      </mesh>

      {ears && [-1, 1].map(s => (
        <group key={s} position={[s * (faceW / 2 + 0.38), 0, 0.03]}>
          <mesh geometry={GEO.box()} material={earMat} scale={[0.76, faceH, 0.06]} {...deviceEvents} />
          {screwYs.map(y => <mesh key={y} geometry={GEO.screw()} material={MAT.screw} position={[s * 0.05, y, 0.05]} />)}
        </group>
      ))}

      {!patch && p.model && (
        <mesh geometry={GEO.powerLed()} material={MAT.ledPower} position={[-faceW / 2 + 0.16, -faceH / 2 + 0.16, 0.015]} />
      )}

      {layout?.slots.map(slot => (
        <PortJack
          key={slot.groupId + slot.key}
          slot={slot}
          visual={ports.get(slot.key)}
          patch={patch}
          lit={hoverKey === slot.key || selectedKey === slot.key || !!highlightKeys?.has(slot.key)}
          deviceId={id}
          handlers={handlers}
        />
      ))}
    </group>
  );
});

interface PortJackProps {
  slot: PortSlot;
  visual: PortVisual | undefined;
  patch: boolean;
  lit: boolean;
  deviceId: string;
  handlers: DeviceHandlers;
}

const PortJack = memo(function PortJack({ slot, visual, patch, lit, deviceId, handlers }: PortJackProps) {
  const d = JACK[slot.kind];
  const s = slot.w / d.w;
  const frameMat = patch ? MAT.keystone : slot.kind === 'rj45' ? MAT.rj45Frame : MAT.sfpCage;
  const rimMat = lit ? MAT.rimHover : patch && visual?.linked ? MAT.rimLink : null;
  const ledMat = (i: number) => {
    if (i === 0) return visual?.linked ? MAT.ledLink : MAT.ledOff;
    return visual?.poe ? MAT.ledPoe : MAT.ledOff;
  };
  return (
    <group
      position={[slot.x, slot.y, 0.003]}
      scale={[s, slot.flip ? -s : s, s]}
      onPointerOver={e => { e.stopPropagation(); handlers.portOver(deviceId, slot.key); }}
      onPointerMove={e => { e.stopPropagation(); handlers.portOver(deviceId, slot.key); }}
      onPointerOut={() => handlers.portOut(deviceId, slot.key)}
      onClick={e => { e.stopPropagation(); handlers.portClick(deviceId, slot.key, e); }}
    >
      <mesh geometry={GEO.frame(slot.kind)} material={frameMat} />
      <mesh geometry={GEO.inside(slot.kind)} material={MAT.jackInside} position={[0, 0, 0.004]} />
      {slot.kind === 'rj45' && <mesh geometry={GEO.pins()} material={MAT.pins} position={[0, 0, 0.006]} />}
      {!patch && d.led.xs.map((x, i) => (
        <mesh key={i} geometry={GEO.led()} material={ledMat(i)} position={[x, d.led.y, d.depth + 0.006]} />
      ))}
      {rimMat && <mesh geometry={GEO.rim(slot.kind)} material={rimMat} position={[0, 0, 0.002]} />}
    </group>
  );
});
