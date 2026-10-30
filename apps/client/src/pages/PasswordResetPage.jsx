import { useState } from 'react';
import { ErrorMessage } from '../components/ErrorMessage.jsx';
import { api } from '../lib/api.js';

export function PasswordResetPage({ token: initialToken = '', onNavigate }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function requestReset(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const data = await api('/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (data.devResetToken) setToken(data.devResetToken);
      setNotice(data.devResetToken
        ? 'Development reset token loaded below.'
        : 'If an account exists, check its email for reset instructions.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function completeReset(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      setNotice('Password reset successfully. You can now sign in.');
      setToken('');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page narrow auth-page">
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h1>Reset your password.</h1>
      <p className="profile-description">Request a single-use reset token, then choose a new password.</p>
      <form className="auth-form surface-card" onSubmit={requestReset}>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="primary-button wide" disabled={saving}>Send reset instructions</button>
      </form>
      <form className="auth-form surface-card" onSubmit={completeReset}>
        <label>Reset token<input required value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste the token from your email" /></label>
        <label>New password<input type="password" autoComplete="new-password" minLength="8" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <button className="secondary-button wide" disabled={saving}>Set new password</button>
      </form>
      <ErrorMessage message={error} />
      {notice && <p className="success-message" role="status">{notice}</p>}
      <button className="text-button" onClick={() => onNavigate('/account')}>Back to account</button>
    </section>
  );
}
