import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, formatDate, getSessionToken, setSessionToken } from './api.js';
import './styles.css';

function Shell({ children, onNavigate }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => onNavigate('/')}>slotify<span>.</span></button>
        <nav aria-label="Primary navigation">
          <button onClick={() => onNavigate('/')}>Explore</button>
          <button onClick={() => onNavigate('/my-bookings')}>My bookings</button>
          <NotificationCenter />
        </nav>
      </header>
      <main>{children}</main>
      <footer>Make time for what matters.</footer>
    </div>
  );
}

function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unreadCount: 0 });
  useEffect(() => {
    if (!getSessionToken()) return undefined;
    let active = true;
    const load = () => api('/notifications').then((result) => {
      if (active) setData(result);
    }).catch(() => {});
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  async function markRead(notification) {
    if (notification.readAt) return;
    await api(`/notifications/${notification.id}/read`, { method: 'POST' }).catch(() => {});
    setData((current) => ({
      ...current,
      unreadCount: Math.max(0, current.unreadCount - 1),
      notifications: current.notifications.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item),
    }));
  }
  async function markAllRead() {
    await api('/notifications/read-all', { method: 'POST' });
    setData((current) => ({
      ...current,
      unreadCount: 0,
      notifications: current.notifications.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    }));
  }
  if (!getSessionToken()) return null;
  return <div className="notification-wrap">
    <button className="notification-button" aria-label={`Notifications${data.unreadCount ? `, ${data.unreadCount} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span aria-hidden="true">◌</span>{data.unreadCount > 0 && <b>{data.unreadCount}</b>}
    </button>
    {open && <div className="notification-popover" role="region" aria-label="Notifications">
      <div className="notification-title"><strong>Notifications</strong><button onClick={markAllRead}>Mark all read</button></div>
      {data.notifications.map((notification) => <button className={`notification-item ${notification.readAt ? '' : 'unread'}`} key={notification.id} onClick={() => markRead(notification)}><strong>{notification.title}</strong><span>{notification.message}</span></button>)}
      {data.notifications.length === 0 && <p className="notification-empty">You’re all caught up.</p>}
    </div>}
  </div>;
}

function ErrorMessage({ message }) {
  return message ? <p className="error-message" role="alert">{message}</p> : null;
}

function Directory({ onNavigate }) {
  const [businesses, setBusinesses] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/directory/businesses?limit=24').then((data) => setBusinesses(data.businesses)).catch((err) => setError(err.message));
  }, []);
  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">BOOK WITH CONFIDENCE</p>
        <h1>Your next good appointment starts here.</h1>
        <p className="hero-copy">Discover trusted local businesses, see real availability, and reserve a time that works for you.</p>
      </div>
      <ErrorMessage message={error} />
      <div className="section-heading"><div><p className="eyebrow">CURATED FOR YOU</p><h2>Explore businesses</h2></div><span className="result-count">{businesses.length} places</span></div>
      <div className="business-grid">
        {businesses.map((business) => (
          <button className="business-card" key={business.id} onClick={() => onNavigate(`/businesses/${business.slug}`)}>
            <div className="card-mark">{business.name.slice(0, 1)}</div>
            <div><p className="card-category">{business.category}</p><h3>{business.name}</h3><p className="muted">{business.location?.city}, {business.location?.country}</p></div>
            <span className="arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      {!error && businesses.length === 0 && <p className="empty-state">No businesses are listed yet.</p>}
    </section>
  );
}

function Profile({ slug, onNavigate }) {
  const [profile, setProfile] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/directory/businesses/${slug}`).then((data) => setProfile(data.business)).catch((err) => setError(err.message));
  }, [slug]);
  useEffect(() => {
    if (!profile || !selectedService) return;
    setError('');
    api(`/directory/businesses/${slug}/slots?serviceId=${selectedService.id}&fromDate=${date}&toDate=${date}`)
      .then((data) => setSlots(data.slots ?? []))
      .catch((err) => setError(err.message));
  }, [profile, selectedService, date, slug]);
  if (!profile) return <section className="page"><ErrorMessage message={error} /><p className="loading">Loading profile…</p></section>;
  return (
    <section className="page">
      <button className="back-link" onClick={() => onNavigate('/')}>← Back to explore</button>
      <div className="profile-header"><div className="profile-mark">{profile.name.slice(0, 1)}</div><div><p className="eyebrow">{profile.category}</p><h1>{profile.name}</h1><p className="muted">{profile.location.address}, {profile.location.city}</p></div></div>
      <p className="profile-description">{profile.description || 'A trusted local business ready to help.'}</p>
      <div className="section-heading"><div><p className="eyebrow">SERVICES</p><h2>Choose a service</h2></div></div>
      <div className="service-list">
        {profile.services.map((service) => (
          <article className={`service-row ${selectedService?.id === service.id ? 'selected' : ''}`} key={service.id}>
            <div><h3>{service.name}</h3><p className="muted">{service.durationMinutes} min · {service.price == null ? 'Price on request' : `$${service.price}`}</p></div>
            <button className="primary-button compact" onClick={() => setSelectedService(service)}>Find a time</button>
          </article>
        ))}
      </div>
      {selectedService && <div className="booking-panel" aria-live="polite">
        <div className="panel-heading"><div><p className="eyebrow">BOOKING</p><h2>{selectedService.name}</h2></div><label>Date<input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></label></div>
        <ErrorMessage message={error} />
        <div className="slot-grid">{slots.map((slot) => <button className="slot-button" key={slot.startTime} onClick={() => onNavigate(`/confirm?businessId=${profile.id}&serviceId=${selectedService.id}&startTime=${encodeURIComponent(slot.startTime)}&business=${encodeURIComponent(profile.name)}&service=${encodeURIComponent(selectedService.name)}&timeZone=${encodeURIComponent(profile.timeZone)}`)}>{formatDate(slot.startTime, profile.timeZone)}</button>)}</div>
        {!error && slots.length === 0 && <p className="empty-state">No times available on this date. Try another day.</p>}
      </div>}
    </section>
  );
}

function Confirm({ params, onNavigate }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const data = await api('/bookings', { method: 'POST', body: JSON.stringify({ businessId: params.get('businessId'), idempotencyKey: crypto.randomUUID(), segments: [{ serviceId: params.get('serviceId'), staffId: 'any', startTime: params.get('startTime') }] }) });
      setComplete(data.booking);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  if (!getSessionToken()) return <section className="page narrow"><h1>Sign in to book</h1><p className="profile-description">Your account keeps your appointments in one place.</p><Auth onComplete={() => onNavigate(window.location.pathname + window.location.search)} /></section>;
  if (complete) return <section className="page narrow confirmation"><div className="success-mark">✓</div><p className="eyebrow">YOU'RE ALL SET</p><h1>Booking confirmed.</h1><p>{params.get('service')} at {params.get('business')}</p><button className="primary-button" onClick={() => onNavigate('/my-bookings')}>View my bookings</button></section>;
  return <section className="page narrow"><button className="back-link" onClick={() => onNavigate(`/businesses/${params.get('slug') ?? ''}`)}>← Back</button><p className="eyebrow">CONFIRM YOUR TIME</p><h1>One last look.</h1><div className="summary-card"><h2>{params.get('service')}</h2><p>{params.get('business')}</p><p className="muted">{formatDate(params.get('startTime'), params.get('timeZone'))}</p></div><ErrorMessage message={error} /><button className="primary-button wide" disabled={saving} onClick={submit}>{saving ? 'Confirming…' : 'Confirm booking'}</button></section>;
}

function Auth({ onComplete }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); try { const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); setSessionToken(data.sessionToken); onComplete(); } catch (err) { setError(err.message); } }
  return <form className="auth-form" onSubmit={submit}><label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label><ErrorMessage message={error} /><button className="primary-button wide">Sign in</button></form>;
}

function MyBookings({ onNavigate }) {
  const [bookings, setBookings] = useState([]); const [error, setError] = useState('');
  useEffect(() => { api('/bookings/my').then((data) => setBookings(data.bookings)).catch((err) => setError(err.message)); }, []);
  async function cancel(booking) { if (!window.confirm('Cancel this booking?')) return; try { const data = await api(`/bookings/${booking.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by customer' }) }); setBookings((current) => current.map((item) => item.id === booking.id ? data.booking : item)); } catch (err) { setError(err.message); } }
  if (!getSessionToken()) return <section className="page narrow"><h1>My bookings</h1><p className="profile-description">Sign in to see your upcoming appointments.</p><Auth onComplete={() => onNavigate('/my-bookings')} /></section>;
  return <section className="page"><p className="eyebrow">YOUR CALENDAR</p><h1>My bookings</h1><ErrorMessage message={error} /><div className="booking-list">{bookings.map((booking) => <article className="booking-card" key={booking.id}><div><p className="card-category">{booking.status}</p><h2>{booking.segments[0]?.service.name}</h2><p className="muted">{formatDate(booking.startTime)}</p></div>{booking.status === 'confirmed' && <button className="secondary-button" onClick={() => cancel(booking)}>Cancel</button>}</article>)}</div>{bookings.length === 0 && <p className="empty-state">Your confirmed appointments will appear here.</p>}</section>;
}

function AuthenticatedApp() {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  const navigate = (next) => { window.history.pushState({}, '', next); setPath(next); window.scrollTo(0, 0); };
  useEffect(() => { const onPop = () => setPath(window.location.pathname + window.location.search); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  const url = new URL(path, window.location.origin);
  let content = <Directory onNavigate={navigate} />;
  if (url.pathname === '/my-bookings') content = <MyBookings onNavigate={navigate} />;
  else if (url.pathname.startsWith('/businesses/')) content = <Profile slug={url.pathname.split('/')[2]} onNavigate={navigate} />;
  else if (url.pathname === '/confirm') content = <Confirm params={url.searchParams} onNavigate={navigate} />;
  return <Shell onNavigate={navigate}>{content}</Shell>;
}

Object.values({ Shell, NotificationCenter, ErrorMessage, Directory, Profile, Confirm, Auth, MyBookings, AuthenticatedApp });
createRoot(document.getElementById('root')).render(<AuthenticatedApp />);
