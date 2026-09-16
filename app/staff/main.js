/* The trade desk: sign in, see the queue, open an order, claim it, quote it,
 * send the quote, take it through preparing to fulfilled, and pick it.
 *
 * The status machine and the role gate are enforced in the database; this
 * screen only shows the actions the signed-in person is allowed to take, so
 * what a picker sees is narrower than what a manager sees.
 */
import * as auth from '../auth.js';
import * as api from './api.js';
import { ApiError } from '../api.js';
import { rands, dmy, unitLabel } from '../money.js';
import { DEMO } from '../config.js';
import { TIERS, OPEN_STATUSES } from '../rules.js';

const $ = (id) => document.getElementById(id);
const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;   // never innerHTML: sessions live in localStorage
  return e;
};
const STORE_NAME = { s1: 'Thokoza', s2: 'Nhlapo', s3: 'Mosiliki', s4: 'Rondebult' };

const state = { role: null, stores: [], rows: [], filter: 'open', error: '', open: null, detail: null, pick: null, busy: false };
const isManager = () => state.role === 'admin' || state.role === 'manager';
const isAdmin   = () => state.role === 'admin';
const mine      = (o) => state.stores.includes(o.claimed_by) || isAdmin();

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
  err.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
  try { await auth.signIn($('si-email').value.trim(), $('si-password').value); await afterSignIn(); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});
$('signout').addEventListener('click', async () => { await auth.signOut(); state.role = null; closeDetail(); paintAuth(); });
$('refresh').addEventListener('click', () => load());

async function afterSignIn() {
  try { state.role = await api.myRole(); state.stores = await api.myStores(); }
  catch { state.role = null; state.stores = []; }
  if (!state.role) {
    await auth.signOut();
    $('si-error').textContent = 'That account is not set up as staff on this system.';
    $('si-error').hidden = false; paintAuth(); return;
  }
  paintAuth(); load();
}
function paintAuth() {
  const on = auth.isSignedIn() && state.role;
  $('signin-view').hidden = !!on; $('desk-view').hidden = !on;
  $('signout').hidden = !on; $('who').hidden = !on;
  if (on) {
    const u = auth.currentUser();
    $('who-name').textContent = u?.name || u?.email || '';
    $('who-role').textContent = `${state.role} · ${state.stores.map((s) => STORE_NAME[s] || s).join(', ')}`;
  }
}

/* ------------------------------------------------------------------ queue */
function visible() {
  if (state.filter === 'all') return state.rows;
  if (state.filter === 'unclaimed') return state.rows.filter((r) => !r.claimed_by);
  if (state.filter === 'mine') return state.rows.filter((r) => state.stores.includes(r.claimed_by));
  if (state.filter === 'attention') return state.rows.filter((r) => r.status === 'Changed' || r.status === 'Accepted');
  return state.rows.filter((r) => OPEN_STATUSES.has(r.status));
}
function paintStats() {
  const r = state.rows;
  const stats = [
    ['Unclaimed', r.filter((x) => !x.claimed_by && x.status === 'New').length, 'accent'],
    ['Needs a re-quote', r.filter((x) => x.status === 'Changed').length, r.some((x) => x.status === 'Changed') ? 'warn' : ''],
    ['Accepted, to prepare', r.filter((x) => x.status === 'Accepted').length, ''],
    ['Open value incl VAT', rands(r.filter((x) => OPEN_STATUSES.has(x.status))
      .reduce((t, x) => t + Number(x.quoted_incl ?? x.value_incl ?? 0) + Number(x.delivery_fee_incl || 0), 0)), 'wide'],
  ];
  $('stats').replaceChildren(...stats.map(([label, value, cls]) => {
    const box = node('div', `stat ${cls}`.trim());
    box.append(node('p', 'stat-v', String(value)), node('p', 'stat-l', label));
    return box;
  }));
}
function paintFilters() {
  const opts = [['open', 'Open'], ['unclaimed', 'Unclaimed'], ['attention', 'Needs action'], ['mine', 'Claimed by us'], ['all', 'All']];
  $('filters').replaceChildren(...opts.map(([k, label]) => {
    const b = node('button', 'chip', label);
    b.setAttribute('aria-pressed', String(state.filter === k));
    const save = state.filter; state.filter = k; const n = visible().length; state.filter = save;
    if (state.rows.length) b.append(node('span', 'n', String(n)));
    b.addEventListener('click', () => { state.filter = k; paintFilters(); paintQueue(); });
    return b;
  }));
}
function ageClass(row) {
  if (row.claimed_by || row.status !== 'New') return '';
  const m = Number(row.unclaimed_mins ?? row.age_mins ?? 0);
  return m >= 30 ? 'is-red' : m >= 15 ? 'is-amber' : '';
}
function pill(status) { return node('span', `pill st-${String(status).toLowerCase()}`, status); }

