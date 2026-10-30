import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ErrorMessage } from '../components/ErrorMessage.jsx';
import { BusinessCard } from '../components/BusinessCard.jsx';

export function DirectoryPage({ onNavigate }) {
  const [businesses, setBusinesses] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/directory/businesses?limit=24')
      .then((data) => setBusinesses(data.businesses))
      .catch((err) => setError(err.message));
  }, []);
  return (
    <section className="page">
      <div className="hero"><p className="eyebrow">BOOK WITH CONFIDENCE</p><h1>Your next good appointment starts here.</h1><p className="hero-copy">Discover trusted local businesses, see real availability, and reserve a time that works for you.</p></div>
      <ErrorMessage message={error} />
      <div className="section-heading"><div><p className="eyebrow">CURATED FOR YOU</p><h2>Explore businesses</h2></div><span className="result-count">{businesses.length} places</span></div>
      <div className="business-grid">{businesses.map((business) => <BusinessCard key={business.id} business={business} onSelect={(slug) => onNavigate(`/businesses/${slug}`)} />)}</div>
      {!error && businesses.length === 0 && <p className="empty-state">No businesses are listed yet.</p>}
    </section>
  );
}
