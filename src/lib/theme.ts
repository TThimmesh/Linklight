import { createStore, useStore } from './hooks';

// Light/dark mode. Follows the OS setting until someone picks one with the
// toggle; the choice is remembered per browser. index.html applies a saved
// choice before first paint so there's no flash.

export type Theme = 'light' | 'dark';

const KEY = 'linklight-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const themeStore = createStore<Theme>(saved() ?? (media.matches ? 'dark' : 'light'));

media.addEventListener('change', () => {
  if (!saved()) themeStore.set(media.matches ? 'dark' : 'light');
});

export function useTheme(): Theme {
  return useStore(themeStore);
}

export function toggleTheme() {
  const next: Theme = themeStore.get() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, next); } catch { /* still switches for this visit */ }
  document.documentElement.dataset.theme = next;
  themeStore.set(next);
}

/** Colors for the 3D scene surroundings (the racks themselves don't change). */
export const SCENE_COLORS: Record<Theme, { bg: string; floor: string; cell: string; section: string; wall: string }> = {
  dark: { bg: '#0a0e14', floor: '#0b0f14', cell: '#18222d', section: '#223447', wall: '#141a22' },
  light: { bg: '#dde3ea', floor: '#cdd5de', cell: '#b9c3ce', section: '#a1aebc', wall: '#d3dae2' },
};
