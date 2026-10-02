import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Backend } from '../lib/backend';
import { usePhotoUrl } from '../lib/hooks';
import { toggleTheme, useTheme } from '../lib/theme';
import { CABLE_COLORS, CABLE_HEX, type EquipmentModel, type Status } from '../lib/types';

// ---------------------------------------------------------------------------
// App context: the active backend + equipment library
// ---------------------------------------------------------------------------

export interface AppCtx {
  backend: Backend;
  models: EquipmentModel[];
  modelsById: Map<string, EquipmentModel>;
  reloadModels(): void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}

// ---------------------------------------------------------------------------

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 16 16">
        <rect x="1" y="2" width="14" height="3.4" rx="0.8" fill="#2a3542" />
        <rect x="1" y="6.3" width="14" height="3.4" rx="0.8" fill="#2a3542" />
        <rect x="1" y="10.6" width="14" height="3.4" rx="0.8" fill="#2a3542" />
        <circle cx="3.4" cy="3.7" r="0.9" fill="#3ef07c" />
        <circle cx="6" cy="3.7" r="0.9" fill="#3ef07c" />
        <circle cx="3.4" cy="8" r="0.9" fill="#ffa526" />
        <circle cx="6" cy="8" r="0.9" fill="#3ef07c" />
        <circle cx="3.4" cy="12.3" r="0.9" fill="#3ef07c" />
      </svg>
    </span>
  );
}

export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button className="btn ghost icon" onClick={toggleTheme} title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`}>
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />
        </svg>
      )}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label} {hint && <span className="hint">· {hint}</span>}</span>
      {children}
    </label>
  );
}

const STATUS_TEXT: Record<Status, string> = { confirmed: 'Confirmed', 'to-confirm': 'To confirm', flagged: 'Flagged' };
export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill ${status}`}>{STATUS_TEXT[status] ?? status}</span>;
}

export function CableSwatches({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Cable color">
      <button type="button" className={`none ${value === '' ? 'on' : ''}`} title="Unknown" onClick={() => onChange('')} />
      {CABLE_COLORS.map(c => (
        <button
          type="button" key={c} title={c} aria-label={c}
          className={value === c ? 'on' : ''}
          style={{ background: CABLE_HEX[c] }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose(): void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

export function PhotoThumb({ backend, path, onRemove }: { backend: Backend; path: string; onRemove?: () => void }) {
  const url = usePhotoUrl(backend, path);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="photo" onClick={() => url && setOpen(true)}>
        {url ? <img src={url} alt="" /> : <div className="center-fill" style={{ height: '100%' }}><div className="spinner" /></div>}
        {onRemove && (
          <button className="x" title="Remove photo" onClick={e => { e.stopPropagation(); onRemove(); }}>×</button>
        )}
      </div>
      {open && url && <Lightbox src={url} onClose={() => setOpen(false)} />}
    </>
  );
}

export function HoverPhoto({ backend, path }: { backend: Backend; path: string }) {
  const url = usePhotoUrl(backend, path);
  return url ? <img src={url} alt="" /> : null;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
