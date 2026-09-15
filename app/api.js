/* The backend, over plain fetch.
 *
 * No client library on purpose. Everything the public site needs is a Postgres
 * function exposed at /rest/v1/rpc/<name>, so a 30-line helper does the job —
 * which means no build step, no node_modules, no CDN at runtime, and the whole
 * site deploys by copying files onto any static host.
 *
 * If the staff desk later needs sign-in and token refresh, that is the point to
 * reconsider @supabase/supabase-js — not before.
 */
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PAGE_SIZE, DEMO } from './config.js';

class ApiError extends Error {
  constructor(message, { status, code, hint } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}
export { ApiError };

/**
 * Call a Postgres function.
 *
 * `token` is a signed-in staff member's access token. Without one the
 * publishable key is used, which carries the anon role and therefore reaches
 * only what RLS opens to the public.
 */
export async function rpc(fn, args = {}, { signal, token } = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(args),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;          // caller superseded this request
    throw new ApiError('Could not reach the catalogue. Check your connection.');
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new ApiError('Your session has expired. Please sign in again.', { status: 401, code: 'expired' });
    }
    // PostgREST returns { message, code, hint, details }. Our functions raise
    // with real sentences, so the message is safe to show a person.
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    throw new ApiError(body.message || `Request failed (${res.status})`, {
      status: res.status, code: body.code, hint: body.hint,
    });
  }
  return res.json();
}

/* ---------------------------------------------------------------- catalogue */

/** One page of product cards. Sort is 'popular' | 'name' | 'price_asc' | 'price_desc'. */
export async function searchCatalogue({ query = null, category = null, sort = 'name',
                                        limit = PAGE_SIZE, offset = 0, signal } = {}) {
  if (DEMO) {
    const d = await import('./demo/adapter.js');
    return d.searchCatalogue({ query, category, sort, limit, offset });
  }
  return rpc('search_catalogue', {
    p_query: query || null,
    p_category: category || null,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  }, { signal });
}

export async function catalogueCategories({ signal } = {}) {
  if (DEMO) {
    const d = await import('./demo/adapter.js');
    return d.catalogueCategories();
  }
  return rpc('catalogue_categories', {}, { signal });
}

/* ------------------------------------------------------------------ orders */

/**
 * Place an order. The client sends stock codes and quantities ONLY — every
 * price, description and deposit is snapshotted server-side, which is why a
 * browser cannot state the price it is quoted.
 */
export async function submitOrder({ business, contact, phone, lines, whatsapp = null,
                              email = null, licenceNumber = null, address = null,
                              needBy = null, fulfil = 'collect',
                              preferredStore = null, note = null,
                              willReturn = true } = {}) {
  if (DEMO) {
    const d = await import('./demo/adapter.js');
    return d.submitOrder({ business, contact, phone, lines, fulfil });
  }
  return rpc('submit_order', {
    p_business: business,
    p_contact: contact,
    p_phone: phone,
    p_lines: lines,
    p_whatsapp: whatsapp,
    p_email: email,
    p_licence_number: licenceNumber,
    p_address: address,
    p_need_by: needBy,
    p_fulfil: fulfil,
    p_preferred_store: preferredStore,
    p_note: note,
    p_will_return: willReturn,
  });
}
