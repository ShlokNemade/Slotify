import { useEffect, useState } from 'react';
import { ErrorMessage } from '../components/ErrorMessage.jsx';
import { api } from '../lib/api.js';

export function VerifyEmailPage({ token: initialToken = '', onNavigate }) {
  const [token, setToken] = useState(initialToken);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(Boolean(initialToken));

  useEffect(() => {
    if (!initialToken) return;
    api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: initialToken }) })
      .then(() => setNotice('Email verified. You can now sign in.'))
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  }, [initialToken]);

  async function verify(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
      setNotice('Email verified. You can now sign in.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page narrow auth-page">
      <p className="eyebrow">EMAIL VERIFICATION</p>
      <h1>Confirm your email.</h1>
      <p className="profile-description">Use the single-use token from your verification email.</p>
      <form className="auth-form surface-card" onSubmit={verify}>
        <label>Verification token<input required value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <button className="primary-button wide" disabled={saving}>Verify email</button>
      </form>
      <ErrorMessage message={error} />
      {notice && <p className="success-message" role="status">{notice}</p>}
      <button className="text-button" onClick={() => onNavigate('/account')}>Back to account</button>
    </section>
  );
}
