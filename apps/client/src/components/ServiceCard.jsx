export function ServiceCard({ service, selected, onSelect }) {
  return (
    <article className={`service-row ${selected ? 'selected' : ''}`}>
      <div>
        <h3>{service.name}</h3>
        <p className="muted">
          {service.durationMinutes} min · {service.price == null ? 'Price on request' : `$${service.price}`}
        </p>
      </div>
      <button className="primary-button compact" onClick={() => onSelect(service)}>Find a time</button>
    </article>
  );
}
