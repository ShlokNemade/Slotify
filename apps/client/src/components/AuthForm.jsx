import { useState } from 'react';
import { api, setSessionToken } from '../lib/api.js';
import { ErrorMessage } from './ErrorMessage.jsx';

export function AuthForm({ onComplete, initialMode = 'signin' }) {
  const [mode, setMode] = useState(initialMode);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('customer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      if (mode === 'signup') {
        const registration = await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, fullName, role }),
        });
        if (registration.devVerificationToken) {
          await api('/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ token: registration.devVerificationToken }),
          });
          setNotice('Account created and verified for this development environment.');
        } else {
          setNotice('Account created. Check your email to verify it, then sign in.');
          setMode('signin');
          return;
        }
      }

      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSessionToken(data.sessionToken);
      onComplete(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {mode === 'signup' && (
        <>
          <label>Full name<input autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
          <label>Account type
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="customer">Customer — book appointments</option>
              <option value="owner">Business owner — manage a business</option>
            </select>
          </label>
        </>
      )}
      <label>Email<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <ErrorMessage message={error} />
      {notice && <p className="success-message" role="status">{notice}</p>}
      <button className="primary-button wide" disabled={saving}>{saving ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      <button
        type="button"
        className="auth-switch"
        onClick={() => {
          setMode((current) => current === 'signin' ? 'signup' : 'signin');
          setError('');
          setNotice('');
          setRole('customer');
        }}
      >
        {mode === 'signup' ? 'Already have an account? Sign in' : 'New to Slotify? Create an account'}
      </button>
    </form>
  );
}
