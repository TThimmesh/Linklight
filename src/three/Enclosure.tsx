import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { RackKind } from '../lib/types';
import { RAIL_W, U } from '../lib/site';
import { GEO, MAT } from './parts';
import { makeRailTexture } from './textures';

// Coordinates: inches. x = 0 at rack center, y = 0 at the bottom of U1,
// z = 0 at the front mounting rails (gear faces sit just in front of z = 0).

export interface EnclosureMetrics {
  /** Usable height (units × 1.75). */
  h: number;
  /** World y of the floor (or of the wall bottom, for wall-mounted kinds). */
  floorY: number;
  /** Overall top of the enclosure. */
  topY: number;
  backZ: number;
  outerW: number;
  wallMounted: boolean;
}

export function enclosureMetrics(kind: RackKind, units: number, maxDepth: number): EnclosureMetrics {
  const h = units * U;
  switch (kind) {
    case 'floor': return { h, floorY: -4, topY: h + 2.4, backZ: -30, outerW: 23.6, wallMounted: false };
    case 'wall': return { h, floorY: -1.6, topY: h + 1.6, backZ: -Math.max(16, maxDepth + 2), outerW: 23.6, wallMounted: true };
    case 'open': return { h, floorY: -1.2, topY: h + 1.6, backZ: -15, outerW: 20.6, wallMounted: false };
    case 'shelf': return { h, floorY: -1, topY: h + 1, backZ: -(Math.max(10, maxDepth) + 1.2), outerW: 26, wallMounted: true };
  }
}

function Box({ size, pos, mat }: { size: [number, number, number]; pos: [number, number, number]; mat: THREE.Material }) {
  return <mesh geometry={GEO.box()} material={mat} scale={size} position={pos} />;
}

function Rails({ units, z = 0 }: { units: number; z?: number }) {
  const h = units * U;
  const left = useMemo(() => makeRailTexture(units, 'left'), [units]);
  const right = useMemo(() => makeRailTexture(units, 'right'), [units]);
  useEffect(() => () => { left.dispose(); right.dispose(); }, [left, right]);
  const x = RAIL_W / 2 - 0.35;
  return (
    <group position={[0, 0, z]}>
      {([[-x, left], [x, right]] as const).map(([rx, tex]) => (
        <group key={rx} position={[rx, h / 2, 0]}>
          <Box size={[0.7, h, 0.12]} pos={[0, 0, -0.07]} mat={MAT.rail} />
          <mesh geometry={GEO.plane()} scale={[0.7, h, 1]} position={[0, 0, -0.005]}>
            <meshStandardMaterial map={tex} metalness={0.7} roughness={0.45} />
          </mesh>
          {/* return flange back toward the frame */}
          <Box size={[0.12, h, 1.2]} pos={[Math.sign(rx) * 0.35, 0, -0.7]} mat={MAT.rail} />
        </group>
      ))}
    </group>
  );
}

function FloorRack({ units }: { units: number }) {
  const m = enclosureMetrics('floor', units, 0);
  const H = m.topY - m.floorY;
  const cy = (m.topY + m.floorY) / 2;
  const depth = 3 - m.backZ;
  const cz = (3 + m.backZ) / 2;
  const hw = m.outerW / 2;
  return (
    <group>
      {/* corner posts */}
      {[-1, 1].flatMap(sx => [2.4, m.backZ + 0.6].map(z => (
        <Box key={`${sx}${z}`} size={[1.2, H, 1.2]} pos={[sx * (hw - 0.6), cy, z]} mat={MAT.frame} />
      )))}
      {/* top + plinth */}
      <Box size={[m.outerW, 1.2, depth]} pos={[0, m.topY - 0.6, cz]} mat={MAT.frame} />
      <Box size={[m.outerW - 0.4, 3.6, depth - 0.4]} pos={[0, m.floorY + 1.8, cz]} mat={MAT.panel} />
      {/* side panels */}
      {[-1, 1].map(sx => (
        <Box key={sx} size={[0.25, H - 1.4, depth - 2.6]} pos={[sx * (hw - 0.15), cy, cz]} mat={MAT.panel} />
      ))}
      {/* rear door */}
      <Box size={[m.outerW - 2.4, H - 1.4, 0.3]} pos={[0, cy, m.backZ + 0.3]} mat={MAT.panel} />
      {/* rail-to-post brackets */}
      {[0.6, m.h - 0.6].map(y => [-1, 1].map(sx => (
        <Box key={`${y}${sx}`} size={[2.2, 0.6, 0.15]} pos={[sx * (RAIL_W / 2 + 1.1), y, -0.4]} mat={MAT.rail} />
      )))}
      <Rails units={units} />
      {/* rear rails */}
      {[-1, 1].map(sx => (
        <Box key={sx} size={[0.7, m.h, 0.12]} pos={[sx * (RAIL_W / 2 - 0.35), m.h / 2, m.backZ + 5]} mat={MAT.rail} />
      ))}
    </group>
  );
}

