/* The staff desk's calls.
 *
 * Every one goes out with the signed-in person's access token, so the database
 * sees a real identity and the role matrix applies: a picker may claim and
 * fulfil, quoting is manager and above, and the claiming-store lock holds for
 * everyone but an admin. None of that is enforced here -- this file only
 * carries the token; the rules live in the database where they cannot be
 * bypassed by a different client.
 *
 * In demo mode every call is answered by ../demo/adapter.js instead, which
 * mirrors the same rules on browser-local data.
 *
 * The quoting, status and picking functions target the simplified order-flow
 * migration (20260827090000), which is written but NOT YET APPLIED to the live
 * database. Against the live database they will 404 until it is; against the
 * demo they work fully. That is deliberate: the flow is shown before it is
 * committed to the database.
 */
import { rpc, ApiError } from '../api.js';
import { accessToken, currentUser } from '../auth.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DEMO } from '../config.js';

const demo = () => import('../demo/adapter.js');

async function authed(fn, args = {}, opts = {}) {
  const token = await accessToken();
  if (!token) throw new ApiError('Your session has expired. Please sign in again.', { code: 'expired' });
  return rpc(fn, args, { ...opts, token });
}
async function rest(path) {
  const token = await accessToken();
  if (!token) throw new ApiError('Your session has expired. Please sign in again.', { code: 'expired' });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,
    { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new ApiError('Your session has expired. Please sign in again.', { code: 'expired' });
  if (!res.ok) { let b = {}; try { b = await res.json(); } catch { /* */ } throw new ApiError(b.message || `Request failed (${res.status})`); }
  return res.json();
}

/* ---- identity */
export async function myRole() {
  if (DEMO) return (await demo()).demoCurrentStaff()?.role || null;
  return authed('current_staff_role');
}
export async function myStores() {
  if (DEMO) return (await demo()).demoCurrentStaff()?.stores || [];
  return (await rest('staff_stores?select=store_id')).map((r) => r.store_id);
}

/* ---- queue and detail */
export async function queue() {
  if (DEMO) { const d = await demo(); return d.queue(d.demoCurrentStaff()); }
  return rest('staff_queue?select=*&order=created_at.desc');   // rule 4 is in the view
}
export async function orderDetail(ref) {
  if (DEMO) return (await demo()).orderDetail(ref);
  return authed('order_detail', { p_ref: ref });
}
export async function versionDiff(ref) {
  if (DEMO) return (await demo()).versionDiff(ref);
  return authed('order_version_diff', { p_ref: ref });
}

/* ---- claiming */
export async function claimOrder(ref, store) {
  if (DEMO) return (await demo()).claimOrder(ref, store);
  return authed('claim_order', { p_ref: ref, p_store: store });
}
export async function releaseOrder(ref, reason) {
  if (DEMO) return (await demo()).releaseOrder(ref, reason);
  return authed('release_order', { p_ref: ref, p_reason: reason });
}

/* ---- quoting: whole-order tier, per-line overrides */
export async function quoteOrder(ref, tier, version) {
  if (DEMO) return (await demo()).quoteOrder(ref, tier, version);
  return authed('quote_order', { p_ref: ref, p_tier: tier, p_expected_version: version });
}
export async function setLinePrice(ref, lineId, price, version) {
  if (DEMO) return (await demo()).setLinePrice(ref, lineId, price, version);
  return authed('set_order_line_price', { p_line_id: lineId, p_price_incl: price, p_expected_version: version });
}
export async function setLineQty(ref, lineId, qty, version) {
  if (DEMO) return (await demo()).setLineQty(ref, lineId, qty, version);
  return authed('set_order_line_qty', { p_line_id: lineId, p_qty: qty, p_expected_version: version });
}
export async function removeLine(ref, lineId, version) {
  if (DEMO) return (await demo()).removeLine(ref, lineId, version);
  return authed('remove_order_line', { p_line_id: lineId, p_expected_version: version });
}
export async function sendQuote(ref, version) {
  if (DEMO) return (await demo()).sendQuote(ref, version);
  return authed('set_order_status', { p_ref: ref, p_status: 'Quoted' });
}

/* ---- the rest of the flow */
export async function setStatus(ref, status, reason = '') {
  if (DEMO) { const d = await demo(); const me = d.demoCurrentStaff(); return d.setStatus(ref, status, me?.name || 'staff', reason); }
  return authed('set_order_status', { p_ref: ref, p_status: status, p_detail: reason ? { reason } : {} });
}
export async function pickingList(ref) {
  if (DEMO) return (await demo()).pickingList(ref);
  return authed('picking_list', { p_ref: ref });
}
export function whoAmI() { return currentUser(); }
