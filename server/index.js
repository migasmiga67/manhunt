import express from 'express'; import http from 'http'; import cors from 'cors'; import { Server } from 'socket.io';
const app = express(); app.use(cors()); app.get('/', (_, r) => r.send('manhunt server ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = {};

// Ustawienia domyślne dla obu wariantów
const PRESETS = {
  standard: { hideSec: 90, gameSec: 900, radarSec: 60, catchM: 25 },
  hardcore: { hideSec: 600, gameSec: 5400, radarSec: 300, catchM: 40 },
};
const FOOT_MS = 6;            // m/s (~21,6 km/h) - szybciej niż to = pojazd
const FAST_HOLD = 15000;      // ms ciągłej prędkości, zanim uznamy to za pojazd
const EXPOSE_MS = 60000;      // ms jawnej pozycji uciekiniera po wykryciu pojazdu
const GRACE_MS = 5 * 60 * 1000; // czas na powrót po rozłączeniu (blokada ekranu itp.)

const catchM = r => PRESETS[r.settings.variant].catchM;
const dist = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const newCode = () => { let c; do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms[c]); return c; };
const active = r => Object.values(r.players).filter(p => p.role === 'runner' && !p.caught);
const clampN = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
const cleanName = n => String(n || '').trim().slice(0, 20) || 'Gracz';
const mkPlayer = (pid, name) => ({ id: pid, sid: null, name: cleanName(name), role: null, pos: null, caught: false, hist: [], fastSince: 0, exposedUntil: 0, timer: null });

function view(r, pid) {
  const me = r.players[pid]; const hunter = me?.role === 'hunter'; const now = Date.now();
  const players = Object.values(r.players).map(p => ({ id: p.id, name: p.name, role: p.role, caught: p.caught,
    pos: p.id === pid ? p.pos : (hunter && p.role === 'hunter') ? p.pos : null }));
  const exposed = hunter && r.phase === 'playing'
    ? active(r).filter(p => p.pos && p.exposedUntil > now).map(p => ({ id: p.id, name: p.name, pos: p.pos })) : [];
  return { code: r.code, hostId: r.hostId, settings: r.settings, phase: r.phase, phaseEnd: r.phaseEnd, nextReveal: r.nextReveal,
    winner: r.winner, players, reveal: hunter && r.phase === 'playing' ? r.reveal : [], revealAt: r.revealAt,
    exposed, vehicle: !!me && me.exposedUntil > now, catchM: catchM(r), me: pid };
}
const push = r => Object.values(r.players).forEach(p => p.sid && io.to(p.sid).emit('state', view(r, p.id)));
const end = (r, w) => { r.phase = 'ended'; r.winner = w; };

function removePlayer(r, pid) {
  const p = r.players[pid]; if (!p) return;
  clearTimeout(p.timer); delete r.players[pid];
  const ids = Object.keys(r.players);
  if (!ids.length) { delete rooms[r.code]; return; }
  if (r.hostId === pid) r.hostId = ids.find(i => r.players[i].sid) || ids[0];
  if (r.phase === 'playing' && !active(r).length) end(r, 'hunters');
  push(r);
}
const findRoomOf = pid => Object.values(rooms).find(r => r.players[pid]);
function bind(s, r, p) { clearTimeout(p.timer); p.sid = s.id; s.data.code = r.code; s.data.pid = p.id; }

// Wykrywanie pojazdu (tylko hardcore, tylko uciekinierzy)
function checkSpeed(r, p, now) {
  if (r.settings.variant !== 'hardcore' || p.role !== 'runner' || p.caught || !['hiding', 'playing'].includes(r.phase)) return;
  p.hist = p.hist.filter(h => now - h.t <= 30000); p.hist.push({ pos: p.pos, t: now });
  const old = p.hist[0]; if (now - old.t < 10000) return;
  const v = dist(old.pos, p.pos) / ((now - old.t) / 1000);
  if (v > FOOT_MS) {
    p.fastSince = p.fastSince || now;
    if (now - p.fastSince >= FAST_HOLD) p.exposedUntil = Math.max(now, r.phase === 'hiding' ? r.phaseEnd : now) + EXPOSE_MS;
  } else p.fastSince = 0;
}

io.on('connection', s => {
  const room = () => rooms[s.data.code];
  const me = () => room()?.players[s.data.pid];
  const isHost = r => r && r.hostId === s.data.pid;

  s.on('create', (name, pid, cb) => {
    if (!pid) return cb?.({ error: 'Brak id gracza' });
    const old = findRoomOf(pid); if (old) removePlayer(old, pid);
    const code = newCode();
    const r = rooms[code] = { code, hostId: pid, players: {}, phase: 'lobby', reveal: [],
      settings: { mode: 'infection', variant: 'standard', hunters: 1, hideSec: 90, gameSec: 900, radarSec: 60, area: null } };
    const p = r.players[pid] = mkPlayer(pid, name); bind(s, r, p);
    cb?.({ ok: true, code }); push(r);
  });
  s.on('join', (code, name, pid, cb) => {
    if (!pid) return cb?.({ error: 'Brak id gracza' });
    const r = rooms[String(code).toUpperCase()];
    if (!r) return cb?.({ error: 'Nie ma takiego pokoju' });
    let p = r.players[pid];
    if (!p) {
      if (r.phase !== 'lobby') return cb?.({ error: 'Gra już trwa' });
      const old = findRoomOf(pid); if (old) removePlayer(old, pid);
      p = r.players[pid] = mkPlayer(pid, name);
    }
    bind(s, r, p); cb?.({ ok: true, code: r.code }); push(r);
  });
  // powrót po rozłączeniu / odświeżeniu strony
  s.on('resume', (pid, cb) => {
    const r = pid && findRoomOf(pid);
    if (!r) return cb?.({ error: 'none' });
    bind(s, r, r.players[pid]); cb?.({ ok: true }); push(r);
  });
  s.on('settings', patch => {
    const r = room(); if (!isHost(r) || r.phase !== 'lobby' || !patch) return;
    const st = r.settings;
    if (typeof patch.variant === 'string' && Object.hasOwn(PRESETS, patch.variant) && patch.variant !== st.variant) {
      st.variant = patch.variant;
      const { hideSec, gameSec, radarSec } = PRESETS[patch.variant]; Object.assign(st, { hideSec, gameSec, radarSec });
    }
    if (patch.mode === 'infection' || patch.mode === 'classic') st.mode = patch.mode;
    if ('hunters' in patch) st.hunters = clampN(patch.hunters, 1, 20, st.hunters);
    if ('hideSec' in patch) st.hideSec = clampN(patch.hideSec, 10, 3600, st.hideSec);
    if ('gameSec' in patch) st.gameSec = clampN(patch.gameSec, 60, 14400, st.gameSec);
    if ('radarSec' in patch) st.radarSec = clampN(patch.radarSec, 5, 1800, st.radarSec);
    if ('area' in patch) {
      const a = patch.area;
      st.area = a && Number.isFinite(+a.lat) && Number.isFinite(+a.lng) ? { lat: +a.lat, lng: +a.lng, r: clampN(a.r, 50, 1000, 150) } : null;
    }
    push(r);
  });
  s.on('start', cb => {
    const r = room(); if (!isHost(r)) return;
    const ps = Object.values(r.players);
    if (ps.length < 2) return cb?.({ error: 'Potrzeba min. 2 graczy' });
    if (r.settings.variant === 'standard' && !r.settings.area) return cb?.({ error: 'Zaznacz teren gry na mapie' });
    const shuffled = ps.sort(() => Math.random() - 0.5);
    const h = Math.min(r.settings.hunters, ps.length - 1);
    shuffled.forEach((p, i) => { p.role = i < h ? 'hunter' : 'runner'; p.caught = false; p.hist = []; p.fastSince = 0; p.exposedUntil = 0; });
    r.phase = 'hiding'; r.phaseEnd = Date.now() + r.settings.hideSec * 1000; r.reveal = []; r.winner = null; push(r);
  });
  s.on('pos', pos => {
    const p = me(); const r = room();
    if (!p || !pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;
    p.pos = { lat: pos.lat, lng: pos.lng }; checkSpeed(r, p, Date.now());
  });
  s.on('catch', (targetId, cb) => {
    const r = room(), p = me(), t = r?.players[targetId];
    if (!r || r.phase !== 'playing' || p?.role !== 'hunter' || !t || t.role !== 'runner' || t.caught) return cb?.({ error: 'Nie można złapać' });
    if (!p.pos || !t.pos || dist(p.pos, t.pos) > catchM(r)) return cb?.({ error: `Za daleko (max ${catchM(r)} m)` });
    if (r.settings.mode === 'infection') { t.role = 'hunter'; t.exposedUntil = 0; } else t.caught = true;
    if (!active(r).length) end(r, 'hunters');
    cb?.({ ok: true }); push(r);
  });
  s.on('again', () => {
    const r = room();
    if (isHost(r)) { r.phase = 'lobby'; Object.values(r.players).forEach(p => { p.role = null; p.caught = false; p.exposedUntil = 0; p.hist = []; }); push(r); }
  });
  // wyjście z pokoju (każdy gracz)
  s.on('leave', cb => {
    const r = room(), p = me();
    if (r && p) removePlayer(r, p.id);
    s.data.code = null;
    cb?.({ ok: true });
  });
  // zamknięcie pokoju dla wszystkich (tylko host)
  s.on('close', cb => {
    const r = room(); if (!isHost(r)) return cb?.({ error: 'Tylko host może zamknąć pokój' });
    Object.values(r.players).forEach(p => { clearTimeout(p.timer); p.sid && io.to(p.sid).emit('closed'); });
    delete rooms[r.code];
    cb?.({ ok: true });
  });
  s.on('disconnect', () => {
    const r = room(), p = me(); if (!r || !p || p.sid !== s.id) return;
    p.sid = null;
    p.timer = setTimeout(() => removePlayer(r, p.id), r.phase === 'lobby' ? 20000 : GRACE_MS);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const r of Object.values(rooms)) {
    if (r.phase === 'hiding' && now >= r.phaseEnd) { r.phase = 'playing'; r.phaseEnd = now + r.settings.gameSec * 1000; r.nextReveal = now; }
    if (r.phase === 'playing') {
      if (now >= r.nextReveal) { r.reveal = active(r).filter(p => p.pos).map(p => ({ id: p.id, name: p.name, pos: p.pos })); r.revealAt = now; r.nextReveal = now + r.settings.radarSec * 1000; }
      if (now >= r.phaseEnd) end(r, 'runners');
    }
    push(r);
  }
}, 1000);
server.listen(process.env.PORT || 3001, () => console.log('server up'));