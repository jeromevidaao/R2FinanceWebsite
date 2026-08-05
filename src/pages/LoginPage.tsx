import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, getToken, setSession } from '../api/client';

type Step =
  | 'email'
  | 'password'
  | 'set-password'
  | 'mfa'
  | 'mfa-setup'
  | 'forgot';

export function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (getToken()) navigate('/', { replace: true });
  }, [navigate]);

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const st = await authApi.status(email.trim().toLowerCase());
      if (st.error) throw new Error(st.error);
      if (st.allowed === false) throw new Error('Email not allowed');
      if (st.mustSetPassword || !st.exists) {
        setStep('set-password');
        setInfo('Choose a password for your R2Finance account.');
      } else {
        setStep('password');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function finishLogin(token: string, loginEmail: string) {
    setSession(token, loginEmail);
    navigate('/', { replace: true });
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.login(email.trim().toLowerCase(), password);
      if (res.error) throw new Error(res.error);
      if (
        (res.next === 'mfa' || res.next === 'mfa_verify') &&
        res.mfaToken
      ) {
        setMfaToken(res.mfaToken);
        setStep('mfa');
        setInfo('Enter the 6-digit code from your authenticator app.');
      } else if (res.token) {
        await finishLogin(res.token, res.email || email);
      } else if (res.next === 'mfa_setup') {
        setStep('mfa-setup');
        setInfo('Optional: enable MFA for stronger security.');
      } else {
        throw new Error('Unexpected login response');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await authApi.forgotPassword(email.trim().toLowerCase());
      if (res.error) throw new Error(res.error);
      setInfo(
        res.message ||
          'Check your email for a link to reset your password on this website.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSetPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.setPassword(
        email.trim().toLowerCase(),
        password,
      );
      if (res.error) throw new Error(res.error);
      if (res.token) {
        await finishLogin(res.token, res.email || email);
      } else {
        setStep('password');
        setInfo('Password saved. Sign in with your new password.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.mfaVerify(mfaToken, code.trim());
      if (res.error) throw new Error(res.error);
      if (!res.token) throw new Error('No session token');
      await finishLogin(res.token, res.email || email);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function startMfaSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.mfaSetup(email.trim().toLowerCase(), password);
      if (res.error) throw new Error(res.error);
      setSecret(res.secret || null);
      setOtpauth(res.otpauth || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMfaSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.mfaEnable(
        email.trim().toLowerCase(),
        password,
        code.trim(),
      );
      if (res.error) throw new Error(res.error);
      if (res.token) {
        await finishLogin(res.token, res.email || email);
      } else {
        setStep('password');
        setInfo('MFA enabled. Sign in again.');
      }
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
            <div className="brand-sub">Personal ledger · YNAB-powered backend</div>
          </div>
        </div>

        {info && <div className="alert alert-info">{info}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {step === 'email' && (
          <form onSubmit={onEmail} className="form">
            <label>
              Email
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" disabled={busy} type="submit">
              Continue
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError(null);
                setInfo(null);
                setStep('forgot');
              }}
            >
              Forgot password?
            </button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={onPassword} className="form">
            <label>
              Password
              <input
                className="input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" disabled={busy} type="submit">
              Sign in
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError(null);
                setInfo(null);
                setStep('forgot');
              }}
            >
              Forgot password?
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStep('email')}
            >
              Back
            </button>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={onForgot} className="form">
            <p className="muted">
              We will email a one-time link that opens this website so you can
              choose a new password.
            </p>
            <label>
              Email
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError(null);
                setStep(email ? 'password' : 'email');
              }}
            >
              Back to sign in
            </button>
          </form>
        )}

        {step === 'set-password' && (
          <form onSubmit={onSetPassword} className="form">
            <label>
              New password
              <input
                className="input"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" disabled={busy} type="submit">
              Save password
            </button>
          </form>
        )}

        {step === 'mfa' && (
          <form onSubmit={onMfa} className="form">
            <label>
              Authenticator code
              <input
                className="input"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" disabled={busy} type="submit">
              Verify
            </button>
          </form>
        )}

        {step === 'mfa-setup' && (
          <div className="form">
            {!secret ? (
              <>
                <p className="muted">
                  You can enable time-based MFA now, or skip and use password-only.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void startMfaSetup()}
                >
                  Set up MFA
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setStep('password')}
                >
                  Skip for now
                </button>
              </>
            ) : (
              <form onSubmit={confirmMfaSetup} className="form">
                <p className="muted small">
                  Secret: <code>{secret}</code>
                </p>
                {otpauth && (
                  <p className="muted small break">
                    <code>{otpauth}</code>
                  </p>
                )}
                <label>
                  Confirm code
                  <input
                    className="input"
                    inputMode="numeric"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <button className="btn btn-primary" disabled={busy} type="submit">
                  Enable MFA
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
