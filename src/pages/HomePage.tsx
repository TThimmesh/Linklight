import { useState } from 'react';
import type { Route } from '../lib/hooks';
import type { Property } from '../lib/types';
import { SiteDialog } from '../components/dialogs';
import { useApp } from '../components/ui';

export function HomePage({ properties, go, onCreated }: { properties: Property[] | null; go(r: Route): void; onCreated(): void }) {
  const { backend } = useApp();
  const [adding, setAdding] = useState(false);
  const canImport = backend.mode === 'firebase';
  return (
    <div className="home">
      <div className="home-inner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1>Sites</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>Pick a property to see its racks, or document a new one.</p>
          </div>
          {canImport && (
            <button className="btn" onClick={() => go({ page: 'import' })}>Import…</button>
          )}
        </div>
        {!properties ? (
          <div style={{ marginTop: 24 }}><div className="spinner" /></div>
        ) : (
          <>
            {properties.length === 0 && (
              <div className="banner info" style={{ marginTop: 18 }}>
                No sites yet. Start with <b>+ New site</b>{canImport ? <>, or bring a documented site in with <b>Import…</b></> : null}.
              </div>
            )}
            <div className="cards">
              {properties.map(p => (
                <button key={p.id} className="card" onClick={() => go({ page: 'site', propertyId: p.id, rackId: null })}>
                  {p.code && <span className="code">{p.code}</span>}
                  <h3>{p.name}</h3>
                  {p.address && <span className="addr">{p.address}</span>}
                </button>
              ))}
              <button className="card new" onClick={() => setAdding(true)}>+ New site</button>
            </div>
          </>
        )}
      </div>
      {adding && (
        <SiteDialog
          onClose={() => setAdding(false)}
          onSaved={p => { setAdding(false); onCreated(); go({ page: 'site', propertyId: p.id, rackId: null }); }}
        />
      )}
    </div>
  );
}
