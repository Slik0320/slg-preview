/* The order in progress.
 *
 * Keyed on stock code alone, because a pack size IS its own code — "Black Label
 * 750ML single" (BU035) and "case of 12" (CB034) are two different lines, not
 * one line with a multiplier. submit_order() also deduplicates by code, so this
 * matches the server exactly.
 *
 * Display fields (name, price) are cached here only so the drawer can render
 * without a round trip. They are never sent: submit carries codes and
 * quantities only, and the server snapshots every price itself. Anything shown
 * from this cache is labelled indicative, because the weekly import may have
 * moved a price since the item was added.
 */

import { depositFor } from '../rules.js';

const KEY = 'slg_cart_v1';
const listeners = new Set();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(raw) ? raw.filter((l) => l && l.code && l.qty > 0) : [];
  } catch { return []; }
}
function write(lines) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode */ }
  for (const fn of listeners) fn(lines);
}

export function onChange(fn) { listeners.add(fn); fn(read()); return () => listeners.delete(fn); }
export function lines() { return read(); }
export function count() { return read().reduce((n, l) => n + l.qty, 0); }
export function isEmpty() { return read().length === 0; }

/** Indicative only — the store confirms every price when it quotes. */
export function subtotal() {
  return read().reduce((t, l) => t + l.qty * (Number(l.price_incl) || 0), 0);
}
/** Refundable deposit expected on crates and empties across the order. */
export function deposit() {
  return read().reduce((t, l) => t + l.qty * (Number(l.deposit_incl) || 0), 0);
}

export function add(option, product, qty = 1) {
  const cart = read();
  const hit = cart.find((l) => l.code === option.code);
  if (hit) hit.qty = Math.min(9999, hit.qty + qty);
  else cart.push({
    code: option.code,                       // verbatim — hard rule 3
    qty: Math.min(9999, Math.max(1, qty)),
    name: product.name,
    category: product.category,
    unit_type: option.unit_type,
    pack: option.pack,
    price_incl: option.price_incl,
    crates: option.crates || 0,
    empties: option.empties || 0,
    // expected back on return — beer 660ml+ at R16 crate / R2 empty (rule 5)
    deposit_incl: depositFor(product, option, 1),
  });
  write(cart);
}

export function setQty(code, qty) {
  const cart = read();
  const hit = cart.find((l) => l.code === code);
  if (!hit) return;
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n) || n < 1) return remove(code);
  hit.qty = Math.min(9999, n);
  write(cart);
}

export function remove(code) { write(read().filter((l) => l.code !== code)); }
export function clear() { write([]); }

/** Exactly what submit_order() wants: codes and quantities, nothing else. */
export function toOrderLines() {
  return read().map((l) => ({ code: l.code, qty: l.qty }));
}
