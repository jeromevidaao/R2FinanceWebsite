import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, getToken, setSession } from '../api/client';

type Step =
  | 'sign-in'
  | 'set-password'
  | 'mfa'
  | 'mfa-setup'
  | 'forgot';

/**
 * Chrome / password-manager autofill needs email + password in the **same**
 * form, with name + autocomplete attributes. A multi-step “email then password”
 * flow breaks credential matching.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('sign-in');
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

  async function finishLogin(token: string, loginEmail: string) {
    setSession(token, loginEmail);
    navigate('/', { replace: true });
  }

  async function onSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    // Prefer live DOM values so Chrome autofill is captured even if React
    // state lagged behind (controlled inputs + browser fill).
    const fd = new FormData(e.currentTarget);
    const emailVal = String(fd.get('username') || email)
      .trim()
      .toLowerCase();
    const passwordVal = String(fd.get('password') || password);
    setEmail(emailVal);
    setPassword(passwordVal);

    try {
      const st = await authApi.status(emailVal);
      if (st.error) throw new Error(st.error);
      if (st.allowed === false) throw new Error('Email not allowed');
      if (st.mustSetPassword || !st.exists) {
        setStep('set-password');
        setInfo('Choose a password for your R2Finance account.');
        return;
      }

      const res = await authApi.login(emailVal, passwordVal);
      if (res.error) throw new Error(res.error);
      if (
        (res.next === 'mfa' || res.next === 'mfa_verify') &&
        res.mfaToken
      ) {
        setMfaToken(res.mfaToken);
        setStep('mfa');
        setInfo('Enter the 6-digit code from your authenticator app.');
      } else if (res.next === 'mfa_setup') {
        setStep('mfa-setup');
        setInfo(
          'Authenticator MFA is required. Add this account in Google Authenticator, Authy, or 1Password, then enter a code.',
        );
        setSecret(null);
        setOtpauth(null);
        setCode('');
      } else if (res.token) {
        await finishLogin(res.token, res.email || emailVal);
      } else {
        throw new Error('Unexpected login response');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    const emailVal = String(fd.get('username') || email)
      .trim()
      .toLowerCase();
    setEmail(emailVal);
    try {
      const res = await authApi.forgotPassword(emailVal);
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

  async function onSetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const emailVal = String(fd.get('username') || email)
      .trim()
      .toLowerCase();
    const passwordVal = String(fd.get('new-password') || password);
    setEmail(emailVal);
    setPassword(passwordVal);
    try {
      const res = await authApi.setPassword(emailVal, passwordVal);
      if (res.error) throw new Error(res.error);
      if (res.token) {
        await finishLogin(res.token, res.email || emailVal);
      } else if (res.next === 'mfa_setup' || !res.next) {
        setStep('mfa-setup');
        setInfo(
          'Password saved. Next: set up authenticator MFA (required for all users).',
        );
        setSecret(null);
        setOtpauth(null);
        setCode('');
      } else {
        setStep('sign-in');
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
        setStep('sign-in');
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
            <div className="brand-sub">Personal ledger · R2Finance cloud</div>
          </div>
        </div>

        {info && <div className="alert alert-info">{info}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {step === 'sign-in' && (
          <form
            onSubmit={(e) => void onSignIn(e)}
            className="form"
            // Helps password managers identify a login form
            method="post"
            action="/login"
            autoComplete="on"
          >
            <label htmlFor="r2-username">
              Email
              <input
                id="r2-username"
                className="input"
                type="email"
                name="username"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <label htmlFor="r2-password">
              Password
              <input
                id="r2-password"
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
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

        {step === 'forgot' && (
          <form
            onSubmit={(e) => void onForgot(e)}
            className="form"
            autoComplete="on"
          >
            <p className="muted">
              We will email a one-time link that opens this website so you can
              choose a new password.
            </p>
            <label htmlFor="r2-forgot-username">
              Email
              <input
                id="r2-forgot-username"
                className="input"
                type="email"
                name="username"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
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
                setStep('sign-in');
              }}
            >
              Back to sign in
            </button>
          </form>
        )}

        {step === 'set-password' && (
          <form
            onSubmit={(e) => void onSetPassword(e)}
            className="form"
            autoComplete="on"
          >
            {/* Username in the same form so password managers can save the pair */}
            <label htmlFor="r2-set-username">
              Email
              <input
                id="r2-set-username"
                className="input"
                type="email"
                name="username"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label htmlFor="r2-new-password">
              New password
              <input
                id="r2-new-password"
                className="input"
                type="password"
                name="new-password"
                autoComplete="new-password"
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
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStep('sign-in')}
            >
              Back to sign in
            </button>
          </form>
        )}

        {step === 'mfa' && (
          <form onSubmit={onMfa} className="form" autoComplete="off">
            <p className="muted small">{email}</p>
            <label htmlFor="r2-otp">
              Authenticator code
              <input
                id="r2-otp"
                className="input"
                name="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
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
                  Authenticator MFA is <strong>required</strong> for every
                  R2Finance account (household security). You cannot use the
                  app or website with password alone.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void startMfaSetup()}
                >
                  Set up authenticator MFA
                </button>
              </>
            ) : (
              <form onSubmit={confirmMfaSetup} className="form" autoComplete="off">
                <p className="muted small">
                  Add this secret in Google Authenticator, Authy, or 1Password
                  (time-based / TOTP), then enter the 6-digit code.
                </p>
                <p className="muted small">
                  Secret: <code>{secret}</code>
                </p>
                {otpauth && (
                  <p className="muted small break">
                    <code>{otpauth}</code>
                  </p>
                )}
                <label htmlFor="r2-otp-setup">
                  Confirm code
                  <input
                    id="r2-otp-setup"
                    className="input"
                    name="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                  />
                </label>
                <button className="btn btn-primary" disabled={busy} type="submit">
                  Enable MFA & continue
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
