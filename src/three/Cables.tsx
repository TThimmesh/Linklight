import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { PortKind } from '../lib/types';
import { GEO, MAT } from './parts';

export interface CableEnd {
  /** Port face center in world space. */
  pos: THREE.Vector3;
  kind: PortKind;
  /** Plug is mirrored on bottom-row ports. */
  flip: boolean;
  scale: number;
}

export interface CableSpec {
  id: string;
  linkId: string;
  color: string;
  a: CableEnd;
  /** Second end in this rack, or null for a run that leaves the rack. */
  b: CableEnd | null;
  /** Which side of the rack a leaving run is dressed to. */
  side: 1 | -1;
  floorY: number;
}

function plugTip(e: CableEnd): THREE.Vector3 {
  const len = e.kind === 'rj45' ? 0.7 : 0.45;
  return e.pos.clone().add(new THREE.Vector3(0, 0, len * e.scale));
}

function cableCurve(c: CableSpec): THREE.Curve<THREE.Vector3> {
  const A = plugTip(c.a);
  if (c.b) {
    const B = plugTip(c.b);
    const d = A.distanceTo(B);
    const bulge = THREE.MathUtils.clamp(1.4 + d * 0.2, 1.6, 7);
    const sag = Math.min(2.4, 0.5 + d * 0.06);
    return new THREE.CubicBezierCurve3(
      A,
      A.clone().add(new THREE.Vector3(0, -sag * 0.4, bulge)),
      B.clone().add(new THREE.Vector3(0, -sag * 0.4, bulge)),
      B,
    );
  }
  const s = c.side;
  const edge = 10.5;
  const pts = [
    A,
    A.clone().add(new THREE.Vector3(0, -0.12, 0.9)),
    new THREE.Vector3(A.x + (s * edge - A.x) * 0.55, A.y - 0.7, 1.9),
    new THREE.Vector3(s * edge, A.y - 2.6, 1.0),
    new THREE.Vector3(s * (edge + 0.4), Math.max(c.floorY + 1, A.y - 9), -2),
  ];
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

interface CablesProps {
  cables: CableSpec[];
  highlightLinkId: string | null;
  onOver(linkId: string): void;
  onOut(linkId: string): void;
  onClick(linkId: string, e: ThreeEvent<MouseEvent>): void;
}

export const Cables = memo(function Cables({ cables, highlightLinkId, onOver, onOut, onClick }: CablesProps) {
  return (
    <group>
      {cables.map(c => (
        <Cable
          key={c.id}
          spec={c}
          lit={highlightLinkId === c.linkId}
          onOver={onOver}
          onOut={onOut}
          onClick={onClick}
        />
      ))}
    </group>
  );
});

const Cable = memo(function Cable({ spec, lit, onOver, onOut, onClick }: {
  spec: CableSpec; lit: boolean;
  onOver(linkId: string): void; onOut(linkId: string): void; onClick(linkId: string, e: ThreeEvent<MouseEvent>): void;
}) {
  const geometry = useMemo(() => {
    const fiber = spec.a.kind !== 'rj45';
    return new THREE.TubeGeometry(cableCurve(spec), spec.b ? 48 : 36, fiber ? 0.07 : 0.11, 8, false);
  }, [spec]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: spec.color, roughness: 0.55, metalness: 0.05,
    emissive: new THREE.Color(spec.color), emissiveIntensity: 0,
  }), [spec.color]);
  useEffect(() => () => material.dispose(), [material]);
  material.emissiveIntensity = lit ? 0.9 : 0;

  const events = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onOver(spec.linkId); },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onOver(spec.linkId); },
    onPointerOut: () => onOut(spec.linkId),
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(spec.linkId, e); },
  };

  return (
    <group>
      <mesh geometry={geometry} material={material} {...events} />
      <Plug end={spec.a} material={material} events={events} />
      {spec.b && <Plug end={spec.b} material={material} events={events} />}
    </group>
  );
});

function Plug({ end, material, events }: { end: CableEnd; material: THREE.Material; events: Record<string, unknown> }) {
  const s = end.scale;
  if (end.kind === 'rj45') {
    return (
      <group position={end.pos} scale={[s, end.flip ? -s : s, s]}>
        <mesh geometry={GEO.plug()} material={material} {...events} />
      </group>
    );
  }
  return (
    <group position={end.pos} scale={[s, end.flip ? -s : s, s]}>
      <mesh geometry={GEO.sfpModule()} material={MAT.sfpModule} {...events} />
    </group>
  );
}
