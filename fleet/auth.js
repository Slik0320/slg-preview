/* Sam's Liquor Group — shared staff access.
   One user list and one session, read by both the trade desk and fleet care.
   Permissions decide which app a person lands in, which stores they can work
   orders for, and which vehicles they may attend to. */
(function () {

const KEY_USERS = 'slg_users_v1';
const KEY_SESSION = 'slg_session_v1';

const APPS = [
  { key: 'orders', label: 'Staff orders', href: '../desk.html', note: 'Trade desk — quote and fulfil wholesale orders' },
  { key: 'fleet', label: 'Fleet care', href: 'index.html', note: 'Vehicles, inspections, fuel, repairs and compliance' }
];

const ROLES = [
  { key: 'admin', label: 'Group admin', note: 'Everything, both apps, all stores and vehicles' },
  { key: 'staff', label: 'Store staff', note: 'Trade desk for the stores you allow' },
  { key: 'fleet', label: 'Fleet controller', note: 'Fleet care for the vehicles you allow' },
  { key: 'driver', label: 'Driver', note: 'Their own vehicle only — inspections, refuels, loads' }
];

const STORES = [
  { id: 's1', name: 'Thokoza', full: "Sam's Liquor Thokoza" },
  { id: 's2', name: 'Nhlapo', full: "Sam's Liquor Nhlapo" },
  { id: 's3', name: 'Mosiliki', full: "Sam's Liquor Mosiliki" },
  { id: 's4', name: 'Rondebult', full: "Sam's Liquor Rondebult" }
];

/* mirrors the fleet register — id and reg must match Vehicle v2 */
const VEHICLES = [
  { id: 'v1', reg: 'JH 41 KL GP', depot: 'Katlehong DC', driverId: 'd1' },
  { id: 'v2', reg: 'KZ 88 TF GP', depot: 'Vosloorus DC', driverId: 'd2' },
  { id: 'v3', reg: 'LM 06 RD GP', depot: 'Katlehong DC', driverId: 'd3' },
  { id: 'v4', reg: 'PB 73 XN GP', depot: 'Alberton Yard', driverId: 'd4' },
  { id: 'v5', reg: 'RT 29 BC GP', depot: 'Vosloorus DC', driverId: 'd5' },
  { id: 'v6', reg: 'SD 55 QQ GP', depot: 'Katlehong DC', driverId: 'd6' },
  { id: 'v7', reg: 'TN 12 VW GP', depot: 'Alberton Yard', driverId: 'd7' },
  { id: 'v8', reg: 'VC 64 HJ GP', depot: 'Vosloorus DC', driverId: 'd8' },
  { id: 'v9', reg: 'WD 37 PM GP', depot: 'Katlehong DC', driverId: 'd9' },
  { id: 'v10', reg: 'XG 90 LT GP', depot: 'Alberton Yard', driverId: 'd10' },
  { id: 'v11', reg: 'YH 18 SS GP', depot: 'Vosloorus DC', driverId: null },
  { id: 'v12', reg: 'ZK 52 NF GP', depot: 'Katlehong DC', driverId: 'd11' }
];

const SEED_USERS = [
  { id: 'u9', code: '100', name: 'Sam Naidoo', title: 'Group admin', role: 'admin', pin: '9999',
    apps: ['orders', 'fleet'], stores: 'all', vehicles: 'all', driverId: null, active: true },

  { id: 'u1', code: '201', name: 'Lerato Mahlangu', title: 'Trade counter', role: 'staff', pin: '1101',
    apps: ['orders'], stores: ['s1'], vehicles: [], driverId: null, active: true },
  { id: 'u2', code: '202', name: 'Sipho Zwane', title: 'Trade counter', role: 'staff', pin: '2202',
    apps: ['orders'], stores: ['s2'], vehicles: [], driverId: null, active: true },
  { id: 'u3', code: '203', name: 'Naledi Motaung', title: 'Trade counter', role: 'staff', pin: '3303',
    apps: ['orders'], stores: ['s3'], vehicles: [], driverId: null, active: true },
  { id: 'u4', code: '204', name: 'Farhaan Patel', title: 'Trade counter', role: 'staff', pin: '4404',
    apps: ['orders'], stores: ['s4'], vehicles: [], driverId: null, active: true },

  { id: 'u5', code: '301', name: 'Elmarie Botha', title: 'Fleet controller', role: 'fleet', pin: '5005',
    apps: ['fleet'], stores: [], vehicles: 'all', driverId: null, active: true },
  { id: 'u6', code: '302', name: 'Johan Serfontein', title: 'Workshop — Katlehong', role: 'fleet', pin: '6006',
    apps: ['fleet'], stores: [], vehicles: ['v1', 'v3', 'v6', 'v9', 'v12'], driverId: null, active: true },

  { id: 'u11', code: '401', name: 'Thabo Mokoena', title: 'Driver', role: 'driver', pin: '1001',
    apps: ['fleet'], stores: [], vehicles: ['v1'], driverId: 'd1', active: true },
  { id: 'u12', code: '402', name: 'Sipho Dlamini', title: 'Driver', role: 'driver', pin: '1002',
    apps: ['fleet'], stores: [], vehicles: ['v2'], driverId: 'd2', active: true },
  { id: 'u13', code: '404', name: 'Lucky Mahlangu', title: 'Driver', role: 'driver', pin: '1004',
    apps: ['fleet'], stores: [], vehicles: ['v4'], driverId: 'd4', active: true }
];

function read(key, fb) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

function users() {
  const list = read(KEY_USERS, null);
  if (!list || !list.length) { write(KEY_USERS, SEED_USERS); return SEED_USERS.slice(); }
  return list;
}
function saveUsers(list) { write(KEY_USERS, list); return list; }
function byId(id) { return users().filter(u => u.id === id)[0] || null; }

function session() { return read(KEY_SESSION, null); }
function current() {
  const s = session();
  if (!s || !s.id) return null;
  return u && u.active !== false ? u : null;
}
function byCode(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  return users().find(u => String(u.code) === c) || null;
}
function signIn(idOrCode, pin) {
  // A staff number is what people type; the internal id is what the trade desk
  // still passes. Resolve either, staff number first.
  const target = byCode(idOrCode) || byId(idOrCode);
  if (!target) return { ok: false, error: 'No staff member has that number.' };
  return signInUser(target, pin);
}
function signInUser(u, pin) {
if (u.active === false) return { ok: false, error: u.name + "'s access has been switched off." };
  if (String(pin).trim() !== String(u.pin)) return { ok: false, error: 'That PIN does not match ' + u.name + '.' };
  write(KEY_SESSION, { id: u.id, at: new Date().toISOString() });
  return { ok: true, user: u };
}
function signOut() { write(KEY_SESSION, null); }

function isAdmin(u) { return !!u && u.role === 'admin'; }
function can(u, app) {
  if (!u) return false;
  if (isAdmin(u)) return true;
  return (u.apps || []).indexOf(app) > -1;
}
function appsFor(u) { return APPS.filter(a => can(u, a.key)); }

function storeIds(u) {
  if (!u) return [];
  if (isAdmin(u) || u.stores === 'all') return STORES.map(s => s.id);
  return (u.stores || []).slice();
}
function vehicleIds(u) {
  if (!u) return [];
  if (isAdmin(u) || u.vehicles === 'all') return VEHICLES.map(v => v.id);
  return (u.vehicles || []).slice();
}
function storeName(id) {
  if (id === 'all') return 'All stores';
  const s = STORES.filter(x => x.id === id)[0];
  return s ? s.name : id || '—';
}
function vehicleReg(id) {
  const v = VEHICLES.filter(x => x.id === id)[0];
  return v ? v.reg : id || '—';
}
function roleLabel(key) {
  const r = ROLES.filter(x => x.key === key)[0];
  return r ? r.label : key;
}

/* short human summary of what a login may reach */
function scopeLine(u) {
  if (!u) return '';
  if (isAdmin(u)) return 'Both apps · all four stores · all vehicles';
  const bits = [];
  if (can(u, 'orders')) {
    const s = storeIds(u);
    bits.push('Orders: ' + (s.length === STORES.length ? 'all stores' : s.map(storeName).join(', ') || 'no stores'));
  }
  if (can(u, 'fleet')) {
    const v = vehicleIds(u);
    bits.push('Fleet: ' + (v.length === VEHICLES.length ? 'all vehicles' : v.length + (v.length === 1 ? ' vehicle' : ' vehicles')));
  }
  return bits.join('  ·  ') || 'No access assigned';
}

function nextId() {
  const list = users();
  let n = 20;
  while (list.some(u => u.id === 'u' + n)) n++;
  return 'u' + n;
}
function addUser(u) {
  const list = users().slice();
  const rec = Object.assign({ id: nextId(), active: true, apps: [], stores: [], vehicles: [], driverId: null }, u);
  list.push(rec);
  saveUsers(list);
  return rec;
}
function updateUser(id, patch) {
  const list = users().map(u => (u.id === id ? Object.assign({}, u, patch) : u));
  saveUsers(list);
  return list.filter(u => u.id === id)[0];
}
function removeUser(id) { saveUsers(users().filter(u => u.id !== id)); }
function resetUsers() { saveUsers(SEED_USERS.slice()); }

window.SLGAuth = {
  KEY_USERS, KEY_SESSION, APPS, ROLES, STORES, VEHICLES, SEED_USERS,
  users, saveUsers, byId, session, current, signIn, signOut,
  isAdmin, can, appsFor, storeIds, vehicleIds, storeName, vehicleReg, roleLabel, scopeLine,
  addUser, updateUser, removeUser, resetUsers
};
})();
