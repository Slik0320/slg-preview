/* Money and dates, in the only formats this business uses.
 *
 * Hard rule 8: all money in ZAR, VAT 15%, dates DD/MM/YYYY. South African
 * convention is a space for thousands and a comma for the decimal — R21 564,40.
 * Formatted by hand rather than via Intl because locale data varies between
 * browsers and this must match the printed price list exactly.
 */

export const VAT_RATE = 0.15;

/** 21564.4 -> "R21 564,40" */
export function rands(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0;
  const [whole, dec] = Math.abs(n).toFixed(2).split('.');
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');  // nbsp, never wraps
  return `${neg ? '-' : ''}R${spaced},${dec}`;
}

/** "2026-08-12" or a Date -> "12/08/2026" */
export function dmy(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * How a pack is described on a card. Never computes a per-unit price from a
 * pack price — hard rule 2: single, case and bulk are separate stock codes with
 * independently set prices and no formula relates them.
 */
export function unitLabel(option) {
  if (!option) return '';
  const { unit_type: type, pack } = option;
  if (type === 'case')   return pack > 1 ? `Case of ${pack}` : 'Case';
  if (type === 'bulk')   return pack > 1 ? `Bulk ${pack}`    : 'Bulk';
  return 'Single';
}
