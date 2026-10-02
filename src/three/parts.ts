import * as THREE from 'three';
import type { PortKind } from '../lib/types';

// Shared geometry/materials for every port in the scene. Ports are built at
// their real size in inches and scaled per device by the faceplate layout.

// Colors above 1.0 with toneMapped off are what the bloom pass turns into glow.
export const GLOW = {
  link: new THREE.Color(0.25, 3.4, 0.6),
  poe: new THREE.Color(3.4, 1.55, 0.12),
  power: new THREE.Color(0.3, 2.2, 0.55),
  hover: new THREE.Color(0.45, 1.6, 3.6),
};

const basic = (c: THREE.Color) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });

export const MAT = {
  ledOff: new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.35, metalness: 0.1 }),
  ledLink: basic(GLOW.link),
  ledPoe: basic(GLOW.poe),
  ledPower: basic(GLOW.power),
  rimHover: basic(GLOW.hover),
  rimLink: basic(GLOW.link),
  jackInside: new THREE.MeshStandardMaterial({ color: '#030304', roughness: 1, metalness: 0 }),
  pins: new THREE.MeshStandardMaterial({ color: '#b08d3c', roughness: 0.35, metalness: 0.9 }),
  rj45Frame: new THREE.MeshStandardMaterial({ color: '#8d949d', roughness: 0.32, metalness: 0.85 }),
  keystone: new THREE.MeshStandardMaterial({ color: '#111316', roughness: 0.55, metalness: 0.1 }),
  sfpCage: new THREE.MeshStandardMaterial({ color: '#b5bcc4', roughness: 0.28, metalness: 0.95 }),
  screw: new THREE.MeshStandardMaterial({ color: '#a7adb5', roughness: 0.3, metalness: 0.95 }),
  sfpModule: new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.25, metalness: 0.95 }),
  rail: new THREE.MeshStandardMaterial({ color: '#4a5059', roughness: 0.45, metalness: 0.75 }),
  frame: new THREE.MeshStandardMaterial({ color: '#232a33', roughness: 0.5, metalness: 0.55 }),
  panel: new THREE.MeshStandardMaterial({ color: '#1d242d', roughness: 0.6, metalness: 0.4 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7a6047', roughness: 0.8, metalness: 0 }),
  plywood: new THREE.MeshStandardMaterial({ color: '#8c7458', roughness: 0.88, metalness: 0 }),
  tray: new THREE.MeshStandardMaterial({ color: '#23282f', roughness: 0.5, metalness: 0.7 }),
  glass: new THREE.MeshStandardMaterial({
    color: '#a9c1d6', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false,
  }),
  slot: new THREE.MeshBasicMaterial({ color: '#4fb4ff', transparent: true, opacity: 0, depthWrite: false }),
  slotHover: new THREE.MeshBasicMaterial({ color: '#4fb4ff', transparent: true, opacity: 0.16, depthWrite: false }),
};

export interface JackDims {
  w: number;
  h: number;
  depth: number;
  /** Hole bounds (excluding the latch notch). */
  hole: { x0: number; x1: number; y0: number; y1: number };
  led: { y: number; xs: number[] };
}

export const JACK: Record<PortKind, JackDims> = {
  rj45: {
    w: 0.5, h: 0.44, depth: 0.09,
    hole: { x0: -0.2, x1: 0.2, y0: -0.1, y1: 0.14 },
    led: { y: 0.181, xs: [-0.15, 0.15] },
  },
  sfp: {
    w: 0.6, h: 0.4, depth: 0.12,
    hole: { x0: -0.26, x1: 0.26, y0: -0.15, y1: 0.11 },
    led: { y: 0.155, xs: [0] },
  },
  'sfp+': {
    w: 0.6, h: 0.4, depth: 0.12,
    hole: { x0: -0.26, x1: 0.26, y0: -0.15, y1: 0.11 },
    led: { y: 0.155, xs: [0] },
  },
};

function frameShape(kind: PortKind, grow = 0): THREE.Shape {
  const d = JACK[kind];
  const s = new THREE.Shape();
  const hw = d.w / 2 + grow, hh = d.h / 2 + grow;
  s.moveTo(-hw, -hh);
  s.lineTo(hw, -hh);
  s.lineTo(hw, hh);
  s.lineTo(-hw, hh);
  s.lineTo(-hw, -hh);
  const { x0, x1, y0, y1 } = d.hole;
  const hole = new THREE.Path();
  if (kind === 'rj45') {
    // opening with the latch notch below it
    hole.moveTo(x0, y1);
    hole.lineTo(x0, y0);
    hole.lineTo(-0.08, y0);
    hole.lineTo(-0.08, y0 - 0.07);
    hole.lineTo(0.08, y0 - 0.07);
    hole.lineTo(0.08, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
  } else {
    hole.moveTo(x0, y1);
    hole.lineTo(x0, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
  }
  s.holes.push(hole);
  return s;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

export const GEO = {
  frame: (kind: PortKind) => cached(`frame-${kind}`, () =>
    new THREE.ExtrudeGeometry(frameShape(kind), { depth: JACK[kind].depth, bevelEnabled: false })),
  /** Thin outline just outside the frame, lit when the port is hovered/selected/linked (patch panels). */
  rim: (kind: PortKind) => cached(`rim-${kind}`, () => {
    const d = JACK[kind];
    const s = new THREE.Shape();
    const hw = d.w / 2 + 0.035, hh = d.h / 2 + 0.035;
    s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.lineTo(-hw, -hh);
    const p = new THREE.Path();
    const iw = d.w / 2 + 0.005, ih = d.h / 2 + 0.005;
    p.moveTo(-iw, -ih); p.lineTo(-iw, ih); p.lineTo(iw, ih); p.lineTo(iw, -ih); p.lineTo(-iw, -ih);
    s.holes.push(p);
    return new THREE.ShapeGeometry(s);
  }),
  inside: (kind: PortKind) => cached(`inside-${kind}`, () => {
    const { x0, x1, y0, y1 } = JACK[kind].hole;
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0 + (kind === 'rj45' ? 0.07 : 0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2 - (kind === 'rj45' ? 0.035 : 0), 0);
    return g;
  }),
  pins: () => cached('pins', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const b = new THREE.PlaneGeometry(0.018, 0.07);
      b.translate(-0.13 + i * 0.037, 0.095, 0);
      parts.push(b);
    }
    return mergeGeometries(parts);
  }),
  led: () => cached('led', () => new THREE.BoxGeometry(0.075, 0.045, 0.02)),
  powerLed: () => cached('powerLed', () => new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16).rotateX(Math.PI / 2)),
  screw: () => cached('screw', () => new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16).rotateX(Math.PI / 2)),
  plug: () => cached('plug', () => {
    const g = new THREE.BoxGeometry(0.38, 0.28, 0.7);
    g.translate(0, -0.01, 0.35);
    return g;
  }),
  sfpModule: () => cached('sfpModule', () => {
    const g = new THREE.BoxGeometry(0.5, 0.24, 0.45);
    g.translate(0, -0.02, 0.22);
    return g;
  }),
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  plane: () => cached('plane', () => new THREE.PlaneGeometry(1, 1)),
};

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const geo of parts) {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    const idx = geo.index!;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    offset += pos.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  return out;
}
