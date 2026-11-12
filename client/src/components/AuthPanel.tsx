import { useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { GatewayMode } from '../types.js';

type AuthPanelProps = {
  gateway: GatewayMode;
  onAuthenticate: (email: string, password: string, mode: 'login' | 'register') => Promise<void>;
};

export function AuthPanel({ gateway, onAuthenticate }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onAuthenticate(email, password, mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-labelledby="auth-heading">
        <div className="brand"><ShieldCheck size={28} aria-hidden="true" /><span>Payment Hub</span></div>
        <h1 id="auth-heading">Payments your customers can trust.</h1>
        <p>One-time purchases, recurring subscriptions, and self-service billing — backed by Stripe-hosted checkout and webhook-confirmed fulfillment.</p>
        <ul className="auth-points">
          <li><LockKeyhole size={18} aria-hidden="true" />Card details never touch this application.</li>
          <li><KeyRound size={18} aria-hidden="true" />Signed sessions, CSRF protection, and idempotent checkout.</li>
          <li><ShieldCheck size={18} aria-hidden="true" />Payment state changes only after verified provider events.</li>
        </ul>
        {gateway === 'demo' && <p className="demo-banner">Demo mode is active. Payments are simulated and no real charges occur.</p>}
      </section>
      <section className="auth-card" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="muted">{mode === 'login' ? 'Sign in to manage purchases and billing.' : 'Use a password with at least 12 characters.'}</p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy && <LoaderCircle size={18} className="spin" aria-hidden="true" />}
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button type="button" className="button-link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
          {mode === 'login' ? 'Need an account? Register' : 'Already registered? Sign in'}
        </button>
      </section>
    </main>
  );
}