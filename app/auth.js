/* Staff sign-in, against Supabase Auth.
 *
 * WHY THIS IS HAND-ROLLED. The public shop needs no library at all, and adding
 * @supabase/supabase-js only for the staff screen would put a CDN in the runtime
 * path of the whole site. The auth surface we actually use is three HTTP calls,
 * so they are made directly. The trade-off is that refresh scheduling is ours to
 * get right rather than the library's; if that ever bites, swapping in
 * supabase-js is a contained change behind this module's four exports.
 *
 * Tokens are held in localStorage, which is what supabase-js does by default.
 * That means an XSS on this page can lift a session, so this app renders every
 * bit of database content with textContent and never innerHTML.
 *
 * NOTE: this authenticates a real person against Supabase Auth. It has nothing
 * to do with preview/auth.js, which is a throwaway PIN shim for the localStorage
 * prototypes and must never ship.
 */
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DEMO } from './config.js';

const KEY = 'slg_staff_session_v1';
const AUTH = `${SUPABASE_URL}/auth/v1`;

let session = null;       // { access_token, refresh_token, expires_at, user }
let refreshTimer = null;
const listeners = new Set();

/* ------------------------------------------------------------------ store */

function load() {
  if (session) return session;
  try { session = JSON.parse(localStorage.getItem(KEY)) || null; } catch { session = null; }
  return session;
}
function save(s) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* private mode: session lasts the tab, which is acceptable */ }
  scheduleRefresh();
  for (const fn of listeners) fn(s);
}

function shape(body) {
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    // expires_in is seconds from now; store an absolute so a sleeping tab is right
    expires_at: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    user: body.user || null,
  };
}

/* --------------------------------------------------------------- refresh */

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!session?.refresh_token) return;
  // A minute of headroom, and never a negative or silly-long timer.
  const due = Math.min(Math.max(session.expires_at - Date.now() - 60_000, 5_000), 45 * 60_000);
  refreshTimer = setTimeout(() => { refresh().catch(() => {}); }, due);
}

async function refresh() {
  const s = load();
  if (!s?.refresh_token) throw new Error('no session');
  const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { save(null); throw new Error('session expired'); }
  save(shape(await res.json()));
  return session;
}

/* ------------------------------------------------------------------ public */

export function onChange(fn) { listeners.add(fn); fn(load()); return () => listeners.delete(fn); }
export function currentUser() {
  if (DEMO) { try { return JSON.parse(localStorage.getItem('slg_demo_staff_v1')); } catch { return null; } }
  return load()?.user || null;
}
export function isSignedIn() {
  if (DEMO) return !!currentUser();
  return !!load()?.access_token;
}

/** A valid access token, refreshing first if it is about to expire. */
export async function accessToken() {
  const s = load();
  if (!s?.access_token) return null;
  if (s.expires_at - Date.now() < 30_000) {
    try { await refresh(); } catch { return null; }
  }
  return session?.access_token || null;
}

export async function signIn(email, password) {
  if (DEMO) {
    // No password in demo: the point is to switch between roles quickly and see
    // how the desk changes. The real path below is untouched.
    const d = await import('./demo/adapter.js');
    const u = d.demoSignIn(email);
    for (const fn of listeners) fn({ user: u });
    return { user: u };
  }
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Never distinguish "no such account" from "wrong password" to the user.
    const msg = /invalid/i.test(body.error_description || body.msg || '')
      ? 'That email address and password do not match.'
      : (body.error_description || body.msg || 'Could not sign in.');
    throw new Error(msg);
  }
  save(shape(body));
  return session;
}

export async function signOut() {
  if (DEMO) {
    const d = await import('./demo/adapter.js');
    d.demoSignOut();
    for (const fn of listeners) fn(null);
    return;
  }
  const s = load();
  if (s?.access_token) {
    // Best effort: a failed logout must still clear the device.
    try {
      await fetch(`${AUTH}/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${s.access_token}` },
      });
    } catch { /* offline */ }
  }
  save(null);
}

load();
scheduleRefresh();
