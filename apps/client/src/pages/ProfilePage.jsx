import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ErrorMessage } from '../components/ErrorMessage.jsx';
import { ServiceCard } from '../components/ServiceCard.jsx';
import { SlotPicker } from '../components/SlotPicker.jsx';

export function ProfilePage({ slug, onNavigate }) {
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
  const selectSlot = (startTime) => onNavigate(`/confirm?businessId=${profile.id}&serviceId=${selectedService.id}&startTime=${encodeURIComponent(startTime)}&business=${encodeURIComponent(profile.name)}&service=${encodeURIComponent(selectedService.name)}&timeZone=${encodeURIComponent(profile.timeZone)}`);
  return (
    <section className="page">
      <button className="back-link" onClick={() => onNavigate('/')}>← Back to explore</button>
      <div className="profile-header"><div className="profile-mark">{profile.name.slice(0, 1)}</div><div><p className="eyebrow">{profile.category}</p><h1>{profile.name}</h1><p className="muted">{profile.location.address}, {profile.location.city}</p></div></div>
      <p className="profile-description">{profile.description || 'A trusted local business ready to help.'}</p>
      <div className="section-heading"><div><p className="eyebrow">SERVICES</p><h2>Choose a service</h2></div></div>
      <div className="service-list">{profile.services.map((service) => <ServiceCard key={service.id} service={service} selected={selectedService?.id === service.id} onSelect={setSelectedService} />)}</div>
      {selectedService && <SlotPicker service={selectedService} profile={profile} date={date} slots={slots} error={error} onDateChange={setDate} onSlotSelect={selectSlot} />}
    </section>
  );
}
