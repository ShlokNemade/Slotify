import { useEffect, useState } from 'react';
import { api, formatDate, getSessionToken } from '../lib/api.js';
import { AuthForm } from '../components/AuthForm.jsx';
import { ErrorMessage } from '../components/ErrorMessage.jsx';

export function MyBookingsPage({ onNavigate }) {
  const [bookings, setBookings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (getSessionToken()) api('/bookings/my').then((data) => setBookings(data.bookings)).catch((err) => setError(err.message));
  }, []);
  async function cancel(booking) {
    if (!window.confirm('Cancel this booking?')) return;
    try {
      const data = await api(`/bookings/${booking.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by customer' }) });
      setBookings((current) => current.map((item) => item.id === booking.id ? data.booking : item));
    } catch (err) { setError(err.message); }
  }
  async function showDetails(booking) {
    if (selectedId === booking.id) {
      setSelectedId(null);
      setDetails(null);
      return;
    }
    try {
      const data = await api(`/bookings/${booking.id}`);
      setSelectedId(booking.id);
      setDetails(data.booking);
    } catch (err) { setError(err.message); }
  }
  if (!getSessionToken()) return <section className="page narrow"><h1>My bookings</h1><p className="profile-description">Sign in to see your upcoming appointments.</p><AuthForm onComplete={() => onNavigate('/my-bookings')} /></section>;
  return <section className="page"><p className="eyebrow">YOUR CALENDAR</p><h1>My bookings</h1><ErrorMessage message={error} /><div className="booking-list">{bookings.map((booking) => <article className="booking-card" key={booking.id}><div><p className="card-category">{booking.status}</p><h2>{booking.segments[0]?.service.name}</h2><p className="muted">{formatDate(booking.startTime)}</p>{selectedId === booking.id && details && <div className="booking-detail"><p>{details.segments.length} service{details.segments.length === 1 ? '' : 's'} · {details.totalPrice ?? details.segments[0]?.service.price ?? 0}</p><p className="muted">Created {formatDate(details.createdAt)}</p></div>}</div><span className="button-row"><button className="secondary-button" onClick={() => showDetails(booking)}>{selectedId === booking.id ? 'Hide details' : 'View details'}</button>{booking.status === 'confirmed' && <button className="secondary-button" onClick={() => cancel(booking)}>Cancel</button>}</span></article>)}</div>{bookings.length === 0 && <p className="empty-state">Your confirmed appointments will appear here.</p>}</section>;
}
