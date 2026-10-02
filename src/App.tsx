import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Backend } from './lib/backend';
import { routeHash, useModels, useRoute } from './lib/hooks';
import { normalizeModel } from './lib/ports';
import type { EquipmentModel, Property } from './lib/types';
import library from './data/equipment-library.json';
import { AppContext, Logo, ThemeToggle, errorText, type AppCtx } from './components/ui';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { SitePage } from './pages/SitePage';
import { LibraryPage } from './pages/LibraryPage';

const starterLibrary = (library as Partial<EquipmentModel>[]).map(m => normalizeModel(m as EquipmentModel));

export function App({ backend, userEmail, onSignOut }: { backend: Backend; userEmail?: string | null; onSignOut?: () => void }) {
  const models = useModels(backend);
  const [route, go] = useRoute();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [propsError, setPropsError] = useState<Error | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);

  const loadProperties = useCallback(() => {
    backend.listProperties().then(p => { setProperties(p); setPropsError(null); }, setPropsError);
  }, [backend]);
  useEffect(loadProperties, [loadProperties]);

  // First run against an empty database: add the starter equipment library.
  useEffect(() => {
    backend.ensureLibrary(starterLibrary).then(
      () => { setLibraryReady(true); models.reload(); },
      e => { setPropsError(e); setLibraryReady(true); },
    );
    // once per backend; models.reload is stable for a given backend
  }, [backend]);

  // The demo has one site — open it straight away.
  useEffect(() => {
    if (backend.mode === 'demo' && route.page === 'home' && properties?.length === 1) {
      go({ page: 'site', propertyId: properties[0].id, rackId: null }, true);
    }
  }, [backend.mode, route.page, properties, go]);

  const ctx: AppCtx = useMemo(() => {
    const list = models.data ?? [];
    return { backend, models: list, modelsById: new Map(list.map(m => [m.id, m])), reloadModels: models.reload, reloadProperties: loadProperties };
  }, [backend, models.data, models.reload, loadProperties]);

  const error = propsError ?? models.error;
  let page;
  if (error) page = <PermissionHint error={error} />;
  else if (!models.data || !libraryReady) page = <div className="center-fill"><div className="spinner" /></div>;
  else if (route.page === 'site') page = <SitePage key={route.propertyId} propertyId={route.propertyId} rackId={route.rackId} go={go} />;
  else if (route.page === 'library') page = <LibraryPage modelId={route.modelId} go={go} />;
  else if (route.page === 'import') page = <ImportPage go={go} onDone={loadProperties} />;
  else page = <HomePage properties={properties} go={go} onCreated={loadProperties} />;

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <a className="brand" href={routeHash({ page: 'home' })}>
            <Logo />
            <span className="brand-word">Linklight</span>
          </a>
          <nav className="topnav">
            <a href={routeHash({ page: 'home' })} className={route.page === 'home' || route.page === 'site' ? 'active' : ''}>Sites</a>
            <a href={routeHash({ page: 'library', modelId: null })} className={route.page === 'library' ? 'active' : ''}>Library</a>
          </nav>
          {route.page === 'site' && properties && properties.length > 1 && (
            <select
              className="site-picker"
              value={route.propertyId}
              onChange={e => go({ page: 'site', propertyId: e.target.value, rackId: null })}
              aria-label="Switch site"
            >
              {properties.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
            </select>
          )}
          <span className="spacer" />
          {backend.mode === 'demo' && <span className="demo-badge" title="Changes are kept in memory only">Demo data</span>}
          <ThemeToggle />
          {userEmail && <span className="small muted">{userEmail}</span>}
          {onSignOut && <button className="btn sm" onClick={onSignOut}>Sign out</button>}
          {backend.mode === 'demo' && <a className="btn sm" href={window.location.pathname}>Exit demo</a>}
        </header>
        {page}
      </div>
    </AppContext.Provider>
  );
}

function PermissionHint({ error }: { error: Error }) {
  const denied = /permission|insufficient/i.test(error.message);
  return (
    <div className="center-fill" style={{ padding: 24 }}>
      <div style={{ maxWidth: 560 }} className="stack">
        <h2>{denied ? 'The database said no' : 'Something went wrong'}</h2>
        {denied ? (
          <p className="muted" style={{ margin: 0 }}>
            Firestore refused the request. Usually that means the security rules haven't been deployed yet
            (<code>firebase deploy</code> — see README), or this account's email isn't on the allowed domain.
          </p>
        ) : null}
        <div className="banner bad small mono">{errorText(error)}</div>
      </div>
    </div>
  );
}
