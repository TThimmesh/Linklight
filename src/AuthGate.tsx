import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth';
import { ALLOWED_EMAIL_DOMAINS, emailAllowed } from './lib/firebase';
import { settings } from './lib/settings';
import { Logo } from './components/ui';

type View = 'loading' | 'signin' | 'forgot' | 'in';

const FRIENDLY: Record<string, string> = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/invalid-email': 'That doesn\'t look like an email address.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts — wait a few minutes and try again.',
  'auth/network-request-failed': 'Couldn\'t reach Firebase — check the connection.',
};
const friendly = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? '';
  return FRIENDLY[code] ?? (e instanceof Error ? e.message : String(e));
};

/**
 * Invite-only, like the original site: accounts are added by an admin in the
 * Firebase console (Authentication → Users → Add user). New people use
 * "Forgot password?" to choose their own password.
 */
export function AuthGate({ auth, children }: { auth: Auth; children: (user: User) => ReactNode }) {
  const [view, setView] = useState<View>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth, u => {
    setUser(u);
    setView(u ? 'in' : 'signin');
  }), [auth]);

  if (view === 'in' && user) {
    if (!emailAllowed(user.email)) {
      return (
        <div className="auth">
          <div className="auth-card stack">
            <h1>Not on the team list</h1>
            <p className="muted" style={{ margin: 0 }}>
              This Linklight is limited to {ALLOWED_EMAIL_DOMAINS.map(d => `@${d}`).join(' / ')} accounts. You're signed in as {user.email}.
            </p>
            <button className="btn" onClick={() => void signOut(auth)}>Sign out</button>
          </div>
        </div>
      );
    }
    return <>{children(user)}</>;
  }

  const signIn = async () => {
    setBusy(true); setMsg('');
    try { await signInWithEmailAndPassword(auth, email.trim(), password); } catch (e) { setMsg(friendly(e)); }
    setBusy(false);
  };
  const sendReset = async () => {
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg('If that email has an account, a link to set a new password is on its way.');
    } catch (e) { setMsg(friendly(e)); }
    setBusy(false);
  };
  const onEnter = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter') fn(); };

  return (
    <div className="auth">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Logo size={34} />
          <span className="brand-word" style={{ fontSize: 22 }}>Linklight</span>
        </div>
        {view === 'loading' && <div className="spinner" />}
        {view === 'signin' && (
          <div className="stack">
            <div className="sub" style={{ margin: 0 }}>{settings.tagline ?? 'Document your network closets in 3D.'}</div>
            <input type="email" placeholder="Email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onEnter(signIn)} />
            <input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={onEnter(signIn)} />
            {msg && <div className="banner bad small">{msg}</div>}
            <button className="btn primary" onClick={signIn} disabled={busy}>Sign in</button>
            <div className="links">
              <button onClick={() => { setMsg(''); setView('forgot'); }}>Forgot password? / First time here?</button>
            </div>
          </div>
        )}
        {view === 'forgot' && (
          <div className="stack">
            <div className="sub" style={{ margin: 0 }}>We'll email you a link to set your password.</div>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onEnter(sendReset)} />
            {msg && <div className="banner info small">{msg}</div>}
            <button className="btn primary" onClick={sendReset} disabled={busy}>Send link</button>
            <div className="links"><button onClick={() => { setMsg(''); setView('signin'); }}>← Back to sign in</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
