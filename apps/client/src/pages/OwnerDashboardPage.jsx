import { useEffect, useMemo, useState } from 'react';
import { api, formatDate, getSessionToken } from '../lib/api.js';
import { ErrorMessage } from '../components/ErrorMessage.jsx';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const emptyHours = () => Object.fromEntries(DAYS.map((day) => [day, { isOpen: false, windows: [] }]));

function Field({ label, children }) {
  return <label className="field">{label}{children}</label>;
}

function BusinessForm({ business, onSaved }) {
  const [form, setForm] = useState(() => business ? { ...business, location: { ...business.location } } : {
    name: '', slug: '', category: '', description: '', timeZone: 'UTC',
    location: { address: '', city: '', country: '' },
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateLocation = (key, value) => setForm((current) => ({ ...current, location: { ...current.location, [key]: value } }));

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const path = business ? `/businesses/${business.id}` : '/businesses';
      const data = await api(path, { method: business ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      onSaved(data.business);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  return (
    <form className="manage-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Business name"><input required value={form.name} onChange={(e) => update('name', e.target.value)} /></Field>
        <Field label="URL slug"><input required value={form.slug} onChange={(e) => update('slug', e.target.value)} /></Field>
        <Field label="Category"><input required value={form.category} onChange={(e) => update('category', e.target.value)} /></Field>
        <Field label="Time zone"><input required value={form.timeZone} onChange={(e) => update('timeZone', e.target.value)} /></Field>
        <Field label="Address"><input required value={form.location.address} onChange={(e) => updateLocation('address', e.target.value)} /></Field>
        <Field label="City"><input required value={form.location.city} onChange={(e) => updateLocation('city', e.target.value)} /></Field>
        <Field label="Country"><input required value={form.location.country} onChange={(e) => updateLocation('country', e.target.value)} /></Field>
      </div>
      <Field label="Description"><textarea rows="3" value={form.description} onChange={(e) => update('description', e.target.value)} /></Field>
      <ErrorMessage message={error} />
      <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : business ? 'Save profile' : 'Create business'}</button>
    </form>
  );
}

function HoursForm({ business, onSaved }) {
  const [hours, setHours] = useState(business.hours ?? emptyHours());
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); setError('');
    try {
      const data = await api(`/businesses/${business.id}`, { method: 'PATCH', body: JSON.stringify({ hours }) });
      onSaved(data.business);
    } catch (err) { setError(err.message); }
  }
  return (
    <form className="manage-form" onSubmit={save}>
      <div className="hours-grid">
        {DAYS.map((day) => (
          <div className="hours-row" key={day}>
            <label><input type="checkbox" checked={Boolean(hours[day]?.isOpen)} onChange={(e) => setHours((current) => ({ ...current, [day]: { ...current[day], isOpen: e.target.checked, windows: e.target.checked ? (current[day]?.windows?.length ? current[day].windows : [{ open: '09:00', close: '17:00' }]) : [] } }))} /> {day}</label>
            <input type="time" disabled={!hours[day]?.isOpen} value={hours[day]?.windows?.[0]?.open ?? ''} onChange={(e) => setHours((current) => ({ ...current, [day]: { ...current[day], windows: [{ ...(current[day]?.windows?.[0] ?? {}), open: e.target.value }] } }))} />
            <span>to</span>
            <input type="time" disabled={!hours[day]?.isOpen} value={hours[day]?.windows?.[0]?.close ?? ''} onChange={(e) => setHours((current) => ({ ...current, [day]: { ...current[day], windows: [{ ...(current[day]?.windows?.[0] ?? {}), close: e.target.value }] } }))} />
          </div>
        ))}
      </div>
      <ErrorMessage message={error} />
      <button className="primary-button">Save hours</button>
    </form>
  );
}

function ServicesPanel({ businessId }) {
  const [services, setServices] = useState([]);
  const [form, setForm] = useState({ name: '', description: '', durationMinutes: 60, price: 0 });
  const [error, setError] = useState('');
  const load = () => api(`/businesses/${businessId}/services`).then((data) => setServices(data.services)).catch((err) => setError(err.message));
  useEffect(load, [businessId]);
  async function submit(event) {
    event.preventDefault(); setError('');
    try {
      await api(`/businesses/${businessId}/services`, { method: 'POST', body: JSON.stringify({ ...form, durationMinutes: Number(form.durationMinutes), price: Number(form.price), active: true, eligibleStaffIds: [] }) });
      setForm({ name: '', description: '', durationMinutes: 60, price: 0 }); load();
    } catch (err) { setError(err.message); }
  }
  async function deactivate(service) {
    if (!window.confirm(`Deactivate ${service.name}?`)) return;
    try { await api(`/businesses/${businessId}/services/${service.id}`, { method: 'DELETE' }); load(); } catch (err) { setError(err.message); }
  }
  return <div className="manage-section">
    <form className="inline-form" onSubmit={submit}><Field label="Service name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Minutes"><input type="number" min="5" required value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} /></Field><Field label="Price"><input type="number" min="0" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field><button className="primary-button">Add service</button></form>
    <ErrorMessage message={error} />
    <div className="manage-list">{services.map((service) => <article className="manage-card" key={service.id}><div><strong>{service.name}</strong><p className="muted">{service.durationMinutes} min · {service.price ?? 0}</p></div>{service.active && <button className="secondary-button" onClick={() => deactivate(service)}>Deactivate</button>}</article>)}</div>
  </div>;
}

