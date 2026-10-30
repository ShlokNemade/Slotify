export function BusinessCard({ business, onSelect }) {
  return (
    <button className="business-card" onClick={() => onSelect(business.slug)}>
      <div className="card-mark">{business.name.slice(0, 1)}</div>
      <div>
        <p className="card-category">{business.category}</p>
        <h3>{business.name}</h3>
        <p className="muted">{business.location?.city}, {business.location?.country}</p>
      </div>
      <span className="arrow" aria-hidden="true">→</span>
    </button>
  );
}
