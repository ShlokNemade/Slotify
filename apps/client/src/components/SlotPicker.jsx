import { formatDate } from '../lib/api.js';

export function SlotPicker({ service, profile, date, slots, error, onDateChange, onSlotSelect }) {
  return (
    <div className="booking-panel" aria-live="polite">
      <div className="panel-heading">
        <div><p className="eyebrow">BOOKING</p><h2>{service.name}</h2></div>
        <label>Date<input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => onDateChange(event.target.value)} /></label>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="slot-grid">
        {slots.map((slot) => (
          <button className="slot-button" key={slot.startTime} onClick={() => onSlotSelect(slot.startTime)}>
            {formatDate(slot.startTime, profile.timeZone)}
          </button>
        ))}
      </div>
      {!error && slots.length === 0 && <p className="empty-state">No times available on this date. Try another day.</p>}
    </div>
  );
}
