import { useState } from 'react';
import { api, setSessionToken } from '../lib/api.js';
import { ErrorMessage } from './ErrorMessage.jsx';

export function AuthForm({ onComplete }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSessionToken(data.sessionToken);
      onComplete();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <ErrorMessage message={error} />
      <button className="primary-button wide">Sign in</button>
    </form>
  );
}