function WallCabinet({ units, maxDepth }: { units: number; maxDepth: number }) {
  const m = enclosureMetrics('wall', units, maxDepth);
  const H = m.topY - m.floorY;
  const cy = (m.topY + m.floorY) / 2;
  const frontZ = 2.6;
  const depth = frontZ - m.backZ;
  const cz = (frontZ + m.backZ) / 2;
  const hw = m.outerW / 2;
  const t = 0.4;
  const doorW = m.outerW - 0.2;
  return (
    <group>
      <Box size={[m.outerW, t, depth]} pos={[0, m.topY - t / 2, cz]} mat={MAT.frame} />
      <Box size={[m.outerW, t, depth]} pos={[0, m.floorY + t / 2, cz]} mat={MAT.frame} />
      {[-1, 1].map(sx => <Box key={sx} size={[t, H, depth]} pos={[sx * (hw - t / 2), cy, cz]} mat={MAT.panel} />)}
      <Box size={[m.outerW, H, t]} pos={[0, cy, m.backZ + t / 2]} mat={MAT.panel} />
      {/* front frame lip */}
      {[-1, 1].map(sx => <Box key={sx} size={[1.6, H, 0.3]} pos={[sx * (hw - 0.8), cy, frontZ - 0.15]} mat={MAT.frame} />)}
      <Rails units={units} />
      {/* glass door, hinged on the left and swung open */}
      <group position={[-hw, cy, frontZ]} rotation={[0, -1.95, 0]}>
        <mesh geometry={GEO.box()} material={MAT.glass} scale={[doorW - 1.2, H - 1.2, 0.12]} position={[doorW / 2, 0, 0.1]} raycast={() => null} />
        {[[doorW / 2, H / 2 - 0.3, doorW, 0.6], [doorW / 2, -H / 2 + 0.3, doorW, 0.6], [0.3, 0, 0.6, H], [doorW - 0.3, 0, 0.6, H]].map(([x, y, w, h], i) => (
          <mesh key={i} geometry={GEO.box()} material={MAT.frame} scale={[w, h, 0.3]} position={[x, y, 0.1]} raycast={() => null} />
        ))}
        <mesh geometry={GEO.box()} material={MAT.screw} scale={[0.35, 2.4, 0.4]} position={[doorW - 0.9, 0, 0.35]} raycast={() => null} />
      </group>
    </group>
  );
}

function OpenFrame({ units }: { units: number }) {
  const m = enclosureMetrics('open', units, 0);
  const H = m.topY - m.floorY;
  const cy = (m.topY + m.floorY) / 2;
  const px = RAIL_W / 2 + 0.55;
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx}>
          <Box size={[1.1, H, 3]} pos={[sx * px, cy, -1.5]} mat={MAT.frame} />
          <Box size={[3, 1.2, 16]} pos={[sx * px, m.floorY + 0.6, -1.5]} mat={MAT.frame} />
        </group>
      ))}
      <Box size={[px * 2 + 1.1, 1.1, 3]} pos={[0, m.topY - 0.55, -1.5]} mat={MAT.frame} />
      <Rails units={units} />
    </group>
  );
}

function ShelfBoard({ units, maxDepth }: { units: number; maxDepth: number }) {
  const m = enclosureMetrics('shelf', units, maxDepth);
  const H = m.topY - m.floorY + 4;
  return (
    <group>
      <Box size={[m.outerW + 6, H, 0.75]} pos={[0, (m.topY + m.floorY) / 2 + 1, m.backZ - 0.375]} mat={MAT.plywood} />
    </group>
  );
}

/** Shelf boards (shelf kind) or rack-mount trays (other kinds) under the given U bottoms. */
export function Trays({ kind, units, maxDepth, bottoms }: { kind: RackKind; units: number; maxDepth: number; bottoms: number[] }) {
  if (kind === 'shelf') {
    const m = enclosureMetrics('shelf', units, maxDepth);
    const depth = -m.backZ + 1;
    const ys = [...new Set([0, ...bottoms])];
    return (
      <group>
        {ys.map(y => (
          <group key={y}>
            <Box size={[m.outerW, 0.75, depth]} pos={[0, y - 0.375, m.backZ + depth / 2]} mat={MAT.wood} />
            {[-1, 1].map(sx => (
              <Box key={sx} size={[0.4, 3, 0.4]} pos={[sx * (m.outerW / 2 - 2), y - 2.2, m.backZ + 0.2]} mat={MAT.tray} />
            ))}
          </group>
        ))}
      </group>
    );
  }
  return (
    <group>
      {bottoms.map(y => (
        <group key={y}>
          <Box size={[RAIL_W - 1.4, 0.1, 14]} pos={[0, y + 0.05, -7]} mat={MAT.tray} />
          <Box size={[RAIL_W - 1.4, 0.45, 0.08]} pos={[0, y + 0.22, 0.02]} mat={MAT.tray} />
          {[-1, 1].map(sx => <Box key={sx} size={[0.75, U - 0.06, 0.08]} pos={[sx * (RAIL_W / 2 - 0.37), y + U / 2, 0.03]} mat={MAT.tray} />)}
        </group>
      ))}
    </group>
  );
}

export function Enclosure({ kind, units, maxDepth }: { kind: RackKind; units: number; maxDepth: number }) {
  switch (kind) {
    case 'floor': return <FloorRack units={units} />;
    case 'wall': return <WallCabinet units={units} maxDepth={maxDepth} />;
    case 'open': return <OpenFrame units={units} />;
    case 'shelf': return <ShelfBoard units={units} maxDepth={maxDepth} />;
  }
}
