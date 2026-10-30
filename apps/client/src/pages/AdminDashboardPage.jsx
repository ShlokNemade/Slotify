import { useEffect, useState } from 'react';
import { api, formatDate, getSessionToken } from '../lib/api.js';
import { ErrorMessage } from '../components/ErrorMessage.jsx';

export function AdminDashboardPage() {
  const [businesses, setBusinesses] = useState([]);
  const [status, setStatus] = useState('pending_approval');
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError('');
    try { const data = await api(`/admin/businesses?status=${status}&limit=50`); setBusinesses(data.businesses); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);
  async function review(business, nextStatus) {
    setError('');
    try { await api(`/admin/businesses/${business.id}/review`, { method: 'POST', body: JSON.stringify({ status: nextStatus, notes: notes[business.id] ?? '' }) }); load(); } catch (err) { setError(err.message); }
  }
  if (!getSessionToken()) return <section className="page narrow"><h1>Admin review</h1><p className="profile-description">Sign in with a platform admin account to review businesses.</p></section>;
  return <section className="page"><div className="workspace-header"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Business review</h1><p className="muted">Approve complete business profiles before they appear publicly.</p></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending_approval">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All statuses</option></select></div><ErrorMessage message={error} />{loading ? <p className="loading">Loading review queue…</p> : <div className="review-list">{businesses.map((business) => <article className="review-card" key={business.id}><div className="review-card-header"><div><p className="card-category">{business.category}</p><h2>{business.name}</h2><p className="muted">{business.slug} · submitted {formatDate(business.createdAt)}</p></div><span className={`status-pill status-${business.status}`}>{business.status.replace('_', ' ')}</span></div><label className="field">Review notes<textarea rows="2" value={notes[business.id] ?? business.reviewNotes ?? ''} onChange={(e) => setNotes({ ...notes, [business.id]: e.target.value })} placeholder="Required when rejecting" /></label>{business.status === 'pending_approval' && <div className="button-row"><button className="primary-button" onClick={() => review(business, 'approved')}>Approve</button><button className="secondary-button danger-button" onClick={() => review(business, 'rejected')}>Reject</button></div>}</article>)}</div>}{!loading && businesses.length === 0 && <p className="empty-state">No businesses match this queue.</p>}</section>;
}
