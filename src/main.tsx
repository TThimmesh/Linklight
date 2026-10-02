import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { signOut } from 'firebase/auth';
import { App } from './App';
import { AuthGate } from './AuthGate';
import { loadFirebaseConfig } from './lib/firebase';
import { createFirebaseBackend } from './lib/firebaseBackend';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="auth">
      <div className="auth-card stack">
        <h1>{title}</h1>
        <p className="muted" style={{ margin: 0 }}>{body}</p>
      </div>
    </div>
  );
}

async function start() {
  // Local-only demo/preview modes; this whole branch is stripped from production builds.
  if (import.meta.env.DEV) {
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (demo !== null) {
      const { startDemo } = await import('./dev/demo');
      try {
        const backend = await startDemo(demo);
        root.render(<StrictMode><App backend={backend} /></StrictMode>);
      } catch (e) {
        root.render(<Message title="Demo couldn't start" body={e instanceof Error ? e.message : String(e)} />);
      }
      return;
    }
  }

  const cfg = await loadFirebaseConfig();
  if (!cfg) {
    root.render(<Message title="Almost there" body="config.js hasn't been filled in with the Firebase web app settings yet (see README), and this isn't running on Firebase Hosting." />);
    return;
  }
  const { backend, auth } = createFirebaseBackend(cfg);
  root.render(
    <StrictMode>
      <AuthGate auth={auth}>
        {user => <App backend={backend} userEmail={user.email} onSignOut={() => void signOut(auth)} />}
      </AuthGate>
    </StrictMode>,
  );
}

void start();
