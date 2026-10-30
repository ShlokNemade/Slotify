import { useEffect, useState } from 'react';
import { AuthForm } from '../components/AuthForm.jsx';
import { ErrorMessage } from '../components/ErrorMessage.jsx';
import { api, getSessionToken, setSessionToken } from '../lib/api.js';

export function AuthPage({ onNavigate }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getSessionToken()));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getSessionToken()) return;
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setSessionToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      setError(err.message);
      return;
    }
    setSessionToken(null);
    setUser(null);
  }

  if (loading) return <section className="page narrow"><p className="loading">Loading account…</p></section>;
  if (user) {
    return (
      <section className="page narrow">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>Welcome back, {user.fullName}.</h1>
        <p className="profile-description">{user.email}</p>
        <button className="secondary-button wide" onClick={logout}>Sign out</button>
        <button className="text-button" onClick={() => onNavigate('/my-bookings')}>View my bookings</button>
      </section>
    );
  }

  return (
    <section className="page narrow">
      <p className="eyebrow">YOUR SLOTIFY ACCOUNT</p>
      <h1>Make time for what matters.</h1>
      <p className="profile-description">Create an account to reserve appointments and keep every booking in one place.</p>
      <ErrorMessage message={error} />
      <AuthForm onComplete={() => onNavigate('/')} initialMode="signin" />
    </section>
  );
}
