/* The order drawer and checkout.
 *
 * This is a checkout in shape only — there is no payment step, no card and no
 * gateway, by design. The customer sends the order; the first store able to
 * fulfil it confirms stock and price, and payment happens on delivery, on
 * collection or on account. Every price shown here is labelled indicative for
 * that reason.
 */
import * as cart from './cart.js';
import { submitOrder, ApiError } from '../api.js';
import { rands, unitLabel } from '../money.js';
import { DELIVERY_FEE_INCL } from '../rules.js';

const STORES = [
  { id: 's1', name: 'Thokoza' },
  { id: 's2', name: 'Nhlapo' },
  { id: 's3', name: 'Mosiliki' },
  { id: 's4', name: 'Rondebult' },
];

let root = null, pane = 'review', busy = false, lastError = '', receipt = null;

const n = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function open(which = 'review') {
  pane = cart.isEmpty() && which === 'checkout' ? 'review' : which;
  lastError = '';
  if (!root) {
    root = n('div', 'drawer-root');
    document.body.append(root);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
  }
  document.body.style.overflow = 'hidden';
  render();
}

export function close() {
  if (!root) return;
  root.replaceChildren();
  root.classList.remove('is-open');
  document.body.style.overflow = '';
  receipt = null;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && root?.classList.contains('is-open')) close();
});

/* ------------------------------------------------------------------ panes */

function reviewPane(panel) {
  const ls = cart.lines();
  panel.append(header('Your order', `${cart.count()} item${cart.count() === 1 ? '' : 's'}`));

  if (!ls.length) {
    const empty = n('div', 'drawer-empty');
    empty.append(n('h3', null, 'Nothing on this order yet'));
    empty.append(n('p', null, 'Add stock from the catalogue and it will collect here.'));
    const b = n('button', 'btn-primary', 'Browse the catalogue');
    b.addEventListener('click', close);
    empty.append(b);
    panel.append(empty);
    return;
  }

  const list = n('div', 'lines');
  for (const l of ls) {
    const row = n('div', 'line');

    const main = n('div', 'line-main');
    main.append(n('p', 'line-name', l.name));
    main.append(n('p', 'line-code', `${l.code} · ${unitLabel(l)}`));
    row.append(main);

    const qty = n('div', 'qty');
    const minus = n('button', null, '−');
    minus.setAttribute('aria-label', `Fewer ${l.name}`);
    minus.addEventListener('click', () => { cart.setQty(l.code, l.qty - 1); render(); });

    const input = n('input', 'qty-in');
    input.type = 'number'; input.min = '1'; input.max = '9999'; input.value = String(l.qty);
    input.setAttribute('aria-label', `Quantity of ${l.name}`);
    input.addEventListener('change', (e) => { cart.setQty(l.code, e.target.value); render(); });

    const plus = n('button', null, '+');
    plus.setAttribute('aria-label', `More ${l.name}`);
    plus.addEventListener('click', () => { cart.setQty(l.code, l.qty + 1); render(); });

    qty.append(minus, input, plus);
    row.append(qty);

    const money = n('div', 'line-money');
    money.append(n('p', 'line-total', rands(l.qty * Number(l.price_incl || 0))));
    money.append(n('p', 'line-each', `${rands(l.price_incl)} each`));
    row.append(money);

    const del = n('button', 'line-del', '×');
    del.title = 'Remove this line';
    del.setAttribute('aria-label', `Remove ${l.name}`);
    del.addEventListener('click', () => { cart.remove(l.code); render(); });
    row.append(del);

    list.append(row);
  }
  panel.append(list);

  const foot = n('div', 'drawer-foot');
  const sub = n('div', 'sub');
  sub.append(n('span', null, 'Indicative total, incl VAT'));
  sub.append(n('b', null, rands(cart.subtotal())));
  foot.append(sub);

  const dep = cart.deposit();
  if (dep > 0) {
    const dl = n('div', 'sub sub-dep');
    dl.append(n('span', null, 'Deposit on crates & empties — refunded when returned'));
    dl.append(n('b', null, rands(dep)));
    foot.append(dl);
    foot.append(n('p', 'fine', 'Deposits are R16 a crate and R2 an empty on beer 660ml and up. You get them back in full when everything comes back — only a shortfall is charged.'));
  } else {
    foot.append(n('p', 'fine', 'The store confirms stock and final pricing when it quotes. Nothing is charged now.'));
  }

  const go = n('button', 'btn-primary', 'Continue to details');
  go.addEventListener('click', () => { pane = 'checkout'; render(); });
  foot.append(go);
  panel.append(foot);
}

