export function currentLocation() {
  return new URL(window.location.pathname + window.location.search, window.location.origin);
}

export function navigateTo(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}