function row(r) {
  const el = node('article', `qrow ${ageClass(r)}`.trim());
  el.tabIndex = 0; el.setAttribute('role', 'button');
  el.addEventListener('click', (e) => { if (!e.target.closest('button')) openDetail(r.ref); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(r.ref); });

  const a = node('div', 'q-ref');
  a.append(node('p', 'q-ref-t', r.ref), node('p', 'q-when', dmy(r.created_at) + (r.version > 1 ? ` · v${r.version}` : '')));
  el.append(a);

  const b = node('div', 'q-who');
  b.append(node('p', 'q-biz', r.business), node('p', 'q-sub', [r.contact, r.phone].filter(Boolean).join(' · ')));
  el.append(b);

  const c = node('div', 'q-meta');
  c.append(node('p', 'q-lines', `${r.line_count} line${r.line_count === 1 ? '' : 's'}`));
  c.append(node('p', 'q-fulfil', r.fulfil === 'delivery' ? 'Delivery' : `Collect · ${r.preferred_store_name || STORE_NAME[r.preferred_store] || '—'}`));
  el.append(c);

  const d = node('div', 'q-money');
  d.append(node('p', 'q-total', rands(Number(r.quoted_incl ?? r.value_incl ?? 0) + Number(r.delivery_fee_incl || 0))));
  if (r.quoted_incl != null && r.value_incl != null && Number(r.quoted_incl) !== Number(r.value_incl)) d.append(node('p', 'q-was', `goods were ${rands(r.value_incl)}`));
  el.append(d);

  const e = node('div', 'q-state');
  e.append(pill(r.status));
  if (!r.claimed_by) e.append(node('p', 'q-age', `waiting ${Number(r.unclaimed_mins ?? r.age_mins ?? 0)} min`));
  else e.append(node('p', 'q-age', r.claimed_by_name || STORE_NAME[r.claimed_by] || r.claimed_by));
  el.append(e);

  const act = node('div', 'q-act');
  const view = node('button', 'btn-ghost-sm', 'View');
  view.addEventListener('click', () => openDetail(r.ref));
  act.append(view);
  el.append(act);
  return el;
}

function paintQueue() {
  const el = $('queue'); el.setAttribute('aria-busy', 'false');
  if (state.error) {
    const box = node('div', 'error'); box.append(node('h3', null, 'Could not load the queue'), node('p', null, state.error));
    const b = node('button', 'retry', 'Try again'); b.addEventListener('click', () => load()); box.append(b);
    el.replaceChildren(box); return;
  }
  const rows = visible();
  if (!rows.length) { const box = node('div', 'empty'); box.append(node('h3', null, 'Nothing here'), node('p', null, 'Orders sent from the catalogue land in the queue.')); el.replaceChildren(box); return; }
  el.replaceChildren(...rows.map(row));
}
async function load() {
  state.error = ''; $('queue').setAttribute('aria-busy', 'true');
  try { state.rows = await api.queue(); }
  catch (e) { state.rows = []; state.error = e instanceof ApiError ? e.message : 'Something went wrong.'; if (e?.code === 'expired') { await auth.signOut(); paintAuth(); return; } }
  paintStats(); paintFilters(); paintQueue();
  if (state.open) refreshDetail();
}

/* ============================================================ detail pane
   Read-only for anything you have not claimed, so a store can judge an order
   before taking it. Full quoting controls once it is yours. */

