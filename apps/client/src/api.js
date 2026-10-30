const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export function getSessionToken() {
  return localStorage.getItem('slotify_session');
}

export function setSessionToken(token) {
  if (token) localStorage.setItem('slotify_session', token);
  else localStorage.removeItem('slotify_session');
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message ?? 'Something went wrong. Please try again.');
  }
  return body.data;
}

export function formatDate(value, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}
