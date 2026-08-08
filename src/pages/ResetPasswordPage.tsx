import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi, clearSession } from '../api/client';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get('token')?.trim() || '', [params]);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('Missing reset token. Open the link from your email.');
      return;
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    if (password !== password2) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.resetPassword(token, password);
      if (res.error) throw new Error(res.error);
      clearSession();
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand brand-login">
          <div className="brand-mark">R2</div>
          <div>
            <div className="brand-title">R2Finance</div>
            <div className="brand-sub">Reset password</div>
          </div>
        </div>

        {!token && (
          <div className="alert alert-error">
            This page needs a valid token from the reset email. Request a new
            link from the login page.
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {done && (
          <div className="alert alert-info">
            Password updated. Redirecting to sign in…
          </div>
        )}

        {!done && (
          <form onSubmit={onSubmit} className="form" autoComplete="on">
            <label htmlFor="r2-reset-password">
              New password
              <input
                id="r2-reset-password"
                className="input"
                type="password"
                name="new-password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                disabled={!token || busy}
              />
            </label>
            <label htmlFor="r2-reset-password2">
              Confirm password
              <input
                id="r2-reset-password2"
                className="input"
                type="password"
                name="new-password-confirm"
                autoComplete="new-password"
                required
                minLength={10}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                disabled={!token || busy}
              />
            </label>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!token || busy}
            >
              {busy ? 'Saving…' : 'Update password'}
            </button>
            <Link to="/login" className="btn btn-ghost" style={{ textAlign: 'center' }}>
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