function StaffPanel({ businessId }) {
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({ displayName: '', email: '' });
  const [error, setError] = useState('');
  const load = () => api(`/businesses/${businessId}/staff`).then((data) => setStaff(data.staff)).catch((err) => setError(err.message));
  useEffect(load, [businessId]);
  async function submit(event) {
    event.preventDefault(); setError('');
    try { await api(`/businesses/${businessId}/staff`, { method: 'POST', body: JSON.stringify({ ...form, active: true, qualifications: [], shifts: [], breaks: [], leave: [] }) }); setForm({ displayName: '', email: '' }); load(); } catch (err) { setError(err.message); }
  }
  async function deactivate(member) {
    try { await api(`/businesses/${businessId}/staff/${member.id}`, { method: 'DELETE' }); load(); } catch (err) { setError(err.message); }
  }
  return <div className="manage-section">
    <form className="inline-form" onSubmit={submit}><Field label="Staff name"><input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field><Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><button className="primary-button">Add staff</button></form>
    <ErrorMessage message={error} />
    <div className="manage-list">{staff.map((member) => <article className="manage-card" key={member.id}><div><strong>{member.displayName}</strong><p className="muted">{member.email || 'No email'} · {member.active ? 'Active' : 'Inactive'}</p></div>{member.active && <button className="secondary-button" onClick={() => deactivate(member)}>Deactivate</button>}</article>)}</div>
  </div>;
}

function ExceptionsPanel({ business, services, staff }) {
  const [exceptions, setExceptions] = useState([]);
  const [form, setForm] = useState({ date: '', reason: '', isOpen: false });
  const [error, setError] = useState('');
  const load = () => api(`/businesses/${business.id}/exceptions`).then((data) => setExceptions(data.exceptions)).catch((err) => setError(err.message));
  useEffect(load, [business.id]);
  async function submit(event) {
    event.preventDefault(); setError('');
    try { await api(`/businesses/${business.id}/exceptions`, { method: 'POST', body: JSON.stringify(form) }); setForm({ date: '', reason: '', isOpen: false }); load(); } catch (err) { setError(err.message); }
  }
  async function remove(exception) {
    try { await api(`/businesses/${business.id}/exceptions/${exception.id}`, { method: 'DELETE' }); load(); } catch (err) { setError(err.message); }
  }
  return <div className="manage-section">
    <form className="inline-form" onSubmit={submit}><Field label="Date"><input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Reason"><input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field><label className="checkbox-field"><input type="checkbox" checked={form.isOpen} onChange={(e) => setForm({ ...form, isOpen: e.target.checked })} /> Override open</label><button className="primary-button">Add exception</button></form>
    <ErrorMessage message={error} />
    <div className="manage-list">{exceptions.map((exception) => <article className="manage-card" key={exception.id}><div><strong>{exception.date || formatDate(exception.startDateTime, business.timeZone)}</strong><p className="muted">{exception.reason}</p></div><button className="secondary-button" onClick={() => remove(exception)}>Remove</button></article>)}</div>
    <p className="muted small-note">Exceptions never cancel existing bookings; conflicts are returned as warnings by the API.</p>
    <span className="sr-only">{services.length + staff.length}</span>
  </div>;
}

function AvailabilityPanel({ business, services, staff }) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { if (!services.some((service) => service.id === serviceId)) setServiceId(services[0]?.id ?? ''); }, [services, serviceId]);
  async function preview() {
    setError('');
    try { setResult(await api(`/businesses/${business.id}/availability?serviceId=${serviceId}&fromDate=${date}&toDate=${date}`)); } catch (err) { setError(err.message); }
  }
  return <div className="manage-section">
    <div className="inline-form"><Field label="Service"><select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><button className="primary-button" disabled={!serviceId} onClick={preview}>Preview slots</button></div>
    <ErrorMessage message={error} />
    {result && <div className="availability-result"><p className="muted">{result.anyStaffSlots.length} available starts · {result.timeZone}</p><div className="slot-grid">{result.anyStaffSlots.map((slot) => <span className="slot-chip" key={slot}>{formatDate(slot, result.timeZone)}</span>)}</div></div>}
    <p className="muted small-note">{staff.length} staff members included in this preview.</p>
  </div>;
}

