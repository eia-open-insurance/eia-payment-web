/**
 * Cross-remote navigation for the federated shell.
 *
 * The shell owns routing and listens for `popstate`, so pushing history and
 * dispatching the event is enough to switch remotes without a full page load.
 * When history APIs are unavailable, fall back to a normal document navigation.
 */
export function navigate(target) {
  const href = String(target || '');
  if (!href) return;
  if (typeof window === 'undefined') return;

  try {
    if (!window.history || typeof window.history.pushState !== 'function') {
      window.location.assign(href);
      return;
    }
    window.history.pushState({}, '', href);
    if (typeof window.PopStateEvent === 'function') {
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      window.dispatchEvent(new Event('popstate'));
    }
  } catch {
    window.location.assign(href);
  }
}

/** Builds a shell route for another vertical, preserving the record query. */
export function recordHref(route, recordId) {
  const path = `/${String(route || '').replace(/^\/+/, '')}`;
  return recordId ? `${path}?record=${encodeURIComponent(recordId)}` : path;
}
