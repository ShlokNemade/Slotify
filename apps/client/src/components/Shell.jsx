import { NotificationCenter } from './NotificationCenter.jsx';

export function Shell({ children, onNavigate }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => onNavigate('/')}>slotify<span>.</span></button>
        <nav aria-label="Primary navigation">
          <button onClick={() => onNavigate('/')}>Explore</button>
          <button onClick={() => onNavigate('/my-bookings')}>My bookings</button>
          <button onClick={() => onNavigate('/account')}>Account</button>
          <NotificationCenter />
        </nav>
      </header>
      <main>{children}</main>
      <footer>Make time for what matters.</footer>
    </div>
  );
}