function BookingsPanel({ business }) {
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');
  const load = () => api(`/businesses/${business.id}/bookings`).then((data) => setBookings(data.bookings)).catch((err) => setError(err.message));
  useEffect(load, [business.id]);
  async function update(booking, status) {
    try { await api(`/businesses/${business.id}/bookings/${booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); load(); } catch (err) { setError(err.message); }
  }
  return <div className="manage-section"><ErrorMessage message={error} /><div className="manage-list">{bookings.map((booking) => <article className="manage-card" key={booking.id}><div><strong>{booking.segments[0]?.service.name || 'Appointment'}</strong><p className="muted">{formatDate(booking.startTime, business.timeZone)} · {booking.status}</p></div>{booking.status === 'confirmed' && <span className="button-row"><button className="secondary-button" onClick={() => update(booking, 'completed')}>Complete</button><button className="secondary-button" onClick={() => update(booking, 'no_show')}>No show</button></span>}</article>)}</div>{bookings.length === 0 && <p className="empty-state">No appointments yet.</p>}</div>;
}

export function OwnerDashboardPage({ onNavigate }) {
  const [businesses, setBusinesses] = useState([]);
  const [business, setBusiness] = useState(null);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadBusinesses = () => api('/businesses/owned').then((data) => { setBusinesses(data.businesses); setBusiness((current) => current ? data.businesses.find((item) => item.id === current.id) ?? data.businesses[0] : data.businesses[0]); }).catch((err) => setError(err.message)).finally(() => setLoading(false));
  useEffect(() => {
    loadBusinesses();
  }, []);
  useEffect(() => {
    if (!business) return;
    Promise.all([api(`/businesses/${business.id}/services`), api(`/businesses/${business.id}/staff`)])
      .then(([serviceData, staffData]) => { setServices(serviceData.services); setStaff(staffData.staff); })
      .catch((err) => setError(err.message));
  }, [business]);
  const refreshBusiness = (updated) => { setBusiness(updated); setBusinesses((current) => current.map((item) => item.id === updated.id ? updated : item)); };

  if (!getSessionToken()) return <section className="page narrow"><h1>Owner workspace</h1><p className="profile-description">Sign in with an owner account to manage your business.</p><button className="primary-button wide" onClick={() => onNavigate('/account')}>Go to account</button></section>;
  if (loading) return <section className="page"><p className="loading">Loading workspace…</p></section>;
  if (!business) return <section className="page narrow"><p className="eyebrow">OWNER WORKSPACE</p><h1>Set up your business.</h1><p className="profile-description">Create your first business profile, then add services and staff before submitting it for review.</p><BusinessForm onSaved={(created) => { setBusinesses([created]); setBusiness(created); }} /><ErrorMessage message={error} /></section>;

  const tabs = [['overview', 'Overview'], ['services', 'Services'], ['staff', 'Staff'], ['exceptions', 'Schedule blocks'], ['availability', 'Slot preview'], ['bookings', 'Appointments']];
  return <section className="page">
    <div className="workspace-header"><div><p className="eyebrow">OWNER WORKSPACE</p><h1>{business.name}</h1><p className="muted">{business.status.replace('_', ' ')} · {business.location.city}, {business.location.country}</p></div><select value={business.id} onChange={(e) => setBusiness(businesses.find((item) => item.id === e.target.value))}>{businesses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <nav className="workspace-tabs" aria-label="Business management"><div>{tabs.map(([value, label]) => <button className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{label}</button>)}</div></nav>
    {tab === 'overview' && <div className="workspace-columns"><div className="surface-card"><h2>Business profile</h2><BusinessForm business={business} onSaved={refreshBusiness} /></div><div className="surface-card"><h2>Operating hours</h2><HoursForm business={business} onSaved={refreshBusiness} /><div className="review-actions">{business.status === 'draft' || business.status === 'rejected' ? <SubmitButton business={business} onSaved={refreshBusiness} /> : <p className="muted">Review status: {business.status.replace('_', ' ')}</p>}</div></div></div>}
    {tab === 'services' && <div className="surface-card"><h2>Services</h2><ServicesPanel businessId={business.id} /></div>}
    {tab === 'staff' && <div className="surface-card"><h2>Staff</h2><StaffPanel businessId={business.id} /></div>}
    {tab === 'exceptions' && <div className="surface-card"><h2>Schedule blocks</h2><ExceptionsPanel business={business} services={services} staff={staff} /></div>}
    {tab === 'availability' && <div className="surface-card"><h2>Availability preview</h2><AvailabilityPanel business={business} services={services} staff={staff} /></div>}
    {tab === 'bookings' && <div className="surface-card"><h2>Appointments</h2><BookingsPanel business={business} /></div>}
  </section>;
}

function SubmitButton({ business, onSaved }) {
  const [error, setError] = useState('');
  async function submit() {
    try { const data = await api(`/businesses/${business.id}/submit`, { method: 'POST' }); onSaved(data.business); } catch (err) { setError(err.message); }
  }
  return <div><button className="primary-button" onClick={submit}>Submit for review</button><ErrorMessage message={error} /></div>;
}
