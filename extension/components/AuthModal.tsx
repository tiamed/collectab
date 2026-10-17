import { useState, useRef, useEffect } from 'react';
import { X, Server } from 'lucide-react';
import { getApiBase, getServerAuthConfig, setApiBase, DEFAULT_API_BASE } from '@/lib/api';
import type { ServerAuthConfig, User } from '@/lib/api';

interface AuthModalProps {
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<User>;
  onRegister: (email: string, password: string, name: string) => Promise<User>;
  onLoginWithGoogle?: () => Promise<User>;
}

export default function AuthModal({ onClose, onLogin, onRegister, onLoginWithGoogle }: AuthModalProps) {
  const mousedownOnBackdropRef = useRef(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ServerAuthConfig | null>(null);
  const [configFor, setConfigFor] = useState(getApiBase());

  useEffect(() => {
    let cancelled = false;
    void getServerAuthConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, [configFor]);

  const applyServerUrl = async () => {
    const trimmed = serverUrl.trim().replace(/\/+$/, '');
    if (trimmed && trimmed !== getApiBase()) {
      // Session/cache cleared; continue on the new server
      await setApiBase(trimmed);
      setServerUrl(getApiBase());
      setConfigFor(getApiBase());
    }
  };

  const signUpDisabled = config?.inviteMode === 'invite-only';
  const showGoogle = !!onLoginWithGoogle && config?.google === true;

  const handleGoogleLogin = async () => {
    if (!onLoginWithGoogle) return;
    setError(null);
    setHint(null);
    setLoading(true);
    try {
      await applyServerUrl();
      await onLoginWithGoogle();
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Google login failed';
      setError(msg);
      if (/not enabled|unauthorized|forbidden/i.test(msg)) {
        setHint('Google login is not enabled on this server.');
      } else if (/cancelled|canceled/i.test(msg)) {
        setHint('Login cancelled.');
      } else {
        setHint('Google login failed. Check the Server URL below.');
        setShowServer(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setHint(null);
    setLoading(true);
    try {
      await applyServerUrl();

      if (mode === 'login') {
        await onLogin(email, password);
      } else {
        await onRegister(email, password, name);
      }
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Request failed';
      setError(msg);

      const isNetwork =
        /failed to fetch|network|econnrefused|timeout|load failed/i.test(msg) ||
        msg === 'Failed to fetch';
      const isAuth =
        /invalid|unauthorized|not found|incorrect|credentials|401|403/i.test(msg);

      if (/too many/i.test(msg)) {
        setHint('Too many attempts. Wait a few seconds and try again.');
      } else if (mode === 'login') {
        if (isNetwork) {
          setHint('Cannot reach the server. Check the Server URL below, or make sure your server is running.');
          setShowServer(true);
        } else if (isAuth) {
          setHint('Wrong email or password? Or create an account if you haven\'t registered yet.');
        } else {
          setHint('Login failed. Check your Server URL, or register a new account.');
          setShowServer(true);
        }
      } else if (isNetwork) {
        setHint('Cannot reach the server. Check the Server URL below.');
        setShowServer(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    mousedownOnBackdropRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (!mousedownOnBackdropRef.current) return;
    mousedownOnBackdropRef.current = false;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)]" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <form
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Name</label>
              <input
                type="text"
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Email</label>
            <input
              type="email"
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Password</label>
            <input
              type="password"
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 8 characters' : '••••••••'}
              required
              minLength={mode === 'register' ? 8 : undefined}
            />
          </div>

          {/* Server URL */}
          <div>
            <button
              type="button"
              onClick={() => setShowServer(!showServer)}
              className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Server className="size-3" />
              Server URL
              <span className="text-[9px] opacity-60">{showServer ? '▲' : '▼'}</span>
            </button>
            {showServer && (
              <input
                type="url"
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                onBlur={() => void applyServerUrl()}
                placeholder={DEFAULT_API_BASE}
              />
            )}
            {!showServer && (
              <p className="truncate text-[10px] text-[var(--muted)]">{serverUrl}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="text-[11px] text-red-400">{error}</p>
            {hint && <p className="mt-1 text-[10px] text-red-300/80">{hint}</p>}
          </div>
        )}

        {showGoogle && (
          <div>
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded border border-[var(--border)] bg-[var(--background)] py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>
            <div className="my-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[10px] text-[var(--muted)]">or</span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded bg-[var(--accent)] py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>

        <p className="mt-3 text-center text-[11px] text-[var(--muted)]">
          {mode === 'login' && signUpDisabled ? (
            <>This server is invite-only. Open your invitation link to create an account.</>
          ) : mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => { setMode('register'); setError(null); setHint(null); }}
                className="text-[var(--accent)] hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); setHint(null); }}
                className="text-[var(--accent)] hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
