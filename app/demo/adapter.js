/* Demo mode: the whole backend, in the browser.
 *
 * Implements the same call surface as api.js and staff/api.js against a bundled
 * catalogue snapshot (84 real products, real IQ codes and real prices, taken
 * from the live database) plus localStorage. Nothing here reaches the network.
 *
 * WHY SELF-CONTAINED. The Supabase project is on the free tier and pauses when
 * idle. A demo that read live would work today and be broken next week. It also
 * cannot create a real order by accident.
 *
 * The rules the real system enforces in the database are honoured here too, so
 * the demo teaches the right thing: no price is derived from another code; stock
 * codes are verbatim; singles only for spirits; collection routes to the chosen
 * store; deposits are expected on beer 660ml+ at R16/R2; the status machine is
 * the simplified spec; every change is a new VERSION of the same order and the
 * version doubles as an optimistic lock.
 */
import {
  orderableOptions, DELIVERY_FEE_INCL, depositFor, TIERS, tierByKey, tierPrice,
  STATUS_NEXT,
} from '../rules.js';

const ORDERS_KEY = 'slg_demo_orders_v2';
const SEQ_KEY    = 'slg_demo_seq_v2';
const STORES = { s1: 'Thokoza', s2: 'Nhlapo', s3: 'Mosiliki', s4: 'Rondebult' };

let catalogue = null;

