import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ErrorMessage } from '../components/ErrorMessage.jsx';
import { BusinessCard } from '../components/BusinessCard.jsx';

export function DirectoryPage({ onNavigate }) {
  const [businesses, setBusinesses] = useState([]);
  const [filters, setFilters] = useState({ search: '', category: '', city: '', country: '', minPrice: '', maxPrice: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 24;
  async function load(nextPage = page, activeFilters = filters) {
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ limit: String(pageSize), page: String(nextPage) });
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    try {
      const data = await api(`/directory/businesses?${query.toString()}`);
      setBusinesses(data.businesses);
      setTotal(data.total);
      setPage(nextPage);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(1); }, []);
  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  function submitFilters(event) {
    event.preventDefault();
    load(1);
  }
  const totalPages = Math.ceil(total / pageSize);
  return (
    <section className="page">
      <div className="hero"><p className="eyebrow">BOOK WITH CONFIDENCE</p><h1>Your next good appointment starts here.</h1><p className="hero-copy">Discover trusted local businesses, see real availability, and reserve a time that works for you.</p></div>
      <form className="directory-filters surface-card" onSubmit={submitFilters}>
        <div className="filter-grid">
          <label className="field">Search<input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Business or service" /></label>
          <label className="field">Category<input value={filters.category} onChange={(event) => updateFilter('category', event.target.value)} placeholder="Wellness, beauty…" /></label>
          <label className="field">City<input value={filters.city} onChange={(event) => updateFilter('city', event.target.value)} /></label>
          <label className="field">Country<input value={filters.country} onChange={(event) => updateFilter('country', event.target.value)} /></label>
          <label className="field">Minimum price<input type="number" min="0" value={filters.minPrice} onChange={(event) => updateFilter('minPrice', event.target.value)} /></label>
          <label className="field">Maximum price<input type="number" min="0" value={filters.maxPrice} onChange={(event) => updateFilter('maxPrice', event.target.value)} /></label>
        </div>
        <div className="button-row">
          <button className="primary-button" disabled={loading}>{loading ? 'Searching…' : 'Search businesses'}</button>
          <button type="button" className="secondary-button" onClick={() => { const empty = { search: '', category: '', city: '', country: '', minPrice: '', maxPrice: '' }; setFilters(empty); load(1, empty); }}>Clear filters</button>
        </div>
      </form>
      <ErrorMessage message={error} />
      <div className="section-heading"><div><p className="eyebrow">CURATED FOR YOU</p><h2>Explore businesses</h2></div><span className="result-count">{total} places</span></div>
      {loading ? <p className="loading">Finding businesses…</p> : <div className="business-grid">{businesses.map((business) => <BusinessCard key={business.id} business={business} onSelect={(slug) => onNavigate(`/businesses/${slug}`)} />)}</div>}
      {!error && businesses.length === 0 && <p className="empty-state">No businesses are listed yet.</p>}
      {totalPages > 1 && <nav className="pagination" aria-label="Business directory pages"><button className="secondary-button" disabled={page === 1 || loading} onClick={() => load(page - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary-button" disabled={page === totalPages || loading} onClick={() => load(page + 1)}>Next</button></nav>}
    </section>
  );
}
