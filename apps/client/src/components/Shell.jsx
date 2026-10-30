import { NotificationCenter } from './NotificationCenter.jsx';
import { useEffect, useState } from 'react';
import { api, getSessionToken } from '../lib/api.js';

export function Shell({ children, onNavigate }) {
  const [role, setRole] = useState(null);
  useEffect(() => {
    const loadRole = () => {
      if (!getSessionToken()) { setRole(null); return; }
      api('/auth/me').then((data) => setRole(data.user.role)).catch(() => setRole(null));
    };
    loadRole();
    window.addEventListener('slotify:auth-changed', loadRole);
    return () => window.removeEventListener('slotify:auth-changed', loadRole);
  }, []);
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => onNavigate('/')}>slotify<span>.</span></button>
        <nav aria-label="Primary navigation">
          <button onClick={() => onNavigate('/')}>Explore</button>
          <button onClick={() => onNavigate('/my-bookings')}>My bookings</button>
          <button onClick={() => onNavigate('/account')}>Account</button>
          {role === 'owner' && <button onClick={() => onNavigate('/owner')}>Manage</button>}
          {role === 'platform_admin' && <button onClick={() => onNavigate('/admin')}>Review</button>}
          <NotificationCenter />
        </nav>
      </header>
      <main>{children}</main>
      <footer>Make time for what matters.</footer>
    </div>
  );
}
