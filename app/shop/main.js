/* The customer catalogue.
 *
 * Reads only what the public API exposes. There is no tier price on the wire to
 * leak — search_catalogue() returns retail figures and nothing else — but the
 * rule this file must keep is the other half of it: never ask for, cache or
 * render anything beyond the card shape the API hands back.
 */
import { searchCatalogue, catalogueCategories, ApiError } from '../api.js';
import { rands, dmy, unitLabel } from '../money.js';
import { PAGE_SIZE, DEMO } from '../config.js';
import * as cart from './cart.js';
import * as drawer from './checkout.js';
import { renderMedia, loadManifest } from './images.js';
import { orderableOptions } from '../rules.js';

const $ = (id) => document.getElementById(id);
const el = $('grid'), railEl = $('rail'), countEl = $('count'), pagerEl = $('pager');

const state = { query: '', category: null, sort: 'name', page: 0, total: 0, loading: false };
let inFlight = null;          // AbortController for the request that still matters
let debounce = null;

/* Cart lives in cart.js; the header count just follows it. */
cart.onChange(() => { $('cart-count').textContent = String(cart.count()); });

/* -------------------------------------------------------------------- theme */

const THEME_KEY = 'slg_theme_v1';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('theme-toggle').textContent = t === 'dark' ? '☀' : '☾';
  $('theme-toggle').title = t === 'dark' ? 'Switch to light' : 'Switch to dark';
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
}
function initTheme() {
  let t;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(t);
}

/* ------------------------------------------------------------------ helpers */

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;   // textContent throughout: DB copy is never HTML
  return n;
}

/* --------------------------------------------------------------- categories */

async function loadCategories() {
  let cats = [];
  try { cats = await catalogueCategories(); } catch { return; }   // rail is a nicety, not the page

  railEl.replaceChildren();
  const all = node('button', 'chip', 'All stock');
  all.dataset.cat = '';
  railEl.append(all);

  for (const c of cats) {
    const b = node('button', 'chip', c.category);
    b.dataset.cat = c.category;
    const n = node('span', 'n', String(c.products));
    b.append(n);
    railEl.append(b);
  }
  paintRail();

  railEl.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.category = b.dataset.cat || null;
    state.page = 0;
    paintRail(); syncUrl(); load();
  });
}
function paintRail() {
  for (const b of railEl.querySelectorAll('.chip')) {
    b.setAttribute('aria-pressed', String((b.dataset.cat || null) === state.category));
  }
}

/* ---------------------------------------------------------------- rendering */

function skeletons() {
  el.setAttribute('aria-busy', 'true');
  el.replaceChildren(...Array.from({ length: 12 }, () => node('div', 'skeleton')));
  pagerEl.hidden = true;
}

function card(p) {
  const c = node('article', 'card');
  c.append(node('p', 'card-cat', p.category || 'Uncategorised'));
  c.append(node('h3', 'card-name', p.name));

  /* Pack sizes. Each one is a SEPARATE stock code with its own independently
     set price -- a case is never the single price times the pack, which the
     real data proves (Black Label single R21,00 x 12 = R252, case R256,00).
     So choosing a pack switches the code we order and reads that code's own
     price. Nothing here multiplies. */
  // Rule 2 (16/09/2026): singles only for spirits. A non-spirit that has only a
  // single stays visible; one that also has a case shows the case and bulk only.
  const opts = orderableOptions(p).slice().sort((a, b) =>
    (a.pack - b.pack) || String(a.unit_type).localeCompare(String(b.unit_type)));
  let sel = opts.find((o) => o.code === p.primary_code) || opts[0];
  if (!sel) return c;

  const media = node('div', 'card-media');
  c.append(media);

  const codeEl = node('p', 'card-code', sel.code);      // verbatim -- hard rule 3
  c.append(codeEl);

  const foot = node('div', 'card-foot');
  const priceEl = node('p', 'card-price', rands(sel.price_incl));
  const unitEl  = node('p', 'card-unit', '');
  const depEl   = node('p', 'card-dep', '');

  function paintSel() {
    renderMedia(media, p, sel);
    codeEl.textContent  = sel.code;
    priceEl.textContent = rands(sel.price_incl);
    unitEl.textContent  = unitLabel(sel) + ' \u00b7 incl VAT';
    depEl.textContent   = (sel.crates > 0 || sel.empties > 0)
      ? 'Crate / empties deposit confirmed on quote' : '';
    depEl.hidden = !depEl.textContent;
  }

  if (opts.length > 1) {
    const labels = opts.map(unitLabel);
    const dupe = labels.some((l, i) => labels.indexOf(l) !== i);
    const picker = node('div', 'packs');
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Pack size for ' + p.name);

    for (const o of opts) {
      const b = node('button', 'pack');
      b.append(node('span', 'pack-lab', dupe ? unitLabel(o) + ' \u00b7 ' + o.code : unitLabel(o)));
      b.append(node('span', 'pack-price', rands(o.price_incl)));
      b.setAttribute('aria-pressed', String(o.code === sel.code));
      b.addEventListener('click', () => {
        sel = o;
        for (const x of picker.querySelectorAll('.pack')) x.setAttribute('aria-pressed', String(x === b));
        paintSel();
      });
      picker.append(b);
    }
    foot.append(picker);
  }

  foot.append(priceEl, unitEl, depEl);

  const add = node('button', 'add', 'Add to order');
  add.addEventListener('click', () => {
    cart.add(sel, p, 1);
    add.textContent = 'Added \u2713';
    add.classList.add('is-added');
    setTimeout(() => { add.textContent = 'Add to order'; add.classList.remove('is-added'); }, 1100);
  });
  foot.append(add);

  c.append(foot);
  paintSel();
  return c;
}

