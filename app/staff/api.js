/* The staff desk's calls.
 *
 * Every one goes out with the signed-in person's access token, so the database
 * sees a real identity and the role matrix applies: a picker may claim and
 * fulfil, quoting is manager and above, and the claiming-store lock holds for
 * everyone but an admin. None of that is enforced here -- this file only
 * carries the token; the rules live in the database where they cannot be
 * bypassed by a different client.
 */
import { rpc, ApiError } from '../api.js';
import { accessToken } from '../auth.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DEMO } from '../config.js';

async function authed(fn, args = {}, opts = {}) {
  const token = await accessToken();
  if (!token) throw new ApiError('Your session has expired. Please sign in again.', { code: 'expired' });
  return rpc(fn, args, { ...opts, token });
}

/** The queue, straight off the view. security_invoker means RLS still applies. */
export async function queue({ signal } = {}) {
  if (DEMO) { const d = await import('../demo/adapter.js'); return d.queue(); }
  const token = await accessToken();
  if (!token) throw new ApiError('Your session has expired. Please sign in again.', { code: 'expired' });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/staff_queue?select=*&order=created_at.desc`,
    { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }, signal });

  if (res.status === 401) throw new ApiError('Your session has expired. Please sign in again.', { code: 'expired' });
  if (!res.ok) {
    let b = {}; try { b = await res.json(); } catch { /* non-JSON */ }
    throw new ApiError(b.message || `Could not load the queue (${res.status})`);
  }
  return res.json();
}

/** Who am I, as the database sees me: admin | manager | picker, or null. */
export async function myRole() {
  if (DEMO) { const d = await import('../demo/adapter.js'); return d.demoCurrentStaff()?.role || null; }
  return authed('current_staff_role');
}
export const myStores = async () => {
  if (DEMO) { const d = await import('../demo/adapter.js'); return d.demoCurrentStaff()?.stores || []; }
  const token = await accessToken();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff_stores?select=store_id`,
    { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  return res.ok ? (await res.json()).map((r) => r.store_id) : [];
};

export async function orderDetail(ref) {
  if (DEMO) { const d = await import('../demo/adapter.js'); return d.orderDetail(ref); }
  return authed('order_detail', { p_ref: ref });
}
export async function claimOrder(ref, store) {
  if (DEMO) { const d = await import('../demo/adapter.js'); return d.claimOrder(ref, store); }
  return authed('claim_order', { p_ref: ref, p_store: store });
}
export async function releaseOrder(ref, reason) {
  if (DEMO) { const d = await import('../demo/adapter.js'); return d.releaseOrder(ref, reason); }
  return authed('release_order', { p_ref: ref, p_reason: reason });
}
export const pickingList = (ref)          => authed('picking_list',  { p_ref: ref });
