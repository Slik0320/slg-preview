/* Where the backend lives.
 *
 * The publishable key is MEANT to be public — it identifies the project and
 * carries the `anon` role, nothing more. Every table it can reach is gated by
 * Row Level Security, and the trade tier tables have no anon policy at all, so
 * this key cannot read a tier price. It is not a secret and belongs in the
 * repo; the service_role key is a secret and must never appear in this folder.
 */
export const SUPABASE_URL = 'https://ccapjejyqtgmbxqfhioh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_K9bEymyMSFA0WytLL1vWWA__x45vc_C';

/* Page size for the catalogue grid. 766 product cards is too many for one
   render, and the API already returns total_count so we can page honestly. */
export const PAGE_SIZE = 48;

/* Demo (testing) mode.
 *
 * Switched on by <meta name="slg-mode" content="demo"> in the page, and by
 * nothing else — so production pages cannot fall into it by accident, and the
 * demo build is assembled by injecting that one tag rather than by forking the
 * app. In demo mode nothing touches Supabase at all: the catalogue is a bundled
 * snapshot and orders live in this browser. That matters because the Supabase
 * project is on the free tier and pauses when idle, which would otherwise make
 * the demo break days after it was handed over.
 */
export const DEMO = (function () {
  try {
    var m = document.querySelector('meta[name="slg-mode"]');
    return !!m && m.content === 'demo';
  } catch (e) { return false; }
})();
