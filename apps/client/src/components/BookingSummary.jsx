import { formatDate } from '../lib/api.js';

export function BookingSummary({ params }) {
  return (
    <div className="summary-card">
      <h2>{params.get('service')}</h2>
      <p>{params.get('business')}</p>
      <p className="muted">{formatDate(params.get('startTime'), params.get('timeZone'))}</p>
    </div>
  );
}