function paintEmpty() {
  const box = node('div', 'empty');
  box.append(node('h3', null, 'Nothing matches that'));
  box.append(node('p', null, state.query
    ? `No product or stock code matches “${state.query}”. Try fewer words, or the IQ code on its own.`
    : 'There is nothing in this category yet.'));
  el.replaceChildren(box);
  pagerEl.hidden = true;
}

function paintError(message) {
  const box = node('div', 'error');
  box.append(node('h3', null, 'Could not load the catalogue'));
  box.append(node('p', null, message));
  const btn = node('button', 'retry', 'Try again');
  btn.addEventListener('click', load);
  box.append(btn);
  el.replaceChildren(box);
  pagerEl.hidden = true;
}

function paintPager() {
  const pages = Math.ceil(state.total / PAGE_SIZE);
  pagerEl.replaceChildren();
  if (pages <= 1) { pagerEl.hidden = true; return; }

  const prev = node('button', null, 'Previous');
  prev.disabled = state.page === 0;
  prev.addEventListener('click', () => { state.page--; syncUrl(); load(); scrollTo({ top: 0, behavior: 'smooth' }); });

  const next = node('button', null, 'Next');
  next.disabled = state.page >= pages - 1;
  next.addEventListener('click', () => { state.page++; syncUrl(); load(); scrollTo({ top: 0, behavior: 'smooth' }); });

  pagerEl.append(prev, node('span', 'pos', `Page ${state.page + 1} of ${pages}`), next);
  pagerEl.hidden = false;
}

/* ------------------------------------------------------------------ loading */

async function load() {
  inFlight?.abort();                       // a newer keystroke supersedes an older request
  const ctrl = new AbortController();
  inFlight = ctrl;
  state.loading = true;
  skeletons();

  try {
    const rows = await searchCatalogue({
      query: state.query, category: state.category, sort: state.sort,
      limit: PAGE_SIZE, offset: state.page * PAGE_SIZE, signal: ctrl.signal,
    });

    state.total = rows.length ? Number(rows[0].total_count) : 0;
    el.setAttribute('aria-busy', 'false');

    if (!rows.length) { countEl.textContent = ''; paintEmpty(); return; }

    el.replaceChildren(...rows.map(card));
    const from = state.page * PAGE_SIZE + 1;
    const to = Math.min(from + rows.length - 1, state.total);
    countEl.replaceChildren();
    countEl.append(node('b', null, `${from}–${to}`), document.createTextNode(` of ${state.total} products`));
    paintPager();
  } catch (e) {
    if (e.name === 'AbortError') return;   // superseded, not a failure
    el.setAttribute('aria-busy', 'false');
    paintError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
  } finally {
    state.loading = false;
  }
}

/* ------------------------------------------------------- url state, so back
   works and a filtered view can be pasted to a colleague */

function syncUrl() {
  const p = new URLSearchParams();
  if (state.query) p.set('q', state.query);
  if (state.category) p.set('cat', state.category);
  if (state.sort !== 'name') p.set('sort', state.sort);
  if (state.page) p.set('page', String(state.page + 1));
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
function readUrl() {
  const p = new URLSearchParams(location.search);
  state.query = p.get('q') || '';
  state.category = p.get('cat') || null;
  state.sort = p.get('sort') || 'name';
  state.page = Math.max(0, (parseInt(p.get('page'), 10) || 1) - 1);
  $('search').value = state.query;
  $('sort').value = state.sort;
  $('search-clear').hidden = !state.query;
}

/* --------------------------------------------------------------------- wire */

function wire() {
  $('search-form').addEventListener('submit', (e) => e.preventDefault());

  $('search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    $('search-clear').hidden = !state.query;
    state.page = 0;
    clearTimeout(debounce);
    debounce = setTimeout(() => { syncUrl(); load(); }, 220);
  });

  $('search-clear').addEventListener('click', () => {
    $('search').value = ''; state.query = ''; state.page = 0;
    $('search-clear').hidden = true;
    syncUrl(); load(); $('search').focus();
  });

  $('sort').addEventListener('change', (e) => {
    state.sort = e.target.value; state.page = 0; syncUrl(); load();
  });

  $('theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  $('cart-btn').addEventListener('click', () => drawer.open('review'));
}

/* Price stamp: the date of the import the catalogue is quoting against. */
async function paintStamp() {
  const d = document.querySelector('meta[name="price-list-date"]')?.content;
  const date = d || '2026-08-12';
  $('price-stamp-txt').textContent = `Prices as at ${dmy(date)} — indicative, confirmed on quote`;
  $('price-stamp').hidden = false;
}

if (DEMO) import('../demo/banner.js').then((m) => m.mountBanner());

initTheme();
readUrl();
wire();
paintStamp();
loadCategories();
loadManifest().then(load);
