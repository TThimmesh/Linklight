import * as THREE from 'three';
import { useEffect, useState } from 'react';
import type { EquipmentModel } from '../lib/types';
import type { FaceLayout } from '../lib/ports';

export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([
      document.fonts.load('800 40px Archivo'),
      document.fonts.load('500 40px "IBM Plex Mono"'),
      document.fonts.load('600 40px "IBM Plex Mono"'),
      document.fonts.load('500 40px "IBM Plex Sans"'),
    ]).catch(() => undefined).finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  return ready;
}

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function inkFor(faceColor: string): string {
  return luminance(faceColor) > 0.45 ? '#1a1e23' : '#d9dee4';
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Seeded so the brushed-metal streaks don't change on every re-render. */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export interface FaceTextureInput {
  model: EquipmentModel | null;
  deviceName: string;
  faceW: number;
  faceH: number;
  layout: FaceLayout | null;
}

/** Draws a device faceplate: brushed finish, brand, label-maker name tape, port blocks and numbers. */
export function makeFaceTexture({ model, deviceName, faceW, faceH, layout }: FaceTextureInput): THREE.CanvasTexture {
  const ppi = Math.min(170, 4096 / faceW);
  const W = Math.max(8, Math.round(faceW * ppi));
  const H = Math.max(8, Math.round(faceH * ppi));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const X = (x: number) => (x + faceW / 2) * ppi;
  const Y = (y: number) => (faceH / 2 - y) * ppi;
  const px = (inches: number) => inches * ppi;

  const face = model?.faceColor ?? '#3a3f46';
  const ink = inkFor(face);
  const light = ink !== '#1a1e23';

  // finish
  g.fillStyle = face;
  g.fillRect(0, 0, W, H);
  const rand = rng(hash(deviceName + (model?.id ?? '')));
  for (let y = 0; y < H; y += 2) {
    g.fillStyle = `rgba(255,255,255,${(rand() * 0.035).toFixed(3)})`;
    g.fillRect(0, y, W, 1);
  }
  const sheen = g.createLinearGradient(0, 0, 0, H);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(0.35, 'rgba(255,255,255,0.0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = Math.max(1, px(0.02));
  g.strokeRect(1, 1, W - 2, H - 2);

  if (!model) {
    g.fillStyle = ink;
    g.font = `600 ${px(Math.min(0.2, faceH * 0.25))}px "IBM Plex Mono", monospace`;
    g.textBaseline = 'middle';
    g.fillText(`${deviceName} — no model set`, px(0.3), H / 2, W - px(0.6));
    return finish(canvas);
  }

  // power gear: vent slots instead of ports
  if (model.category === 'power' && !layout?.slots.length) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    const slotW = px(0.09);
    const slotH = Math.min(px(faceH * 0.55), px(0.9));
    for (let x = W * 0.42; x < W - px(0.5); x += px(0.2)) {
      roundRect(g, x, (H - slotH) / 2, slotW, slotH, slotW / 2);
      g.fill();
    }
    // status display
    const dw = px(1.6), dh = Math.min(px(0.5), H * 0.4);
    g.fillStyle = '#0b1410';
    roundRect(g, W * 0.42 - dw - px(0.4), (H - dh) / 2, dw, dh, px(0.05));
    g.fill();
    g.fillStyle = '#5ee39a';
    g.font = `500 ${dh * 0.5}px "IBM Plex Mono", monospace`;
    g.textBaseline = 'middle';
    g.fillText('ONLINE', W * 0.42 - dw - px(0.28), H / 2, dw - px(0.25));
  }

  // brand
  g.textBaseline = 'alphabetic';
  const brandName = model.manufacturer && model.manufacturer !== 'Generic' ? model.manufacturer : '';
  const tape = (x: number, yTop: number, maxW: number, size: number) => {
    g.font = `600 ${px(size)}px "IBM Plex Mono", monospace`;
    const tw = Math.min(g.measureText(deviceName).width, maxW - px(0.16));
    const th = px(size * 1.7);
    g.fillStyle = '#f3f0e6';
    roundRect(g, x, yTop, tw + px(0.16), th, px(0.03));
    g.fill();
    g.fillStyle = '#111';
    g.textBaseline = 'middle';
    g.fillText(deviceName, x + px(0.08), yTop + th / 2 + px(0.005), tw);
    g.textBaseline = 'alphabetic';
  };

  if (layout && layout.brandW > 0) {
    const bx = px(0.32);
    const maxW = px(layout.brandW - 0.25);
    let y = px(0.12);
    if (brandName) {
      const size = Math.min(0.24, faceH * 0.16);
      g.font = `800 ${px(size)}px Archivo, sans-serif`;
      g.fillStyle = ink;
      y += px(size);
      g.fillText(brandName.toUpperCase(), bx, y, maxW);
    }
    const msize = Math.min(0.14, faceH * 0.1);
    g.font = `500 ${px(msize)}px "IBM Plex Mono", monospace`;
    g.fillStyle = light ? 'rgba(217,222,228,0.75)' : 'rgba(26,30,35,0.75)';
    y += px(msize + 0.07);
    g.fillText(model.name, bx, y, maxW);
    const tsize = Math.min(0.13, faceH * 0.09);
    const tapeTop = Math.max(y + px(0.1), H - px(tsize * 1.7 + 0.16));
    if (tapeTop + px(tsize * 1.7) < H) tape(bx, tapeTop, maxW, tsize);
  } else if (model.category === 'patchpanel') {
    // name tape in the left margin
    const firstX = layout?.slots.length ? Math.min(...layout.slots.map(s => X(s.x - s.w / 2))) : W;
    const room = firstX - px(0.45);
    if (room > px(0.6)) tape(px(0.25), H / 2 - px(0.11), room, Math.min(0.12, faceH * 0.09));
  } else {
    // small devices: one line across the top, tape at the right
    const size = Math.min(0.13, faceH * 0.1);
    g.font = `700 ${px(size)}px Archivo, sans-serif`;
    g.fillStyle = ink;
    const label = [brandName, model.name].filter(Boolean).join(' ');
    g.fillText(label, px(0.18), px(0.08 + size), W * 0.55);
    g.font = `600 ${px(size * 0.9)}px "IBM Plex Mono", monospace`;
    const tw = Math.min(g.measureText(deviceName).width, W * 0.4);
    tape(W - tw - px(0.16) - px(0.15), px(0.06), W * 0.4, size * 0.9);
  }

  if (layout) {
    // port blocks
    g.strokeStyle = light ? 'rgba(217,222,228,0.28)' : 'rgba(26,30,35,0.35)';
    g.lineWidth = Math.max(1, px(0.015));
    for (const b of layout.blocks) {
      roundRect(g, X(b.x - b.w / 2), Y(b.y + b.h / 2), px(b.w), px(b.h), px(0.04));
      g.stroke();
    }
    // port numbers
    g.fillStyle = light ? 'rgba(217,222,228,0.85)' : 'rgba(26,30,35,0.85)';
    g.font = `500 ${px(layout.numberH * 0.78)}px "IBM Plex Mono", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const s of layout.slots) {
      const y = s.labelAbove ? s.y + s.h / 2 + layout.numberH * 0.55 : s.y - s.h / 2 - layout.numberH * 0.55;
      g.fillText(s.key, X(s.x), Y(y), px(s.w * 1.25));
    }
    g.textAlign = 'left';
  }

  return finish(canvas);
}

function finish(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Front rail strip: square cage-nut holes and U numbers. */
export function makeRailTexture(units: number, side: 'left' | 'right'): THREE.CanvasTexture {
  const ppi = 40;
  const wIn = 0.7;
  const W = Math.round(wIn * ppi);
  const H = Math.round(units * 1.75 * ppi);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#4a5059';
  g.fillRect(0, 0, W, H);
  const holeX = side === 'left' ? W * 0.62 : W * 0.38;
  const hs = 0.3 * ppi;
  g.fillStyle = '#07090b';
  for (let u = 0; u < units; u++) {
    for (const off of [0.25, 0.875, 1.5]) {
      const y = H - (u * 1.75 + off) * ppi;
      g.fillRect(holeX - hs / 2, y - hs / 2, hs, hs);
    }
    // U number + divider
    g.fillStyle = '#cfd5dc';
    g.font = `600 ${Math.round(0.24 * ppi)}px "IBM Plex Mono", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const nx = side === 'left' ? W * 0.2 : W * 0.8;
    g.save();
    g.translate(nx, H - (u * 1.75 + 0.875) * ppi);
    g.rotate(-Math.PI / 2);
    g.fillText(String(u + 1), 0, 0);
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, H - (u + 1) * 1.75 * ppi, W, 1);
    g.fillStyle = '#07090b';
  }
  return finish(canvas);
}
