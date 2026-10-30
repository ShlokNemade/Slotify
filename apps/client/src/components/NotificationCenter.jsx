import { useEffect, useState } from 'react';
import { api, getSessionToken } from '../lib/api.js';

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unreadCount: 0 });
  const [authenticated, setAuthenticated] = useState(Boolean(getSessionToken()));

  useEffect(() => {
    const handleAuthChange = () => {
      setAuthenticated(Boolean(getSessionToken()));
      setData({ notifications: [], unreadCount: 0 });
    };
    window.addEventListener('slotify:auth-changed', handleAuthChange);
    if (!authenticated) return () => window.removeEventListener('slotify:auth-changed', handleAuthChange);
    let active = true;
    const load = () => api('/notifications').then((result) => {
      if (active) setData(result);
    }).catch(() => {});
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('slotify:auth-changed', handleAuthChange);
    };
  }, [authenticated]);

  async function markRead(notification) {
    if (notification.readAt) return;
    await api(`/notifications/${notification.id}/read`, { method: 'POST' }).catch(() => {});
    setData((current) => ({
      ...current,
      unreadCount: Math.max(0, current.unreadCount - 1),
      notifications: current.notifications.map((item) => item.id === notification.id
        ? { ...item, readAt: new Date().toISOString() }
        : item),
    }));
  }

  async function markAllRead() {
    await api('/notifications/read-all', { method: 'POST' });
    setData((current) => ({
      ...current,
      unreadCount: 0,
      notifications: current.notifications.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    }));
  }

  if (!authenticated) return null;
  return (
    <div className="notification-wrap">
      <button
        className="notification-button"
        aria-label={`Notifications${data.unreadCount ? `, ${data.unreadCount} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">◌</span>
        {data.unreadCount > 0 && <b>{data.unreadCount}</b>}
      </button>
      {open && (
        <div className="notification-popover" role="region" aria-label="Notifications">
          <div className="notification-title">
            <strong>Notifications</strong>
            <button onClick={markAllRead}>Mark all read</button>
          </div>
          {data.notifications.map((notification) => (
            <button
              className={`notification-item ${notification.readAt ? '' : 'unread'}`}
              key={notification.id}
              onClick={() => markRead(notification)}
            >
              <strong>{notification.title}</strong>
              <span>{notification.message}</span>
            </button>
          ))}
          {data.notifications.length === 0 && <p className="notification-empty">You’re all caught up.</p>}
        </div>
      )}
    </div>
  );
}