function field(label, id, opts = {}) {
  const w = n('label', 'field');
  const lab = n('span', 'field-lab', label);
  if (opts.required) lab.append(n('i', 'req', ' *'));
  w.append(lab);
  const input = n(opts.tag || 'input', 'input');
  input.id = id;
  if (opts.type) input.type = opts.type;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.required) input.required = true;
  if (opts.rows) input.rows = opts.rows;
  if (opts.autocomplete) input.autocomplete = opts.autocomplete;
  w.append(input);
  if (opts.hint) w.append(n('span', 'field-hint', opts.hint));
  return w;
}

function checkoutPane(panel) {
  panel.append(header('Your details', `${cart.count()} item${cart.count() === 1 ? '' : 's'} · ${rands(cart.subtotal())} indicative`));

  const form = n('form', 'checkout');
  form.noValidate = true;

  const grid = n('div', 'fgrid');
  grid.append(field('Trading name', 'f-business', { required: true, placeholder: 'Kasi Corner Tavern', autocomplete: 'organization' }));
  grid.append(field('Contact person', 'f-contact', { required: true, placeholder: 'Full name', autocomplete: 'name' }));
  grid.append(field('Phone', 'f-phone', { required: true, type: 'tel', placeholder: '072 000 0000', autocomplete: 'tel',
    hint: 'You look your order up with this number and the reference.' }));
  grid.append(field('WhatsApp', 'f-whatsapp', { type: 'tel', placeholder: 'If different to the phone number' }));
  grid.append(field('Email', 'f-email', { type: 'email', placeholder: 'Optional', autocomplete: 'email' }));
  grid.append(field('Liquor licence number', 'f-licence', { placeholder: 'As printed on your licence' }));
  form.append(grid);

  /* collect or deliver */
  const fx = n('div', 'seg-wrap');
  fx.append(n('span', 'field-lab', 'Collection or delivery'));
  const seg = n('div', 'seg');
  for (const [val, label] of [['collect', 'I will collect'], ['delivery', 'Deliver to me']]) {
    const b = n('button', 'seg-btn', label);
    b.type = 'button';
    b.dataset.fulfil = val;
    b.setAttribute('aria-pressed', String(val === 'collect'));
    b.addEventListener('click', () => {
      for (const x of seg.querySelectorAll('.seg-btn')) x.setAttribute('aria-pressed', String(x === b));
      form.querySelector('#wrap-store').hidden = val !== 'collect';
      form.querySelector('#wrap-address').hidden = val !== 'delivery';
      form.querySelector('#f-store').required = val === 'collect';
      paintTotals(form, val);
    });
    seg.append(b);
  }
  fx.append(seg);
  form.append(fx);

  const storeWrap = n('div', null); storeWrap.id = 'wrap-store';
  const sl = n('label', 'field');
  const slab = n('span', 'field-lab', 'Collect from'); slab.append(n('i', 'req', ' *')); sl.append(slab);
  const sel = n('select', 'input'); sel.id = 'f-store'; sel.required = true;
  const ph = n('option', null, 'Choose the store you will collect from'); ph.value = ''; ph.disabled = true; ph.selected = true;
  sel.append(ph);
  for (const s of STORES) { const o = n('option', null, s.name); o.value = s.id; sel.append(o); }
  sl.append(sel);
  sl.append(n('span', 'field-hint', 'Your order goes to this store only, and they confirm it with you.'));
  storeWrap.append(sl);
  form.append(storeWrap);

  const addrWrap = n('div', null); addrWrap.id = 'wrap-address'; addrWrap.hidden = true;
  addrWrap.append(field('Delivery address', 'f-address', { tag: 'textarea', rows: 2, placeholder: 'Street, suburb, town' }));
  form.append(addrWrap);

  const g2 = n('div', 'fgrid');
  g2.append(field('Needed by', 'f-needby', { type: 'date', hint: 'Optional.' }));
  g2.append(field('Anything else', 'f-note', { placeholder: 'Optional note for the store' }));
  form.append(g2);

  const ret = n('label', 'check');
  const cb = n('input'); cb.type = 'checkbox'; cb.id = 'f-return'; cb.checked = true;
  ret.append(cb, n('span', null, 'I will return crates and empties'));
  form.append(ret);

  if (lastError) {
    const err = n('div', 'form-error');
    err.append(n('b', null, 'Could not send the order. '));
    err.append(document.createTextNode(lastError));
    form.append(err);
  }

  const foot = n('div', 'drawer-foot');
  const tot = n('div', 'totals'); tot.id = 'co-totals'; foot.append(tot);
  foot.append(n('p', 'fine', 'No payment is taken. The store confirms stock, price and delivery, then you pay on delivery, on collection, or on account.'));
  const row = n('div', 'foot-row');
  const back = n('button', 'btn-ghost', 'Back to order');
  back.type = 'button';
  back.addEventListener('click', () => { pane = 'review'; render(); });
  const send = n('button', 'btn-primary', busy ? 'Sending…' : 'Place order');
  send.type = 'submit';
  send.disabled = busy;
  row.append(back, send);
  foot.append(row);
  form.append(foot);

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(form); });
  panel.append(form);
  paintTotals(form, 'collect');
}

