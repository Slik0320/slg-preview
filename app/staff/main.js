/* The trade desk: sign in, see the queue, claim an order.
 *
 * Quoting and the order detail pane are deliberately not here yet -- they are
 * built directly on the status flow, and the simplified flow migration
 * (20260827090000_simple_order_flow.sql) is written but not applied. Building
 * them twice would be waste.
 */
import * as auth from '../auth.js';
import { queue, claimOrder, releaseOrder, myRole, myStores } from './api.js';
import { ApiError } from '../api.js';
import { rands, dmy } from '../money.js';
import { DEMO } from '../config.js';

const $ = (id) => document.getElementById(id);
const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;   // never innerHTML: sessions live in localStorage
  return e;
};

const state = { role: null, stores: [], rows: [], filter: 'open', loading: false, error: '' };

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'slg_theme_v1';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('theme-toggle').textContent = t === 'dark' ? '☀' : '☾';
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
}
(function initTheme() {
  let t; try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  applyTheme(t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
})();
$('theme-toggle').addEventListener('click', () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

/* ----------------------------------------------------------------- sign in */

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('si-submit'), err = $('si-error');
  err.hidden = true;
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await auth.signIn($('si-email').value.trim(), $('si-password').value);
    await afterSignIn();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

$('signout').addEventListener('click', async () => { await auth.signOut(); paintAuth(); });
$('refresh').addEventListener('click', () => load());

async function afterSignIn() {
  try {
    state.role = await myRole();
    state.stores = await myStores();
  } catch { state.role = null; state.stores = []; }

  // A live Supabase account is not the same thing as being staff here: the
  // staff_users row is what grants a role, and without one the desk is empty.
  if (!state.role) {
    await auth.signOut();
    $('si-error').textContent = 'That account is not set up as staff on this system.';
    $('si-error').hidden = false;
    paintAuth();
    return;
  }
  paintAuth();
  load();
}

function paintAuth() {
  const on = auth.isSignedIn() && state.role;
  $('signin-view').hidden = !!on;
  $('desk-view').hidden = !on;
  $('signout').hidden = !on;
  $('who').hidden = !on;
  if (on) {
    $('who-name').textContent = auth.currentUser()?.email || '';
    $('who-role').textContent = state.stores.length
      ? `${state.role} · ${state.stores.join(', ')}`
      : String(state.role);
  }
}

/* ------------------------------------------------------------------ queue */

const OPEN = new Set(['New', 'Claimed', 'Quoted', 'Accepted', 'Picking', 'Preparing', 'Changed']);

function visible() {
  if (state.filter === 'all') return state.rows;
  if (state.filter === 'unclaimed') return state.rows.filter((r) => !r.claimed_by);
  if (state.filter === 'mine') return state.rows.filter((r) => state.stores.includes(r.claimed_by));
  return state.rows.filter((r) => OPEN.has(r.status));
}

function paintStats() {
  const r = state.rows;
  const stats = [
    ['Unclaimed', r.filter((x) => !x.claimed_by).length, 'accent'],
    ['Claimed by us', r.filter((x) => state.stores.includes(x.claimed_by)).length, ''],
    ['Quoted', r.filter((x) => x.status === 'Quoted').length, ''],
    ['Open value incl VAT', rands(r.filter((x) => OPEN.has(x.status))
      .reduce((t, x) => t + Number(x.quoted_incl ?? x.value_incl ?? 0), 0)), 'wide'],
  ];
  $('stats').replaceChildren(...stats.map(([label, value, cls]) => {
    const box = node('div', `stat ${cls}`.trim());
    box.append(node('p', 'stat-v', String(value)));
    box.append(node('p', 'stat-l', label));
    return box;
  }));
}

function paintFilters() {
  const opts = [
    ['open', 'Open'], ['unclaimed', 'Unclaimed'],
    ['mine', 'Claimed by us'], ['all', 'All'],
  ];
  $('filters').replaceChildren(...opts.map(([k, label]) => {
    const b = node('button', 'chip', label);
    b.setAttribute('aria-pressed', String(state.filter === k));
    const n = state.rows.length ? String(
      k === 'all' ? state.rows.length
      : k === 'unclaimed' ? state.rows.filter((r) => !r.claimed_by).length
      : k === 'mine' ? state.rows.filter((r) => state.stores.includes(r.claimed_by)).length
      : state.rows.filter((r) => OPEN.has(r.status)).length) : '';
    if (n) b.append(node('span', 'n', n));
    b.addEventListener('click', () => { state.filter = k; paintFilters(); paintQueue(); });
    return b;
  }));
}

/* Ageing. The bands come from app_settings on the server for the view's own
   columns; here we only colour what the view already told us. */
function ageClass(row) {
  if (row.claimed_by) return '';
  const m = Number(row.unclaimed_mins ?? row.age_mins ?? 0);
  if (m >= 30) return 'is-red';
  if (m >= 15) return 'is-amber';
  return '';
}

function row(r) {
  const el = node('article', `qrow ${ageClass(r)}`.trim());

  const a = node('div', 'q-ref');
  a.append(node('p', 'q-ref-t', r.ref));
  a.append(node('p', 'q-when', dmy(r.created_at)));
  el.append(a);

  const b = node('div', 'q-who');
  b.append(node('p', 'q-biz', r.business));
  const sub = [r.contact, r.phone].filter(Boolean).join(' · ');
  b.append(node('p', 'q-sub', sub));
  el.append(b);

  const c = node('div', 'q-meta');
  c.append(node('p', 'q-lines', `${r.line_count} line${r.line_count === 1 ? '' : 's'}`));
  c.append(node('p', 'q-fulfil', r.fulfil === 'delivery' ? 'Delivery' : 'Collection'));
  el.append(c);

  const d = node('div', 'q-money');
  d.append(node('p', 'q-total', rands(r.quoted_incl ?? r.value_incl ?? 0)));
  if (r.quoted_incl != null && r.value_incl != null && Number(r.quoted_incl) !== Number(r.value_incl)) {
    d.append(node('p', 'q-was', `was ${rands(r.value_incl)}`));
  }
  el.append(d);

  const e = node('div', 'q-state');
  const pill = node('span', `pill st-${String(r.status).toLowerCase()}`, r.status);
  e.append(pill);
  if (!r.claimed_by) {
    const mins = Number(r.unclaimed_mins ?? r.age_mins ?? 0);
    e.append(node('p', 'q-age', `waiting ${mins} min`));
  } else {
    e.append(node('p', 'q-age', r.claimed_by_name || r.claimed_by));
  }
  if (r.expired) e.append(node('p', 'q-expired', 'Quote expired'));
  el.append(e);

  el.append(actions(r));
  return el;
}

function actions(r) {
  const wrap = node('div', 'q-act');

  if (!r.claimed_by) {
    // A picker belongs to one store; a manager may cover several. Claim to the
    // store you are standing in, so offer a button per store you hold.
    for (const store of (state.stores.length ? state.stores : [])) {
      const b = node('button', 'btn-claim', state.stores.length > 1 ? `Claim · ${store}` : 'Claim');
      b.addEventListener('click', () => act(b, () => claimOrder(r.ref, store),
        'Another store claimed this order first.'));
      wrap.append(b);
    }
    if (!state.stores.length) wrap.append(node('p', 'q-note', 'No store assigned'));
  } else if (state.stores.includes(r.claimed_by) || state.role === 'admin') {
    const b = node('button', 'btn-ghost-sm', 'Release');
    b.addEventListener('click', async () => {
      const reason = prompt('Why is this order going back to the queue?\n(The reason is recorded.)');
      if (!reason || !reason.trim()) return;
      act(b, () => releaseOrder(r.ref, reason.trim()));
    });
    wrap.append(b);
  } else {
    wrap.append(node('p', 'q-note', 'Another store'));
  }
  return wrap;
}

async function act(btn, fn, conflictMsg) {
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fn();
    // claim_order() returns nothing when it loses the race -- zero rows is a
    // conflict, not an error. That is the whole point of the atomic claim.
    if (conflictMsg && (res == null || (Array.isArray(res) && !res.length))) {
      alert(conflictMsg);
    }
    await load();
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'That did not work. Please try again.');
    btn.disabled = false; btn.textContent = was;
  }
}

