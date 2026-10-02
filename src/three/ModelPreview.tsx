import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { Device, EquipmentModel } from '../lib/types';
import { expandPorts, layoutFace } from '../lib/ports';
import { RACK_INNER_W, U, type Placement } from '../lib/site';
import { DeviceUnit, type DeviceHandlers, type PortVisual } from './DeviceUnit';
import { SceneLights } from './RackScene';
import { SCENE_COLORS, useTheme } from '../lib/theme';
import { useFontsReady } from './textures';

const noop: DeviceHandlers = {
  portOver() {}, portOut() {}, portClick() {}, deviceOver() {}, deviceOut() {}, deviceClick() {},
};

/** A single model floating in space, with some ports lit so the LED look can be judged. */
export function ModelPreview({ model, deviceName, showLinks }: { model: EquipmentModel; deviceName: string; showLinks: boolean }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 30, near: 0.5, far: 1000, position: [0, 4, 40] }}>
      <PreviewContents model={model} deviceName={deviceName} showLinks={showLinks} />
    </Canvas>
  );
}

function PreviewContents({ model, deviceName, showLinks }: { model: EquipmentModel; deviceName: string; showLinks: boolean }) {
  const fontsReady = useFontsReady();
  const theme = useTheme();
  const desktop = model.formFactor !== 'rack';
  const width = desktop ? Math.min(RACK_INNER_W, model.widthIn) : RACK_INNER_W;
  const height = desktop ? model.rackUnits * U * 0.72 : model.rackUnits * U - 0.04;

  const placement: Placement = useMemo(() => {
    const device: Device = {
      propertyId: 'preview', id: 'preview', name: deviceName, type: model.category, groupName: '', location: '',
      status: 'confirmed', notes: '', model: '', modelId: model.id, rackId: null, rackU: 1, ip: '', mac: '',
    };
    return { device, model, x: 0, y0: 0, units: model.rackUnits, width, height, depth: model.depthIn, desktop };
  }, [model, deviceName, width, height, desktop]);

  const layout = useMemo(() => layoutFace(model, width, height), [model, width, height]);
  const ports = useMemo(() => {
    const m = new Map<string, PortVisual>();
    if (!showLinks) return m;
    expandPorts(model).forEach((p, i) => {
      if (i % 3 !== 2) m.set(p.key, { linked: true, poe: p.poe !== 'none' && i % 2 === 0 });
    });
    return m;
  }, [model, showLinks]);

  return (
    <>
      <color key={`bg-${theme}`} attach="background" args={[SCENE_COLORS[theme].bg]} />
      <SceneLights height={height} />
      <DeviceUnit
        placement={placement}
        layout={layout}
        centerY={0}
        frontZ={0}
        ports={ports}
        hoverKey={null}
        selectedKey={null}
        highlightKeys={null}
        hovered={false}
        selected={false}
        fontsReady={fontsReady}
        ears={!desktop}
        handlers={noop}
      />
      <Fit width={width + (desktop ? 0 : 1.5)} depth={model.depthIn} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={1.2} radius={0.65} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      </EffectComposer>
    </>
  );
}

function Fit({ width, depth }: { width: number; depth: number }) {
  const ref = useRef<CameraControls>(null);
  const size = useThree(s => s.size);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const t = Math.tan(THREE.MathUtils.degToRad(15));
    const aspect = size.width / Math.max(1, size.height);
    const d = (width + 3) / 2 / (t * aspect);
    const az = THREE.MathUtils.degToRad(18);
    void c.setLookAt(Math.sin(az) * d, d * 0.16, Math.cos(az) * d, 0, 0, -depth * 0.15, true);
  }, [width, depth, size.width, size.height]);
  return <CameraControls ref={ref} makeDefault minDistance={3} maxDistance={120} dollyToCursor smoothTime={0.3} />;
}