async function load() {
  if (catalogue) return catalogue;
  const res = await fetch('data/catalogue.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error('demo catalogue missing');
  catalogue = await res.json();
  return catalogue;
}

/* ------------------------------------------------------------ persistence */

function readOrders() { try { return JSON.parse(localStorage.getItem(ORDERS_KEY)) || null; } catch { return null; } }
function writeOrders(o) { try { localStorage.setItem(ORDERS_KEY, JSON.stringify(o)); } catch { /* private mode */ } }
function nextRef() {
  let n = 123500;
  try { n = parseInt(localStorage.getItem(SEQ_KEY), 10) || 123500; } catch { /* ignore */ }
  n += 1;
  try { localStorage.setItem(SEQ_KEY, String(n)); } catch { /* ignore */ }
  return 'SLG-Q' + n;
}
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

export function resetDemo() {
  try {
    ['slg_demo_orders_v1', 'slg_demo_seq_v1', ORDERS_KEY, SEQ_KEY, 'slg_cart_v1', 'slg_demo_staff_v1']
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------ line maths */

function mkLine(product, option, qty) {
  return {
    id: Math.random().toString(36).slice(2, 9),
    sku_code: option.code,                          // verbatim — hard rule 3
    source_desc: product.name,
    category: product.category,
    unit_type: option.unit_type,
    pack: option.pack,
    qty,
    price_incl: Number(option.price_incl),          // Price 1, snapshotted
    quoted_price: null,                             // set by staff
    quoted_estimated: false,
    price_overridden: false,
    qty_overridden: false,
    crates: Number(option.crates || 0),
    empties: Number(option.empties || 0),
    deposit_incl: depositFor(product, option, 1),  // per unit, expected back
  };
}
const lineTotal  = (l) => l.qty * Number(l.quoted_price ?? l.price_incl);
const lineOrig   = (l) => l.qty * Number(l.price_incl);
const linesOf    = (o) => (o.versions[o.version - 1] || {}).lines || [];

function totals(o) {
  const ls = linesOf(o);
  const original = ls.reduce((t, l) => t + lineOrig(l), 0);
  const adjusted = ls.reduce((t, l) => t + lineTotal(l), 0);
  const deposit  = ls.reduce((t, l) => t + l.qty * (l.deposit_incl || 0), 0);
  return {
    original_incl: r2(original), adjusted_incl: r2(adjusted), difference: r2(adjusted - original),
    delivery_fee_incl: o.delivery_fee_incl, deposit_incl: r2(deposit),
    grand_incl: r2(adjusted + o.delivery_fee_incl),           // deposit is refundable, shown apart
    line_count: ls.length,
  };
}
const r2 = (n) => Math.round(n * 100) / 100;

function summary(o) {
  const t = totals(o);
  return {
    ref: o.ref, status: o.status, version: o.version,
    business: o.business, contact: o.contact, phone: o.phone,
    fulfil: o.fulfil, preferred_store: o.preferred_store,
    preferred_store_name: STORES[o.preferred_store] || null,
    claimed_by: o.claimed_by, claimed_by_name: STORES[o.claimed_by] || null,
    created_at: o.created_at, price_tier: o.price_tier,
    age_mins: Math.round((Date.now() - new Date(o.created_at)) / 60000),
    unclaimed_mins: o.claimed_by ? 0 : Math.round((Date.now() - new Date(o.created_at)) / 60000),
    expired: false,
    line_count: t.line_count, value_incl: t.original_incl, quoted_incl: t.adjusted_incl,
    delivery_fee_incl: o.delivery_fee_incl, deposit_incl: t.deposit_incl,
    needs_requote: o.status === 'Changed',
  };
}

/* ------------------------------------------------------------ seed orders */

async function seedOrders() {
  const all = await load();
  const byCode = new Map();
  for (const p of all) for (const o of p.options || []) byCode.set(o.code, { p, o });
  // seeds obey rule 2 like real orders do — no beer or soft-drink singles
  const L = (code, qty) => { const h = byCode.get(code); if (!h) return null; if (!orderableOptions(h.p).some((x) => x.code === h.o.code)) return null; return mkLine(h.p, h.o, qty); };
  const mk = (ref, status, biz, contact, phone, fulfil, store, claimed, mins, codes, extra = {}) => {
    const lines = codes.map(([c, q]) => L(c, q)).filter(Boolean);
    const o = {
      ref, status, business: biz, contact, phone, fulfil, preferred_store: store,
      claimed_by: claimed, created_at: minsAgo(mins),
      delivery_fee_incl: fulfil === 'delivery' ? DELIVERY_FEE_INCL : 0,
      price_tier: 'retail', version: 1,
      versions: [{ version: 1, origin: 'customer', created_at: minsAgo(mins), lines, note: 'Order placed' }],
      events: [{ at: minsAgo(mins), action: 'placed', by: 'customer', detail: `${lines.length} lines` }],
      ...extra,
    };
    if (claimed) o.events.push({ at: minsAgo(mins - 6), action: 'claimed', by: STORES[claimed], detail: '' });
    return o;
  };
  const seeded = [
    mk('SLG-Q123481', 'New', 'Kasi Corner Tavern', 'Thabo Mokoena', '072 555 0181', 'delivery', null, null, 38,
       [['CB034', 20], ['CCL3490', 18], ['CC2L', 5], ['CH02', 8]]),
    mk('SLG-Q123480', 'New', 'Rondebult Bottle Store', 'Ayanda Sithole', '071 555 0180', 'collect', 's4', null, 12,
       [['CS3408', 10], ['CC125L', 6]]),
    mk('SLG-Q123479', 'Claimed', 'Thokoza Shisanyama', 'Nomsa Dube', '083 555 0179', 'collect', 's1', 's1', 190,
       [['CS3408', 24], ['CB034', 5], ['CC125L', 8]]),
    mk('SLG-Q123476', 'Quoted', 'Nhlapo Bottle Store', 'Sipho Radebe', '076 555 0176', 'delivery', null, 's2', 1450,
       [['CL1990', 14], ['CC125L', 11]], { price_tier: 'p1' }),
    mk('SLG-Q123470', 'Fulfilled', 'Mosiliki Sports Bar', 'Lerato Mahlangu', '079 555 0170', 'collect', 's3', 's3', 5800,
       [['CBB033', 8], ['CH02', 5]], { price_tier: 'p2' }),
  ];
  // apply the seeded tiers so quoted orders carry quoted prices
  for (const o of seeded) if (o.price_tier !== 'retail') applyTier(o, o.price_tier);
  return seeded;
}

async function orders() {
  let o = readOrders();
  if (!o) { o = await seedOrders(); writeOrders(o); }
  return o;
}
async function find(ref) {
  const list = await orders();
  const o = list.find((x) => x.ref === ref);
  if (!o) throw new Error('order ' + ref + ' not found');
  return { list, o };
}
function event(o, action, by, detail = '') {
  o.events.push({ at: new Date().toISOString(), action, by, detail });
}
function assertVersion(o, expected) {
  if (expected != null && Number(expected) !== o.version) {
    const e = new Error(`This order changed, reload. You were working from version ${expected}, it is now version ${o.version}.`);
    e.code = 'P0004'; throw e;
  }
}
function move(o, to, by) {
  const allowed = STATUS_NEXT[o.status] || [];
  if (!allowed.includes(to)) throw new Error(`Illegal status change: ${o.status} → ${to}`);
  event(o, 'status', by, `${o.status} → ${to}`);
  o.status = to;
}

/* -------------------------------------------------------------- catalogue */

function matches(p, q) {
  if (!q) return true;
  const n = q.toLowerCase();
  return p.name.toLowerCase().includes(n) || (p.category || '').toLowerCase().includes(n)
      || (p.options || []).some((o) => String(o.code).toLowerCase().includes(n));
}

export async function searchCatalogue({ query, category, sort = 'name', limit = 48, offset = 0 } = {}) {
  const all = await load();
  let rows = all.filter((p) => matches(p, query) && (!category || p.category === category));
  const price = (p) => Number(p.primary_price_incl) || 0;
  if (sort === 'price_asc') rows.sort((a, b) => price(a) - price(b));
  else if (sort === 'price_desc') rows.sort((a, b) => price(b) - price(a));
  else rows.sort((a, b) => a.name.localeCompare(b.name));
  const total = rows.length;
  return rows.slice(offset, offset + limit).map((p) => ({ ...p, total_count: total }));
}

export async function catalogueCategories() {
  const all = await load();
  const by = new Map();
  for (const p of all) {
    const c = by.get(p.category) || { category: p.category, products: 0, skus: 0 };
    c.products += 1; c.skus += (p.options || []).length; by.set(p.category, c);
  }
  return [...by.values()].sort((a, b) => a.category.localeCompare(b.category));
}

/* ------------------------------------------------------------- submission */

export async function submitOrder(payload) {
  const all = await load();
  const byCode = new Map();
  for (const p of all) for (const o of p.options || []) byCode.set(o.code, { p, o });

  if (payload.fulfil === 'collect' && !payload.preferredStore && !payload.preferred_store) {
    throw new Error('Choose the store you will collect from.');
  }
  const lines = [];
  for (const l of payload.lines || []) {
    const hit = byCode.get(l.code);
    if (!hit) continue;
    // rule 2, enforced here as the database trigger does
    if (hit.o.unit_type === 'single' && !orderableOptions(hit.p).some((x) => x.code === hit.o.code)) {
      throw new Error(`Singles of ${hit.o.code} are not sold to the trade — order the case or bulk pack.`);
    }
    lines.push(mkLine(hit.p, hit.o, l.qty));
  }
  if (!lines.length) throw new Error('Your order is empty.');

  const fulfil = payload.fulfil || 'collect';
  const o = {
    ref: nextRef(), status: 'New',
    business: payload.business, contact: payload.contact, phone: payload.phone,
    fulfil, preferred_store: fulfil === 'collect' ? (payload.preferredStore || payload.preferred_store) : null,
    claimed_by: null, created_at: new Date().toISOString(),
    delivery_fee_incl: fulfil === 'delivery' ? DELIVERY_FEE_INCL : 0,
    price_tier: 'retail', version: 1,
    versions: [{ version: 1, origin: 'customer', created_at: new Date().toISOString(), lines, note: 'Order placed' }],
    events: [{ at: new Date().toISOString(), action: 'placed', by: 'customer', detail: `${lines.length} lines` }],
  };
  const list = await orders();
  list.unshift(o); writeOrders(list);
  const t = totals(o);
  return { ref: o.ref, status: 'New', lines: lines.length, total_incl: t.grand_incl,
           delivery_fee_incl: o.delivery_fee_incl, deposit_incl: t.deposit_incl, demo: true };
}

/* ------------------------------------------------------------- staff desk */

/** Rule 4: a collection order is visible only to its chosen store (and admin). */
export async function queue(staff) {
  const list = await orders();
  const stores = staff?.stores || [];
  const admin = staff?.role === 'admin';
  return list
    .filter((o) => o.fulfil === 'delivery' || !o.preferred_store || admin || stores.includes(o.preferred_store))
    .map(summary);
}

export async function orderDetail(ref) {
  const { o } = await find(ref);
  return {
    ...summary(o),
    lines: linesOf(o),
    totals: totals(o),
    versions: o.versions.map((v) => ({ version: v.version, origin: v.origin, created_at: v.created_at, note: v.note, lines: v.lines.length })),
    events: o.events.slice().reverse(),
    tiers: TIERS,
  };
}

export async function claimOrder(ref, store) {
  const { list, o } = await find(ref);
  if (o.claimed_by) return [];                                // lost the race
  if (o.fulfil === 'collect' && o.preferred_store && o.preferred_store !== store) {
    throw new Error(`Order ${ref} is a collection from ${STORES[o.preferred_store]}; only that store may claim it.`);
  }
  o.claimed_by = store; move(o, 'Claimed', STORES[store]);
  writeOrders(list); return [summary(o)];
}

export async function releaseOrder(ref, reason) {
  const { list, o } = await find(ref);
  if (!o.claimed_by) return [];
  event(o, 'released', STORES[o.claimed_by], reason || '');
  o.claimed_by = null; o.status = 'New';
  writeOrders(list); return [summary(o)];
}

/* ---- quoting: tier for the whole order, overrides per line */

function applyTier(o, tierKey) {
  o.price_tier = tierKey;
  for (const l of linesOf(o)) {
    if (l.price_overridden) continue;                          // hand-typed price survives
    const { price, estimated } = tierPrice(l.price_incl, tierKey);
    l.quoted_price = price; l.quoted_estimated = estimated;
  }
}

export async function quoteOrder(ref, tierKey, expectedVersion) {
  const { list, o } = await find(ref);
  assertVersion(o, expectedVersion);
  applyTier(o, tierKey);
  event(o, 'tier', STORES[o.claimed_by] || 'staff', tierByKey(tierKey).label);
  writeOrders(list); return orderDetail(ref);
}

export async function setLinePrice(ref, lineId, priceIncl, expectedVersion) {
  const { list, o } = await find(ref); assertVersion(o, expectedVersion);
  const l = linesOf(o).find((x) => x.id === lineId); if (!l) throw new Error('line not found');
  const from = l.quoted_price ?? l.price_incl;
  l.quoted_price = r2(Number(priceIncl)); l.price_overridden = true; l.quoted_estimated = false;
  event(o, 'line price', 'staff', `${l.sku_code}: R${from} → R${l.quoted_price}`);
  writeOrders(list); return orderDetail(ref);
}

export async function setLineQty(ref, lineId, qty, expectedVersion) {
  const { list, o } = await find(ref); assertVersion(o, expectedVersion);
  const l = linesOf(o).find((x) => x.id === lineId); if (!l) throw new Error('line not found');
  const n = Math.max(1, Math.floor(Number(qty)));
  event(o, 'line qty', 'staff', `${l.sku_code}: ${l.qty} → ${n}`);
  l.qty = n; l.qty_overridden = true;
  writeOrders(list); return orderDetail(ref);
}

export async function removeLine(ref, lineId, expectedVersion) {
  const { list, o } = await find(ref); assertVersion(o, expectedVersion);
  const ls = linesOf(o);
  if (ls.length <= 1) throw new Error('An order must keep at least one line — decline it instead.');
  const i = ls.findIndex((x) => x.id === lineId); if (i < 0) throw new Error('line not found');
  event(o, 'line removed', 'staff', ls[i].sku_code);
  ls.splice(i, 1);
  writeOrders(list); return orderDetail(ref);
}

export async function sendQuote(ref, expectedVersion) {
  const { list, o } = await find(ref); assertVersion(o, expectedVersion);
  if (o.status === 'Claimed' || o.status === 'Changed') {
    if (!linesOf(o).some((l) => l.quoted_price != null)) applyTier(o, o.price_tier || 'retail');
    move(o, 'Quoted', STORES[o.claimed_by] || 'staff');
  } else throw new Error(`Cannot send a quote from ${o.status}.`);
  writeOrders(list); return orderDetail(ref);
}

export async function setStatus(ref, to, by = 'staff', reason = '') {
  const { list, o } = await find(ref);
  move(o, to, by); if (reason) o.events[o.events.length - 1].detail += ` — ${reason}`;
  writeOrders(list); return orderDetail(ref);
}

/** The picking list: code, qty, description grouped by category — and the
    clipboard blob IQ accepts. */
export async function pickingList(ref) {
  const { o } = await find(ref);
  const ls = linesOf(o);
  const groups = new Map();
  for (const l of ls) {
    const g = groups.get(l.category) || [];
    g.push({ code: l.sku_code, qty: l.qty, desc: l.source_desc, unit: l.unit_type, pack: l.pack });
    groups.set(l.category, g);
  }
  return {
    ref: o.ref, business: o.business, status: o.status,
    groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, lines]) => ({ category, lines })),
    clipboard: ls.map((l) => `${l.sku_code},${l.qty}`).join('\n'),
  };
}