function paintQueue() {
  const el = $('queue');
  const rows = visible();
  el.setAttribute('aria-busy', 'false');

  if (state.error) {
    const box = node('div', 'error');
    box.append(node('h3', null, 'Could not load the queue'));
    box.append(node('p', null, state.error));
    const b = node('button', 'retry', 'Try again');
    b.addEventListener('click', () => load());
    box.append(b);
    el.replaceChildren(box);
    return;
  }
  if (!rows.length) {
    const box = node('div', 'empty');
    box.append(node('h3', null, 'Nothing in the queue'));
    box.append(node('p', null, 'Orders sent from the catalogue land here.'));
    el.replaceChildren(box);
    return;
  }
  el.replaceChildren(...rows.map(row));
}

async function load() {
  state.loading = true; state.error = '';
  $('queue').setAttribute('aria-busy', 'true');
  try {
    state.rows = await queue();
  } catch (e) {
    state.rows = [];
    state.error = e instanceof ApiError ? e.message : 'Something went wrong.';
    if (e?.code === 'expired') { await auth.signOut(); paintAuth(); return; }
  } finally {
    state.loading = false;
  }
  paintStats(); paintFilters(); paintQueue();
}

/* ------------------------------------------------------------------- boot */

async function paintDemoLogins() {
  if (!DEMO) return;
  const d = await import('../demo/adapter.js');
  const form = $('signin-form');
  if (document.getElementById('demo-logins')) return;

  const box = node('div', 'demo-logins');
  box.id = 'demo-logins';
  box.append(node('p', 'demo-logins-h', 'Demo staff — click one to sign in. No password in testing mode.'));

  for (const u of d.demoStaff()) {
    const b = node('button', 'demo-login');
    b.type = 'button';
    b.append(node('span', 'demo-login-n', u.name));
    b.append(node('span', 'demo-login-r',
      u.role === 'admin' ? 'Admin · all four stores'
      : u.role === 'manager' ? 'Manager · ' + u.stores.join(' + ')
      : 'Counter · ' + u.stores.join(', ')));
    b.addEventListener('click', async () => {
      $('si-email').value = u.email;
      await auth.signIn(u.email, '');
      await afterSignIn();
    });
    box.append(b);
  }
  form.after(box);

  // The email/password box is meaningless without a backend — hide it and let
  // the buttons be the whole story.
  form.hidden = true;
}

(async function boot() {
  if (DEMO) import('../demo/banner.js').then((m) => m.mountBanner());
  await paintDemoLogins();
  if (auth.isSignedIn()) await afterSignIn();
  else paintAuth();
})();
