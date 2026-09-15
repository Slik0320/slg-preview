/* Product imagery.
 *
 * SOURCE POLICY. Images are served from our own images/products/ folder, keyed
 * on the IQ stock code. Nothing is hotlinked and nothing is scraped. The images
 * that belong here are ones Sam's has the right to use:
 *
 *   1. Supplier / brand assets. Distell, Heineken, SAB-AB InBev and Diageo all
 *      issue product packshots to trade customers, usually as transparent PNGs
 *      -- which is the cut-out look we want -- and they want their products
 *      shown. This is the cheapest and best source.
 *   2. Sam's own photographs.
 *
 * Competitor retail sites (Pick n Pay, Makro, Takealot) are NOT a source. Their
 * packshots are their own commercial photography or licensed to them alone, and
 * reusing them to sell the same products is the version most likely to be
 * noticed and acted on.
 *
 * Until real images arrive, every card gets a drawn silhouette. It is themed
 * from CSS variables, so it follows light and dark, and it reads as a deliberate
 * catalogue style rather than a broken image.
 */

let manifest = null;      // code -> filename, or {} once we know there is none

/** Load images/manifest.json once. Absent is normal and not an error. */
export async function loadManifest() {
  if (manifest) return manifest;
  try {
    const res = await fetch('images/manifest.json', { cache: 'no-cache' });
    manifest = res.ok ? await res.json() : {};
  } catch { manifest = {}; }
  return manifest;
}

function fileFor(code) {
  if (!manifest) return null;
  return manifest[code] || null;
}

/* ------------------------------------------------------------- silhouettes */

const SVG_NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/* Which outline suits the category. Deliberately coarse — it is a placeholder,
   not an illustration, and a wrong-looking bottle is worse than a neutral one. */
function shapeFor(category = '', name = '') {
  const c = category.toLowerCase();
  const n = name.toLowerCase();
  if (/\b\d\s*l\b|box|cask/.test(n) && /wine/.test(c)) return 'box';
  if (/soft drinks|mixers/.test(c)) return 'bottle';
  if (/beer|cider|rtd|cooler/.test(c)) return /can|nrb/.test(n) ? 'can' : 'stubby';
  if (/wine/.test(c)) return 'wine';
  return 'spirit';                                   // whisky, gin, vodka, rum, brandy…
}

const PATHS = {
  /* viewBox 0 0 80 110, drawn as outlines so they sit well on any panel */
  stubby: 'M32 12h16v9c0 4 6 7 6 14v56a5 5 0 0 1-5 5H31a5 5 0 0 1-5-5V35c0-7 6-10 6-14z',
  can:    'M28 16h24a4 4 0 0 1 4 4v70a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z',
  wine:   'M35 10h10v20c0 6 8 11 8 22v40a4 4 0 0 1-4 4H31a4 4 0 0 1-4-4V52c0-11 8-16 8-22z',
  spirit: 'M33 10h14v14c0 5 8 8 8 18v50a4 4 0 0 1-4 4H29a4 4 0 0 1-4-4V42c0-10 8-13 8-18z',
  box:    'M22 24h36a3 3 0 0 1 3 3v62a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3V27a3 3 0 0 1 3-3z',
  bottle: 'M34 10h12v16c0 5 7 8 7 17v51a4 4 0 0 1-4 4H31a4 4 0 0 1-4-4V43c0-9 7-12 7-17z',
};

function silhouette(product) {
  const kind = shapeFor(product.category || '', product.name || '');
  const svg = mk('svg', {
    viewBox: '0 0 80 110', class: 'ph-svg', role: 'img', focusable: 'false',
    'aria-label': `${product.name} — no photograph yet`,
  });
  svg.append(mk('path', { d: PATHS[kind], class: 'ph-body' }));
  // a label band, so it reads as a product rather than a blob
  if (kind !== 'box') svg.append(mk('rect', { x: '27', y: '52', width: '26', height: '20', rx: '2', class: 'ph-band' }));
  else svg.append(mk('rect', { x: '27', y: '40', width: '26', height: '22', rx: '2', class: 'ph-band' }));
  return svg;
}

/* ------------------------------------------------------------------ public */

/**
 * Fill a card's media slot: a real <img> when we hold a licensed image for that
 * stock code, a drawn silhouette otherwise.
 *
 * The caller owns the wrapper and we only replace its contents, so changing
 * pack size repaints in place rather than swapping a live node out of the DOM.
 */
export function renderMedia(wrap, product, option) {
  wrap.replaceChildren();
  wrap.classList.remove('is-ph');

  const file = fileFor(option?.code) || fileFor(product.primary_code);
  if (file) {
    const img = document.createElement('img');
    img.src = `images/products/${file}`;
    img.alt = product.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    // A missing file must never show a broken icon — fall back to the drawing.
    img.addEventListener('error', () => { wrap.replaceChildren(silhouette(product)); wrap.classList.add('is-ph'); });
    wrap.append(img);
  } else {
    wrap.classList.add('is-ph');
    wrap.append(silhouette(product));
  }
  return wrap;
}
