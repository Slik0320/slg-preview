/* Demo mode: the whole backend, in the browser.
 *
 * Implements the same call surface as api.js and staff/api.js against a bundled
 * catalogue snapshot (84 real products, real IQ codes and real prices, taken
 * from the live database) plus localStorage. Nothing here reaches the network.
 *
 * WHY SELF-CONTAINED. The Supabase project is on the free tier and pauses when
 * idle. A demo that read live would work today and be broken next week, which
 * is the opposite of what a hand-around testing build is for. Self-contained
 * also means it cannot create a real order by accident — the one that happened
 * during the real build had to be purged afterwards.
 *
 * The rules the real system enforces in the database are honoured here too, so
 * the demo does not teach anyone the wrong thing:
 *   - no price is ever derived from another (each pack has its own price)
 *   - stock codes are rendered verbatim
 *   - no tier price or tier percentage exists in this file at all
 *   - deposits are shown and never charged
 */

const ORDERS_KEY = 'slg_demo_orders_v1';
const SEQ_KEY    = 'slg_demo_seq_v1';

let catalogue = null;

async function load() {
  if (catalogue) return catalogue;
  const res = await fetch('data/catalogue.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error('demo catalogue missing');
  catalogue = await res.json();
  return catalogue;
}

/* ------------------------------------------------------------------ orders */

function readOrders() {
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY)) || null; }
  catch { return null; }
}
function writeOrders(o) {
  try { localStorage.setItem(ORDERS_KEY, JSON.stringify(o)); } catch { /* private mode */ }
}
function nextRef() {
  let n = 123500;
  try { n = parseInt(localStorage.getItem(SEQ_KEY), 10) || 123500; } catch { /* ignore */ }
  n += 1;
  try { localStorage.setItem(SEQ_KEY, String(n)); } catch { /* ignore */ }
  return 'SLG-Q' + n;
}

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

/* A queue that already has something in it, so the desk is worth looking at
   before anyone has placed an order. Deliberately spread across the ageing
   bands and across stores. */
function seedOrders() {
  return [
    { ref: 'SLG-Q123481', status: 'New', business: 'Kasi Corner Tavern', contact: 'Thabo Mokoena',
      phone: '072 555 0181', fulfil: 'delivery', claimed_by: null, claimed_by_name: null,
      created_at: minsAgo(38), line_count: 4, value_incl: 12240.00, quoted_incl: null, expired: false,
      lines: [
        { sku_code: 'CB034',  source_desc: 'BLACK LABEL 12X750ML CASE', unit_type: 'case',   pack: 12, qty: 20, price_incl: 256.00 },
        { sku_code: 'CCL3490', source_desc: 'CASTLE LITE 12X660ML CASE', unit_type: 'case',  pack: 12, qty: 18, price_incl: 264.00 },
        { sku_code: 'CU2L',   source_desc: 'COKE 2L',                    unit_type: 'single', pack: 1,  qty: 40, price_incl: 16.00 },
        { sku_code: 'CH02',   source_desc: 'HANSA PILSNER 12X750ML CASE', unit_type: 'case',  pack: 12, qty: 8,  price_incl: 244.00 } ] },

    { ref: 'SLG-Q123479', status: 'Claimed', business: 'Thokoza Shisanyama', contact: 'Nomsa Dube',
      phone: '083 555 0179', fulfil: 'collect', claimed_by: 's1', claimed_by_name: 'Thokoza',
      created_at: minsAgo(190), line_count: 3, value_incl: 9324.00, quoted_incl: null, expired: false,
      lines: [
        { sku_code: 'CS3408', source_desc: 'STOUT 12X750ML CASE',  unit_type: 'case',   pack: 12, qty: 24, price_incl: 285.00 },
        { sku_code: 'BU035',  source_desc: 'BLACK LABEL 750ML',    unit_type: 'single', pack: 1,  qty: 60, price_incl: 21.00 },
        { sku_code: 'CU125L', source_desc: 'COKE 1.25L',           unit_type: 'single', pack: 1,  qty: 100, price_incl: 13.00 } ] },

    { ref: 'SLG-Q123476', status: 'Quoted', business: 'Nhlapo Bottle Store', contact: 'Sipho Radebe',
      phone: '076 555 0176', fulfil: 'delivery', claimed_by: 's2', claimed_by_name: 'Nhlapo',
      created_at: minsAgo(1450), line_count: 2, value_incl: 5290.00, quoted_incl: 5024.00, expired: false,
      lines: [
        { sku_code: 'CL1990', source_desc: 'LION LAGER 12X750ML CASE', unit_type: 'case', pack: 12, qty: 14, price_incl: 229.00 },
        { sku_code: 'CC125L', source_desc: 'COKE 1.25L 12 CASE',       unit_type: 'case', pack: 12, qty: 11, price_incl: 185.00 } ] },

    { ref: 'SLG-Q123470', status: 'Fulfilled', business: 'Mosiliki Sports Bar', contact: 'Lerato Mahlangu',
      phone: '079 555 0170', fulfil: 'collect', claimed_by: 's3', claimed_by_name: 'Mosiliki',
      created_at: minsAgo(5800), line_count: 2, value_incl: 3128.00, quoted_incl: 3010.00, expired: false,
      lines: [
        { sku_code: 'CBB033', source_desc: 'BLACK LABEL 12X750ML BULK', unit_type: 'bulk', pack: 12, qty: 8, price_incl: 253.00 },
        { sku_code: 'HU022',  source_desc: 'HANSA PILSNER 750ML',       unit_type: 'single', pack: 1, qty: 55, price_incl: 20.00 } ] },
  ];
}