/* ------------------------------------------------------------ the customer
   No login: reference + phone. Sees only the prices staff sent, never a tier
   name or percentage. */

function customerView(o) {
  const t = totals(o);
  return {
    ref: o.ref, status: o.status, version: o.version,
    business: o.business, contact: o.contact, fulfil: o.fulfil,
    preferred_store_name: STORES[o.preferred_store] || null,
    created_at: o.created_at,
    lines: linesOf(o).map((l) => ({
      id: l.id, code: l.sku_code, desc: l.source_desc, unit_type: l.unit_type, pack: l.pack, qty: l.qty,
      unit_price: Number(l.quoted_price ?? l.price_incl), line_total: r2(lineTotal(l)),
      deposit_incl: r2(l.qty * (l.deposit_incl || 0)),
    })),
    total_incl: t.adjusted_incl, delivery_fee_incl: t.delivery_fee_incl,
    deposit_incl: t.deposit_incl, grand_incl: t.grand_incl,
    can_accept: o.status === 'Quoted',
    can_change: ['Quoted', 'Accepted'].includes(o.status),
    can_cancel: !['Fulfilled', 'Declined', 'Cancelled'].includes(o.status),
  };
}
const phoneKey = (p) => String(p || '').replace(/\D/g, '');

export async function customerOrder(ref, phone) {
  const list = await orders();
  const o = list.find((x) => x.ref === String(ref).trim().toUpperCase() && phoneKey(x.phone) === phoneKey(phone));
  if (!o) throw new Error('No order found for that reference and phone number.');
  return customerView(o);
}