let root = null;
function ensureRoot() {
  if (root) return root;
  root = node('div', 'drawer-root');
  root.addEventListener('click', (e) => { if (e.target === root) closeDetail(); });
  document.body.append(root);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open) closeDetail(); });
  return root;
}
function closeDetail() { state.open = null; state.detail = null; state.pick = null; if (root) { root.replaceChildren(); root.classList.remove('is-open'); } document.body.style.overflow = ''; }
async function openDetail(ref) { state.open = ref; state.pick = null; document.body.style.overflow = 'hidden'; await refreshDetail(); }
async function refreshDetail() {
  if (!state.open) return;
  try { state.detail = await api.orderDetail(state.open); }
  catch (e) { alert(e.message); closeDetail(); return; }
  paintDetail();
}

async function act(btn, fn, okMsg) {
  if (state.busy) return; state.busy = true;
  const was = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try { const res = await fn(); if (okMsg && Array.isArray(res) && !res.length) alert(okMsg); await load(); }
  catch (e) { alert(e instanceof ApiError || e?.message ? e.message : 'That did not work. Please try again.'); if (btn) { btn.disabled = false; btn.textContent = was; } }
  finally { state.busy = false; }
}

function paintDetail() {
  const d = state.detail; if (!d) return;
  const r = ensureRoot();
  const panel = node('aside', 'drawer drawer-wide'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');

  /* header */
  const hd = node('div', 'drawer-hd');
  const t = node('div', null);
  const h = node('h2', null, ''); h.append(node('span', 'mono', d.ref), document.createTextNode(' '), pill(d.status));
  t.append(h);
  t.append(node('p', 'drawer-sub', `${d.business} · ${d.contact} · ${d.phone}`));
  hd.append(t);
  const x = node('button', 'drawer-x', '×'); x.addEventListener('click', closeDetail); hd.append(x);
  panel.append(hd);

  if (state.pick) { panel.append(pickingView(d)); r.replaceChildren(panel); r.classList.add('is-open'); return; }

  const body = node('div', 'd-body');

  /* facts */
  const facts = node('div', 'd-facts');
  const fact = (k, v) => { const f = node('div', 'd-fact'); f.append(node('span', 'd-k', k), node('span', 'd-v', v)); facts.append(f); };
  fact('Fulfilment', d.fulfil === 'delivery' ? 'Delivery' : `Collection from ${d.preferred_store_name || STORE_NAME[d.preferred_store] || '—'}`);
  fact('Placed', dmy(d.created_at));
  fact('Version', `v${d.version}${d.version > 1 ? ' — customer changed it' : ''}`);
  fact('Claimed by', d.claimed_by_name || STORE_NAME[d.claimed_by] || 'Nobody yet');
  if (d.price_tier && d.price_tier !== 'retail') fact('Tier', (TIERS.find((x) => x.key === d.price_tier) || {}).label || d.price_tier);
  body.append(facts);

  const canQuote = isManager() && mine(d) && ['Claimed', 'Changed'].includes(d.status);
  const canEditLines = canQuote;

  /* what changed */
  if (d.version > 1 && d.status === 'Changed') body.append(whatChanged(d));

  /* tier picker */
  if (canQuote) {
    const tb = node('div', 'd-tier');
    tb.append(node('span', 'd-k', 'Price tier for the whole order'));
    const seg = node('div', 'seg');
    for (const tier of TIERS) {
      const b = node('button', 'seg-btn'); b.type = 'button';
      b.append(node('span', null, tier.label));
      if (tier.pct) b.append(node('small', null, ` −${tier.pct}%`));
      b.title = tier.note;
      b.setAttribute('aria-pressed', String((d.price_tier || 'retail') === tier.key));
      b.addEventListener('click', () => act(b, () => api.quoteOrder(d.ref, tier.key, d.version)));
      seg.append(b);
    }
    tb.append(seg);
    tb.append(node('p', 'fine', 'Price 2 and Price 3 are placeholder percentages until IQ supplies real per-product prices — lines priced from them are marked estimated. A price you type by hand is never moved by the tier.'));
    body.append(tb);
  }

  /* lines */
  const tbl = node('table', 'd-lines');
  const thead = node('thead'); const trh = node('tr');
  for (const hcell of ['Stock code', 'Product', 'Pack', 'Qty', 'Price 1', canEditLines || d.status !== 'New' ? 'Quoted' : '', 'Line', canEditLines ? '' : null].filter((c) => c !== null)) trh.append(node('th', null, hcell));
  thead.append(trh); tbl.append(thead);
  const tbody = node('tbody');
  for (const l of d.lines) {
    const tr = node('tr', l.price_overridden || l.qty_overridden ? 'is-edited' : '');
    tr.append(node('td', 'mono', l.sku_code));
    const pd = node('td', null); pd.append(node('span', null, l.source_desc)); if (l.deposit_incl) pd.append(node('small', 'd-dep', ` · deposit ${rands(l.qty * l.deposit_incl)} refundable`)); tr.append(pd);
    tr.append(node('td', null, unitLabel(l)));
    // qty
    const tq = node('td', 'num');
    if (canEditLines) { const q = node('input', 'd-in'); q.type = 'number'; q.min = '1'; q.value = String(l.qty); q.addEventListener('change', (e) => act(null, () => api.setLineQty(d.ref, l.id, e.target.value, d.version))); tq.append(q); }
    else tq.textContent = String(l.qty);
    if (l.qty_overridden) tq.append(node('span', 'edited', 'edited'));
    tr.append(tq);
    tr.append(node('td', 'num', rands(l.price_incl)));
    // quoted price
    const tp = node('td', 'num');
    if (canEditLines) {
      const p = node('input', 'd-in'); p.type = 'number'; p.step = '0.01'; p.min = '0'; p.value = l.quoted_price != null ? Number(l.quoted_price).toFixed(2) : '';
      p.placeholder = Number(l.price_incl).toFixed(2);
      p.addEventListener('change', (e) => act(null, () => api.setLinePrice(d.ref, l.id, e.target.value, d.version)));
      tp.append(p);
    } else if (d.status !== 'New') tp.textContent = l.quoted_price != null ? rands(l.quoted_price) : '—';
    if (l.price_overridden) tp.append(node('span', 'edited', 'by hand'));
    else if (l.quoted_estimated) tp.append(node('span', 'est', 'estimated'));
    tr.append(tp);
    tr.append(node('td', 'num strong', rands(l.qty * Number(l.quoted_price ?? l.price_incl))));
    if (canEditLines) {
      const td = node('td', null); const rm = node('button', 'line-del', '×'); rm.title = 'Remove this line';
      rm.addEventListener('click', () => { if (confirm(`Remove ${l.sku_code} from this order?`)) act(rm, () => api.removeLine(d.ref, l.id, d.version)); });
      td.append(rm); tr.append(td);
    }
    tbody.append(tr);
  }
  tbl.append(tbody);
  const wrap = node('div', 'd-tbl'); wrap.append(tbl); body.append(wrap);

  /* totals */
  const T = d.totals || {};
  const tot = node('div', 'd-totals');
  const trow = (k, v, cls) => { const e = node('div', 'trow ' + (cls || '')); e.append(node('span', null, k), node('b', null, rands(v))); tot.append(e); };
  trow('Goods at Price 1', T.original_incl);
  trow('Goods as quoted', T.adjusted_incl);
  trow('Difference', T.difference, Number(T.difference) < 0 ? 'is-neg' : '');
  if (T.delivery_fee_incl) trow('Delivery — flat', T.delivery_fee_incl);
  if (T.deposit_incl) trow('Deposit expected back (crates & empties)', T.deposit_incl, 'is-dep');
  trow('Total to the customer', T.grand_incl, 'is-total');
  body.append(tot);

  /* actions */
  body.append(actions(d));

  /* history */
  if (d.events?.length) {
    const ev = node('div', 'd-events'); ev.append(node('h4', null, 'History'));
    for (const e of d.events.slice(0, 12)) { const li = node('div', 'd-ev'); li.append(node('span', 'd-ev-t', new Date(e.at).toLocaleString('en-ZA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), node('span', null, `${e.action}${e.detail ? ' — ' + e.detail : ''}${e.by ? ' · ' + e.by : ''}`)); ev.append(li); }
    body.append(ev);
  }

  panel.append(body);
  r.replaceChildren(panel); r.classList.add('is-open');
}

function whatChanged(d) {
  const box = node('div', 'd-diff'); box.append(node('h4', null, `What the customer changed (v${d.version - 1} → v${d.version})`));
  api.versionDiff(d.ref).then((diff) => {
    const ul = node('ul');
    for (const a of diff.added || []) ul.append(node('li', 'add', `Added ${a.code} × ${a.qty} — ${a.desc}`));
    for (const c of diff.changed || []) ul.append(node('li', 'chg', `${c.code}: ${c.qty_from} → ${c.qty_to} — ${c.desc}`));
    for (const x of diff.removed || []) ul.append(node('li', 'rem', `Removed ${x.code} — ${x.desc}`));
    if (!ul.children.length) ul.append(node('li', null, 'No line changes.'));
    box.append(ul);
    box.append(node('p', 'fine', 'Anything added came in at Price 1 and needs pricing. Set the tier or type prices, then send the quote again.'));
  });
  return box;
}

function actions(d) {
  const bar = node('div', 'd-actions');
  const btn = (label, cls, fn, conf) => { const b = node('button', cls, label); b.addEventListener('click', () => { if (conf && !confirm(conf)) return; act(b, fn); }); bar.append(b); return b; };
  const claimable = !d.claimed_by && d.status === 'New';

  if (claimable) {
    const allowed = d.fulfil === 'collect' && d.preferred_store ? state.stores.filter((s) => s === d.preferred_store || isAdmin() ? true : false) : state.stores;
    const stores = d.fulfil === 'collect' && d.preferred_store && !isAdmin() ? state.stores.filter((s) => s === d.preferred_store) : state.stores;
    if (!stores.length) bar.append(node('p', 'q-note', d.fulfil === 'collect' ? `Collection from ${d.preferred_store_name || STORE_NAME[d.preferred_store]} — only that store can claim it.` : 'No store assigned to you.'));
    for (const s of stores) btn(stores.length > 1 ? `Claim for ${STORE_NAME[s]}` : 'Claim this order', 'btn-claim',
      () => api.claimOrder(d.ref, s).then((res) => { if (!res?.length) alert('Another store claimed this order first.'); return res; }));
    if (isManager()) btn('Decline', 'btn-ghost-sm danger', () => api.setStatus(d.ref, 'Declined', prompt('Reason for declining (recorded):') || 'declined'), null);
    void allowed;
    return bar;
  }
  if (!mine(d)) { bar.append(node('p', 'q-note', `Claimed by ${d.claimed_by_name || STORE_NAME[d.claimed_by]} — read only.`)); return bar; }

  switch (d.status) {
    case 'Claimed':
    case 'Changed':
      if (isManager()) btn(d.status === 'Changed' ? 'Send revised quote' : 'Send quote to customer', 'btn-claim', () => api.sendQuote(d.ref, d.version));
      else bar.append(node('p', 'q-note', 'Quoting is a manager’s call. A picker can release, prepare and fulfil.'));
      btn('Release to queue', 'btn-ghost-sm', () => { const why = prompt('Why is this going back to the queue? (recorded)'); if (!why) throw new Error('A reason is required.'); return api.releaseOrder(d.ref, why); });
      if (isManager()) btn('Decline', 'btn-ghost-sm danger', () => api.setStatus(d.ref, 'Declined', prompt('Reason (recorded):') || 'declined'));
      break;
    case 'Quoted':
      bar.append(node('p', 'q-note', 'Waiting for the customer to accept or change the quote.'));
      if (DEMO) { const a = node('a', 'btn-ghost-sm', 'Open the customer’s view ↗'); a.href = `order.html?ref=${encodeURIComponent(d.ref)}&phone=${encodeURIComponent(d.phone)}`; a.target = '_blank'; a.rel = 'noopener'; bar.append(a); }
      if (isManager()) btn('Decline', 'btn-ghost-sm danger', () => api.setStatus(d.ref, 'Declined', prompt('Reason (recorded):') || 'declined'));
      break;
    case 'Accepted':
      btn('Start preparing', 'btn-claim', () => api.setStatus(d.ref, 'Preparing'));
      btn('Picking list', 'btn-ghost-sm', async () => { state.pick = await api.pickingList(d.ref); paintDetail(); return []; });
      break;
    case 'Preparing':
      btn('Picking list', 'btn-claim', async () => { state.pick = await api.pickingList(d.ref); paintDetail(); return []; });
      btn('Mark fulfilled', 'btn-ghost-sm', () => api.setStatus(d.ref, 'Fulfilled'), 'Mark this order fulfilled? It leaves the open queue.');
      break;
    default:
      bar.append(node('p', 'q-note', `${d.status} — nothing further to do.`));
  }
  return bar;
}

/* ---------------------------------------------------------- picking list
   Stock code large with click-to-copy, grouped by category so the floor is
   walked once, plus the whole order as code,qty for IQ. */
function pickingView(d) {
  const P = state.pick;
  const wrap = node('div', 'd-body');
  const top = node('div', 'pick-top');
  const back = node('button', 'btn-ghost-sm', '← Back to order'); back.addEventListener('click', () => { state.pick = null; paintDetail(); });
  const copyAll = node('button', 'btn-claim', 'Copy all for IQ (code,qty)');
  copyAll.addEventListener('click', async () => { try { await navigator.clipboard.writeText(P.clipboard); copyAll.textContent = 'Copied ✓'; setTimeout(() => { copyAll.textContent = 'Copy all for IQ (code,qty)'; }, 1400); } catch { prompt('Copy this:', P.clipboard); } });
  top.append(back, copyAll); wrap.append(top);
  wrap.append(node('p', 'fine', 'Codes are text, not barcodes — only about a third of the range has an EAN. Tap a code to copy it.'));

  for (const g of P.groups) {
    const sec = node('div', 'pick-group'); sec.append(node('h4', null, g.category));
    for (const l of g.lines) {
      const rowEl = node('div', 'pick-row');
      const code = node('button', 'pick-code mono', l.code); code.title = 'Copy code';
      code.addEventListener('click', async () => { try { await navigator.clipboard.writeText(l.code); code.classList.add('is-copied'); setTimeout(() => code.classList.remove('is-copied'), 900); } catch { /* */ } });
      rowEl.append(code, node('span', 'pick-qty', `× ${l.qty}`), node('span', 'pick-desc', `${l.desc} · ${unitLabel(l)}`));
      sec.append(rowEl);
    }
    wrap.append(sec);
  }
  return wrap;
}

/* --------------------------------------------------------------- demo sign-in */
async function paintDemoLogins() {
  if (!DEMO || document.getElementById('demo-logins')) return;
  const d = await import('../demo/adapter.js');
  const form = $('signin-form');
  const box = node('div', 'demo-logins'); box.id = 'demo-logins';
  box.append(node('p', 'demo-logins-h', 'Demo staff — click one to sign in. No password in testing mode.'));
  for (const u of d.demoStaff()) {
    const b = node('button', 'demo-login'); b.type = 'button';
    b.append(node('span', 'demo-login-n', u.name));
    b.append(node('span', 'demo-login-r', u.role === 'admin' ? 'Admin · all four stores' : u.role === 'manager' ? 'Manager · ' + u.stores.map((s) => STORE_NAME[s]).join(' + ') + ' — can quote' : 'Counter · ' + u.stores.map((s) => STORE_NAME[s]).join(', ') + ' — claim, prepare, fulfil'));
    b.addEventListener('click', async () => { $('si-email').value = u.email; await auth.signIn(u.email, ''); await afterSignIn(); });
    box.append(b);
  }
  form.after(box); form.hidden = true;
}

(async function boot() {
  if (DEMO) import('../demo/banner.js').then((m) => m.mountBanner());
  await paintDemoLogins();
  if (auth.isSignedIn()) await afterSignIn(); else paintAuth();
})();
