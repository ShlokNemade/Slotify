import { useState } from 'react';
import { api, getSessionToken } from '../lib/api.js';
import { AuthForm } from '../components/AuthForm.jsx';
import { BookingSummary } from '../components/BookingSummary.jsx';
import { ErrorMessage } from '../components/ErrorMessage.jsx';

export function ConfirmPage({ params, onNavigate }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  async function submit() {
    setSaving(true); setError('');
    try {
      const data = await api('/bookings', { method: 'POST', body: JSON.stringify({ businessId: params.get('businessId'), idempotencyKey: crypto.randomUUID(), segments: [{ serviceId: params.get('serviceId'), staffId: 'any', startTime: params.get('startTime') }] }) });
      setComplete(data.booking);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  if (!getSessionToken()) return <section className="page narrow"><h1>Sign in to book</h1><p className="profile-description">Your account keeps your appointments in one place.</p><AuthForm onComplete={() => onNavigate(window.location.pathname + window.location.search)} /></section>;
  if (complete) return <section className="page narrow confirmation"><div className="success-mark">✓</div><p className="eyebrow">YOU'RE ALL SET</p><h1>Booking confirmed.</h1><p>{params.get('service')} at {params.get('business')}</p><button className="primary-button" onClick={() => onNavigate('/my-bookings')}>View my bookings</button></section>;
  return <section className="page narrow"><button className="back-link" onClick={() => onNavigate('/')}>← Back</button><p className="eyebrow">CONFIRM YOUR TIME</p><h1>One last look.</h1><BookingSummary params={params} /><ErrorMessage message={error} /><button className="primary-button wide" disabled={saving} onClick={submit}>{saving ? 'Confirming…' : 'Confirm booking'}</button></section>;
}