export async function acceptOrder(ref, phone, expectedVersion) {
  const list = await orders();
  const o = list.find((x) => x.ref === ref && phoneKey(x.phone) === phoneKey(phone));
  if (!o) throw new Error('No order found for that reference and phone number.');
  assertVersion(o, expectedVersion); move(o, 'Accepted', 'customer');
  writeOrders(list); return customerView(o);
}

export async function cancelOrder(ref, phone, expectedVersion, reason) {
  const list = await orders();
  const o = list.find((x) => x.ref === ref && phoneKey(x.phone) === phoneKey(phone));
  if (!o) throw new Error('No order found for that reference and phone number.');
  assertVersion(o, expectedVersion); move(o, 'Cancelled', 'customer');
  if (reason) o.events[o.events.length - 1].detail = reason;
  writeOrders(list); return customerView(o);
}

/** Customer amendment: a NEW VERSION with every line at Price 1. Added lines
    come from the catalogue; kept lines keep their code and new qty. Routes
    back to the claiming store as Changed. */
export async function submitOrderChange(ref, phone, expectedVersion, newLines) {
  const list = await orders();
  const o = list.find((x) => x.ref === ref && phoneKey(x.phone) === phoneKey(phone));
  if (!o) throw new Error('No order found for that reference and phone number.');
  if (!['Quoted', 'Accepted'].includes(o.status)) throw new Error(`This order can no longer be changed — it is ${o.status}.`);
  assertVersion(o, expectedVersion);

  const all = await load();
  const byCode = new Map();
  for (const p of all) for (const opt of p.options || []) byCode.set(opt.code, { p, o: opt });
  const lines = [];
  for (const l of newLines || []) {
    const hit = byCode.get(l.code); if (!hit || !(l.qty > 0)) continue;
    lines.push(mkLine(hit.p, hit.o, Math.floor(l.qty)));       // retail, unpriced by staff
  }
  if (!lines.length) throw new Error('An order must keep at least one line — cancel it instead.');

  const prev = linesOf(o);
  o.version += 1;
  o.versions.push({ version: o.version, origin: 'customer', created_at: new Date().toISOString(), lines, note: 'Customer amendment' });
  o.status = 'Changed';
  event(o, 'changed', 'customer', diffText(prev, lines));
  writeOrders(list); return customerView(o);
}