function orders() {
  let o = readOrders();
  if (!o) { o = seedOrders(); writeOrders(o); }
  return o;
}

/** Wipe everything this demo has stored and start again. */
export function resetDemo() {
  try {
    [ORDERS_KEY, SEQ_KEY, 'slg_cart_v1', 'slg_demo_staff_v1'].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/* -------------------------------------------------------------- catalogue */

function matches(p, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (p.name.toLowerCase().includes(needle)) return true;
  if ((p.category || '').toLowerCase().includes(needle)) return true;
  // stock code search, verbatim and case-insensitive — how a trade buyer looks
  return (p.options || []).some((o) => String(o.code).toLowerCase().includes(needle));
}

export async function searchCatalogue({ query, category, sort = 'name', limit = 48, offset = 0 } = {}) {
  const all = await load();
  let rows = all.filter((p) => matches(p, query) && (!category || p.category === category));

  const price = (p) => Number(p.primary_price_incl) || 0;
  if (sort === 'price_asc')  rows.sort((a, b) => price(a) - price(b));
  else if (sort === 'price_desc') rows.sort((a, b) => price(b) - price(a));
  else rows.sort((a, b) => a.name.localeCompare(b.name));   // 'popular' has no real data, so A–Z

  const total = rows.length;
  return rows.slice(offset, offset + limit).map((p) => ({ ...p, total_count: total }));
}

export async function catalogueCategories() {
  const all = await load();
  const by = new Map();
  for (const p of all) {
    const c = by.get(p.category) || { category: p.category, products: 0, skus: 0 };
    c.products += 1;
    c.skus += (p.options || []).length;
    by.set(p.category, c);
  }
  return [...by.values()].sort((a, b) => a.category.localeCompare(b.category));
}

/* ------------------------------------------------------------- submission */

export async function submitOrder(payload) {
  const all = await load();
  const byCode = new Map();
  for (const p of all) for (const o of (p.options || [])) byCode.set(o.code, { p, o });

  const lines = [];
  for (const l of (payload.lines || [])) {
    const hit = byCode.get(l.code);
    if (!hit) continue;
    lines.push({
      sku_code: hit.o.code,                       // verbatim
      source_desc: hit.p.name,
      unit_type: hit.o.unit_type,
      pack: hit.o.pack,
      qty: l.qty,
      price_incl: Number(hit.o.price_incl),       // priced server-side, as the real one does
    });
  }
  if (!lines.length) throw new Error('Your order is empty.');

  const ref = nextRef();
  const value = lines.reduce((t, l) => t + l.qty * l.price_incl, 0);
  const list = orders();
  list.unshift({
    ref, status: 'New',
    business: payload.business, contact: payload.contact, phone: payload.phone,
    fulfil: payload.fulfil || 'collect',
    claimed_by: null, claimed_by_name: null,
    created_at: new Date().toISOString(),
    line_count: lines.length, value_incl: value, quoted_incl: null, expired: false,
    lines,
  });
  writeOrders(list);
  return { ref, status: 'New', lines: lines.length, total_incl: value, demo: true };
}

/* ------------------------------------------------------------- staff desk */

export async function queue() {
  return orders().map(({ lines, ...row }) => ({
    ...row,
    age_mins: Math.round((Date.now() - new Date(row.created_at)) / 60000),
    unclaimed_mins: row.claimed_by ? 0 : Math.round((Date.now() - new Date(row.created_at)) / 60000),
  }));
}

export async function orderDetail(ref) {
  const o = orders().find((x) => x.ref === ref);
  if (!o) throw new Error('order ' + ref + ' not found');
  return o;
}

/** Mirrors the atomic claim: a second claim on the same order returns nothing. */
export async function claimOrder(ref, store) {
  const list = orders();
  const o = list.find((x) => x.ref === ref);
  if (!o || o.claimed_by) return [];          // zero rows = lost the race, not an error
  o.claimed_by = store;
  o.claimed_by_name = { s1: 'Thokoza', s2: 'Nhlapo', s3: 'Mosiliki', s4: 'Rondebult' }[store] || store;
  o.status = 'Claimed';
  writeOrders(list);
  return [o];
}

export async function releaseOrder(ref) {
  const list = orders();
  const o = list.find((x) => x.ref === ref);
  if (!o) return [];
  o.claimed_by = null; o.claimed_by_name = null; o.status = 'New';
  writeOrders(list);
  return [o];
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
export function demoCurrentStaff() {
  try { return JSON.parse(localStorage.getItem('slg_demo_staff_v1')) || null; } catch { return null; }
}
export function demoSignOut() {
  try { localStorage.removeItem('slg_demo_staff_v1'); } catch { /* ignore */ }
}
