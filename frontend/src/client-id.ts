// Per-browser-tab client id, sent as X-Client-Id on every HTTP request and
// used to suppress echoing our own mutations back to this tab via the
// realtime fanout (another tab/session has a different id and still sees it).
export const clientId =
  Math.random().toString(36).slice(2) + Date.now().toString(36);