function diffText(a, b) {
  const A = new Map(a.map((l) => [l.sku_code, l])), B = new Map(b.map((l) => [l.sku_code, l]));
  const out = [];
  for (const [c, l] of B) { if (!A.has(c)) out.push(`+${c}×${l.qty}`); else if (A.get(c).qty !== l.qty) out.push(`${c} ${A.get(c).qty}→${l.qty}`); }
  for (const c of A.keys()) if (!B.has(c)) out.push(`−${c}`);
  return out.join(', ') || 'no line changes';
}

/** "What changed" between the last two versions — added / removed / qty. */
export async function versionDiff(ref) {
  const { o } = await find(ref);
  if (o.version < 2) return { first_version: true, added: [], removed: [], changed: [] };
  const a = o.versions[o.version - 2].lines, b = o.versions[o.version - 1].lines;
  const A = new Map(a.map((l) => [l.sku_code, l])), B = new Map(b.map((l) => [l.sku_code, l]));
  return {
    from: o.version - 1, to: o.version, first_version: false,
    added:   [...B.values()].filter((l) => !A.has(l.sku_code)).map((l) => ({ code: l.sku_code, desc: l.source_desc, qty: l.qty })),
    removed: [...A.values()].filter((l) => !B.has(l.sku_code)).map((l) => ({ code: l.sku_code, desc: l.source_desc, qty: l.qty })),
    changed: [...B.values()].filter((l) => A.has(l.sku_code) && A.get(l.sku_code).qty !== l.qty)
               .map((l) => ({ code: l.sku_code, desc: l.source_desc, qty_from: A.get(l.sku_code).qty, qty_to: l.qty })),
  };
}