/* Goods, delivery (R200 flat when delivering), refundable deposit, and the total. */
function paintTotals(form, fulfil) {
  const box = form.querySelector('#co-totals'); if (!box) return;
  box.replaceChildren();
  const goods = cart.subtotal(), dep = cart.deposit();
  const fee = fulfil === 'delivery' ? DELIVERY_FEE_INCL : 0;
  const row = (label, val, cls) => { const r = n('div', 'trow ' + (cls || '')); r.append(n('span', null, label), n('b', null, rands(val))); box.append(r); };
  row('Goods, incl VAT', goods);
  if (fee) row('Delivery — flat rate', fee);
  if (dep) row('Deposit on crates & empties (refundable)', dep, 'is-dep');
  row(fee ? 'Indicative total' : 'Indicative total', goods + fee, 'is-total');
}

function donePane(panel) {
  panel.append(header('Order sent', null, true));
  const box = n('div', 'done');
  box.append(n('div', 'done-tick', '✓'));
  box.append(n('h3', null, 'We have your order'));
  box.append(n('p', 'done-ref-lab', 'Your reference'));
  box.append(n('p', 'done-ref', receipt?.ref || '—'));
  if (receipt && receipt.total_incl != null) {
    const t = n('p', 'done-tot');
    t.append(n('span', null, 'Indicative total '), n('b', null, rands(receipt.total_incl)));
    if (receipt.delivery_fee_incl) t.append(n('span', null, ` · includes ${rands(receipt.delivery_fee_incl)} delivery`));
    if (receipt.deposit_incl) t.append(n('span', null, ` · plus ${rands(receipt.deposit_incl)} refundable deposit`));
    box.append(t);
  }
  box.append(n('p', null,
    'One of our four stores will confirm stock and pricing and send the quote back to you. Keep this reference — you look the order up with it and your phone number.'));
  const b = n('button', 'btn-primary', 'Done');
  b.addEventListener('click', () => { close(); location.reload(); });
  box.append(b);
  panel.append(box);
}

/* ----------------------------------------------------------------- submit */

async function submit(form) {
  const v = (id) => form.querySelector(`#${id}`)?.value.trim() || '';
  const fulfil = form.querySelector('.seg-btn[aria-pressed="true"]')?.dataset.fulfil || 'collect';

  if (!v('f-business') || !v('f-contact') || !v('f-phone')) {
    lastError = 'Trading name, contact person and phone are required.';
    render(); return;
  }
  if (fulfil === 'collect' && !v('f-store')) {
    lastError = 'Choose the store you will collect from.';
    render(); return;
  }

  busy = true; lastError = ''; render();
  try {
    const res = await submitOrder({
      business: v('f-business'),
      contact: v('f-contact'),
      phone: v('f-phone'),
      lines: cart.toOrderLines(),           // codes and quantities only
      whatsapp: v('f-whatsapp') || null,
      email: v('f-email') || null,
      licenceNumber: v('f-licence') || null,
      address: fulfil === 'delivery' ? (v('f-address') || null) : null,
      needBy: v('f-needby') || null,
      fulfil,
      preferredStore: fulfil === 'collect' ? (v('f-store') || null) : null,
      note: v('f-note') || null,
      willReturn: !!form.querySelector('#f-return')?.checked,
    });
    receipt = res;
    cart.clear();
    pane = 'done';
  } catch (e) {
    // Our functions raise real sentences, so this is safe to show a person.
    lastError = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
  } finally {
    busy = false;
    render();
  }
}

/* ----------------------------------------------------------------- render */

function header(title, sub, hideClose) {
  const h = n('div', 'drawer-hd');
  const t = n('div', null);
  t.append(n('h2', null, title));
  if (sub) t.append(n('p', 'drawer-sub', sub));
  h.append(t);
  if (!hideClose) {
    const x = n('button', 'drawer-x', '×');
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    h.append(x);
  }
  return h;
}

function render() {
  if (!root) return;
  const panel = n('aside', 'drawer');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Your order');

  if (pane === 'review') reviewPane(panel);
  else if (pane === 'checkout') checkoutPane(panel);
  else donePane(panel);

  root.replaceChildren(panel);
  root.classList.add('is-open');
  panel.querySelector('input, button, select, textarea')?.focus({ preventScroll: true });
}
