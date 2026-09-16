/* The customer's order: find it, see the quote, accept it, change it, cancel.
 *
 * No login — reference plus phone number. The customer sees only the prices
 * staff have sent them. Tier names and percentages never reach this page; the
 * API strips them, and this file never asks for them.
 *
 * A change creates a new version of the same order at Price 1 for everything,
 * and routes it back to the store to re-quote. The version number is the
 * optimistic lock: if staff moved the order while the customer was editing,
 * the save is refused with a "changed, reload" message instead of overwriting.
 */
import { rpc, ApiError, searchCatalogue } from '../api.js';
import { rands, dmy, unitLabel } from '../money.js';
import { DEMO } from '../config.js';
import { orderableOptions } from '../rules.js';

const $ = (id) => document.getElementById(id);
const n = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/* ---- theme (shared behaviour with the shop) */
const THEME_KEY = 'slg_theme_v1';
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); $('theme-toggle').textContent = t === 'dark' ? '☀' : '☾'; try { localStorage.setItem(THEME_KEY, t); } catch { /* */ } }
(function () { let t; try { t = localStorage.getItem(THEME_KEY); } catch { /* */ } applyTheme(t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')); })();
$('theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
if (DEMO) import('../demo/banner.js').then((m) => m.mountBanner());

/* ---- API, demo or real */
const demo = () => import('../demo/adapter.js');
const api = {
  async get(ref, phone)              { return DEMO ? (await demo()).customerOrder(ref, phone)              : rpc('customer_order',      { p_ref: ref, p_phone: phone }); },
  async accept(ref, phone, v)        { return DEMO ? (await demo()).acceptOrder(ref, phone, v)             : rpc('accept_order',        { p_ref: ref, p_phone: phone, p_expected_version: v }); },
  async cancel(ref, phone, v, why)   { return DEMO ? (await demo()).cancelOrder(ref, phone, v, why)        : rpc('cancel_order',        { p_ref: ref, p_phone: phone, p_expected_version: v, p_reason: why }); },
  async change(ref, phone, v, lines) { return DEMO ? (await demo()).submitOrderChange(ref, phone, v, lines) : rpc('submit_order_change', { p_ref: ref, p_phone: phone, p_expected_version: v, p_lines: lines }); },
};

const state = { ref: '', phone: '', order: null, editing: false, draft: [], adding: [] };

/* ---- lookup */
$('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('lk-error'); err.hidden = true;
  state.ref = $('lk-ref').value.trim().toUpperCase(); state.phone = $('lk-phone').value.trim();
  try { state.order = await api.get(state.ref, state.phone); state.editing = false; show(); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
// deep link from the desk's "customer view" button, for the demo
(function fromQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('ref')) { $('lk-ref').value = q.get('ref'); $('lk-phone').value = q.get('phone') || ''; if (q.get('phone')) $('lookup-form').requestSubmit(); }
})();

/* ---- what the status means to the customer */
function statusCopy(o) {
  switch (o.status) {
    case 'New':       return ['We have your order.', 'One of our four stores will pick it up shortly and confirm stock and pricing.'];
    case 'Claimed':   return ['A store is working on your quote.', `${o.preferred_store_name ? o.preferred_store_name + ' has' : 'A store has'} taken your order and is confirming stock and prices.`];
    case 'Quoted':    return ['Your quote is ready.', 'These are the prices the store can do. Accept to go ahead, or change the order if you need something different.'];
    case 'Changed':   return ['Your changes are with the store.', 'They will send a revised quote for the new lines.'];
    case 'Accepted':  return ['Accepted — thank you.', 'The store is preparing your order. You can still change it until preparation starts.'];
    case 'Preparing': return ['Being prepared.', 'Your order is being picked now. Payment is on delivery, on collection, or on account.'];
    case 'Fulfilled': return ['Fulfilled.', 'This order is complete. Thank you for your business.'];
    case 'Declined':  return ['The store could not fulfil this order.', 'Please contact your store to discuss.'];
    case 'Cancelled': return ['Cancelled.', 'You cancelled this order.'];
    default:          return [o.status, ''];
  }
}

/* ---- render */
function show() {
  const o = state.order;
  $('lookup').hidden = true;
  const sec = $('order'); sec.hidden = false; sec.replaceChildren();

  const head = n('div', 'o-head');
  const l = n('div', null); l.append(n('p', 'o-ref', o.ref), n('p', 'o-sub', `${o.business} · placed ${dmy(o.created_at)} · ${o.fulfil === 'delivery' ? 'delivery' : 'collect from ' + (o.preferred_store_name || 'your store')}`));
  head.append(l, n('span', 'o-status', o.status)); sec.append(head);

  const [h, p] = statusCopy(o);
  const msg = n('div', 'o-msg' + (o.status === 'Quoted' ? ' is-good' : '')); msg.append(n('b', null, h + ' '), document.createTextNode(p)); sec.append(msg);

  if (state.editing) return renderEdit(sec);

  const lines = n('div', 'o-lines');
  for (const li of o.lines) {
    const row = n('div', 'o-line');
    const a = n('div', null); a.append(n('p', 'o-name', li.desc), n('p', 'o-code', `${li.code} · ${unitLabel(li)}`)); row.append(a);
    row.append(n('p', 'o-each', `${li.qty} × ${rands(li.unit_price)}`), n('p', 'o-tot', rands(li.line_total)));
    lines.append(row);
  }
  sec.append(lines);
  sec.append(totalsBox(o));

  const act = n('div', 'o-actions');
  if (o.can_accept) { const b = n('button', 'btn-primary', 'Accept this quote'); b.addEventListener('click', () => run(b, () => api.accept(state.ref, state.phone, o.version))); act.append(b); }
  if (o.can_change) { const b = n('button', 'btn-ghost', 'Change my order'); b.addEventListener('click', startEdit); act.append(b); }
  if (o.can_cancel) { const b = n('button', 'btn-ghost danger', 'Cancel order'); b.addEventListener('click', () => { const why = prompt('Cancel this order? Tell us why (optional):'); if (why === null) return; run(b, () => api.cancel(state.ref, state.phone, o.version, why)); }); act.append(b); }
  const back = n('button', 'btn-ghost', 'Look up another'); back.addEventListener('click', () => { $('order').hidden = true; $('lookup').hidden = false; }); act.append(back);
  sec.append(act);
}

function totalsBox(o, draftTotals) {
  const t = n('div', 'o-totals');
  const row = (k, v, cls) => { const r = n('div', 'trow ' + (cls || '')); r.append(n('span', null, k), n('b', null, rands(v))); t.append(r); };
  const goods = draftTotals ? draftTotals.goods : o.total_incl;
  row(state.editing ? 'Goods at list price (the store will re-quote)' : 'Goods, incl VAT', goods);
  if (o.delivery_fee_incl) row('Delivery — flat rate', o.delivery_fee_incl);
  const dep = draftTotals ? draftTotals.deposit : o.deposit_incl;
  if (dep) row('Deposit on crates & empties — refunded when returned', dep, 'is-dep');
  row('Total', goods + Number(o.delivery_fee_incl || 0), 'is-total');
  return t;
}

async function run(btn, fn) {
  const was = btn.textContent; btn.disabled = true; btn.textContent = '…';
  try { state.order = await fn(); state.editing = false; show(); }
  catch (e) { alert(e instanceof ApiError || e?.message ? e.message : 'That did not work. Please try again.'); btn.disabled = false; btn.textContent = was; }
}

/* ---- change my order
   Adjust quantities, remove lines, add from the catalogue. Everything comes
   in at Price 1 and the store re-quotes. */
function startEdit() {
  state.editing = true;
  state.draft = state.order.lines.map((l) => ({ code: l.code, desc: l.desc, unit_type: l.unit_type, pack: l.pack, qty: l.qty, price_incl: l.unit_price, deposit_incl: l.deposit_incl / Math.max(1, l.qty) }));
  show();
}
function renderEdit(sec) {
  const o = state.order;
  const note = n('div', 'o-msg'); note.append(n('b', null, 'Change your order. '), document.createTextNode('Adjust quantities, remove lines, or add items. Anything you change comes in at list price and the store will send you a revised quote.')); sec.append(note);

  const lines = n('div', 'o-lines');
  state.draft.forEach((li, i) => {
    const row = n('div', 'o-line is-editing');
    const a = n('div', null); a.append(n('p', 'o-name', li.desc), n('p', 'o-code', `${li.code} · ${unitLabel(li)}`)); row.append(a);
    const q = n('div', 'qty');
    const minus = n('button', null, '−'); minus.addEventListener('click', () => { li.qty = Math.max(0, li.qty - 1); if (!li.qty) state.draft.splice(i, 1); show(); });
    const inp = n('input', 'qty-in'); inp.type = 'number'; inp.min = '1'; inp.value = String(li.qty); inp.addEventListener('change', (e) => { li.qty = Math.max(1, parseInt(e.target.value, 10) || 1); show(); });
    const plus = n('button', null, '+'); plus.addEventListener('click', () => { li.qty += 1; show(); });
    q.append(minus, inp, plus); row.append(q);
    row.append(n('p', 'o-each', `${rands(li.price_incl)} each`));
    const rm = n('button', 'line-del', '×'); rm.title = 'Remove'; rm.addEventListener('click', () => { state.draft.splice(i, 1); show(); }); row.append(rm);
    lines.append(row);
  });
  sec.append(lines);

  /* add from the catalogue */
  const add = n('div', 'o-add'); add.append(n('h3', null, 'Add something'));
  const r = n('div', 'o-add-row'); const s = n('input', 'input'); s.placeholder = 'Search by name or stock code…'; r.append(s); add.append(r);
  const res = n('div', 'o-add-results'); add.append(res);
  let tmr;
  s.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(async () => {
    res.replaceChildren(); if (s.value.trim().length < 2) return;
    const hits = await searchCatalogue({ query: s.value.trim(), limit: 8 });
    for (const p of hits) for (const opt of orderableOptions(p)) {
      const hit = n('div', 'o-add-hit');
      hit.append(n('span', null, `${p.name} — ${unitLabel(opt)} · ${rands(opt.price_incl)}`));
      const b = n('button', null, 'Add'); b.addEventListener('click', () => {
        const ex = state.draft.find((d) => d.code === opt.code);
        if (ex) ex.qty += 1; else state.draft.push({ code: opt.code, desc: p.name, unit_type: opt.unit_type, pack: opt.pack, qty: 1, price_incl: Number(opt.price_incl), deposit_incl: 0 });
        show();
      });
      hit.append(b); res.append(hit);
    }
  }, 220); });
  sec.append(add);

  const goods = state.draft.reduce((t, l) => t + l.qty * l.price_incl, 0);
  const deposit = state.draft.reduce((t, l) => t + l.qty * (l.deposit_incl || 0), 0);
  sec.append(totalsBox(o, { goods, deposit }));

  const act = n('div', 'o-actions');
  const save = n('button', 'btn-primary', 'Send my changes to the store');
  save.addEventListener('click', () => run(save, () => api.change(state.ref, state.phone, o.version, state.draft.map((l) => ({ code: l.code, qty: l.qty })))));
  const back = n('button', 'btn-ghost', 'Keep the quote as it is'); back.addEventListener('click', () => { state.editing = false; show(); });
  act.append(save, back); sec.append(act);
}
