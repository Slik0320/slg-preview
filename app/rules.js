/* Business rules, as ruled by the owner on 16/09/2026.
 *
 * In production every one of these is DATA in the database — category_rules,
 * app_settings, price_tiers, sku_returnables — and the API enforces them
 * server-side (see migration 20260916090000_business_rules.sql). This module
 * carries the same rules for the client so the shop can hide what the server
 * would refuse, and so the self-contained demo behaves identically to the real
 * thing. If the two ever disagree, the database wins.
 */

/* Rule 2 — singles only for spirits. Everything else is case / bulk, unless the
   single is the only option a product has (then it stays visible). */
export const SINGLES_ALLOWED = new Set([
  'Whisky', 'Brandy & Cognac', 'Vodka', 'Gin', 'Rum & Tequila', 'Liqueurs & Aperitifs',
]);

/** Which of a product's options may be offered to the trade. */
export function orderableOptions(product) {
  const opts = product.options || [];
  if (SINGLES_ALLOWED.has(product.category)) return opts;
  const packs = opts.filter((o) => o.unit_type !== 'single');
  return packs.length ? packs : opts;          // single-only product stays visible
}

/* Rule 3 — delivery. Flat, any size, any distance, VAT inclusive. */
export const DELIVERY_FEE_INCL = 200.00;

/* Rule 5 — deposits, now chargeable. Beer 660ml and up; Corona and Stella
   excluded; NRB and CAN are never returnable. Charged on the SHORTFALL when the
   full count is not returned — so at order time this is what is EXPECTED back,
   shown to the customer as refundable, not as a cost. */
export const DEPOSIT = { crate: 16.00, empty: 2.00 };

export function depositApplies(product, option) {
  if (product.category !== 'Beer') return false;
  const d = (option.source_desc || product.name || '').toLowerCase();
  if (/corona|stella/.test(d)) return false;
  if (/\b(nrb|can)\b/.test(d)) return false;
  return /(660|750|1000)\s*ml|\b[12]\s*(l|lt|ltr|litre)s?\b/.test(d);
}

/** Expected deposit on one line, or 0. */
export function depositFor(product, option, qty = 1) {
  if (!depositApplies(product, option)) return 0;
  const crates = Number(option.crates || 0), empties = Number(option.empties || 0);
  return qty * (crates * DEPOSIT.crate + empties * DEPOSIT.empty);
}

/* Tiers — Price 1 is the displayed shop price. Price 2 and 3 are the trade
   tiers. The percentages are PLACEHOLDERS until IQ's Price 2 / Price 3 exports
   arrive as per-SKU prices; anything derived from them is flagged estimated. */
export const TIERS = [
  { key: 'retail', label: 'Price 1', pct: 0,    note: 'The shop price. Highest margin.' },
  { key: 'p1',     label: 'Price 2', pct: 2.0,  note: 'Placeholder −2% until IQ Price 2 export.' },
  { key: 'p2',     label: 'Price 3', pct: 4.0,  note: 'Placeholder −4% until IQ Price 3 export.' },
];
export const tierByKey = (k) => TIERS.find((t) => t.key === k) || TIERS[0];

/** A line's price at a tier — a trade discount off ITS OWN retail price, never
    derived from another code (hard rule 2). Returns { price, estimated }. */
export function tierPrice(priceIncl, tierKey) {
  const t = tierByKey(tierKey);
  if (!t.pct) return { price: Number(priceIncl), estimated: false };
  return { price: Math.round(Number(priceIncl) * (1 - t.pct / 100) * 100) / 100, estimated: true };
}

/* The status machine, from the simplified spec. */
export const STATUS_NEXT = {
  New:       ['Claimed', 'Declined'],
  Claimed:   ['Quoted', 'New', 'Declined'],
  Quoted:    ['Accepted', 'Changed', 'Declined', 'Cancelled'],
  Changed:   ['Quoted', 'Declined', 'Cancelled'],
  Accepted:  ['Preparing', 'Changed', 'Cancelled'],
  Preparing: ['Fulfilled', 'Cancelled'],
  Fulfilled: [], Declined: [], Cancelled: [],
};
export const OPEN_STATUSES = new Set(['New', 'Claimed', 'Quoted', 'Changed', 'Accepted', 'Preparing']);