/* ------------------------------------------------------------------- staff */

const STAFF = [
  { email: 'thokoza@demo.slg',   name: 'Bongani Dlamini', role: 'picker',  stores: ['s1'] },
  { email: 'nhlapo@demo.slg',    name: 'Lerato Mahlangu', role: 'picker',  stores: ['s2'] },
  { email: 'mosiliki@demo.slg',  name: 'Sipho Radebe',    role: 'picker',  stores: ['s3'] },
  { email: 'rondebult@demo.slg', name: 'Thandi Nkosi',    role: 'manager', stores: ['s1', 's4'] },
  { email: 'admin@demo.slg',     name: 'Sam Mokoena',     role: 'admin',   stores: ['s1', 's2', 's3', 's4'] },
];
export const demoStaff = () => STAFF.slice();
export function demoSignIn(email) {
  const u = STAFF.find((s) => s.email === String(email).trim().toLowerCase());
  if (!u) throw new Error('Pick one of the demo staff below.');
  try { localStorage.setItem('slg_demo_staff_v1', JSON.stringify(u)); } catch { /* ignore */ }
  return u;
}
export function demoCurrentStaff() { try { return JSON.parse(localStorage.getItem('slg_demo_staff_v1')) || null; } catch { return null; } }
export function demoSignOut() { try { localStorage.removeItem('slg_demo_staff_v1'); } catch { /* ignore */ } }
