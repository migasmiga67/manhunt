import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';

const socket = io(import.meta.env.VITE_SERVER_URL || 'https://twoja-apka.onrender.com');

// Stałe id gracza (per karta przeglądarki) - pozwala wrócić do gry po rozłączeniu
const pid = (() => {
  try {
    let v = sessionStorage.getItem('mh_pid');
    if (!v) { v = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('mh_pid', v); }
    return v;
  } catch { return Math.random().toString(36).slice(2); }
})();

const dist = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const useNow = () => { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), 500); return () => clearInterval(t); }, []); return n; };

function useGeo() {
  const [pos, setPos] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    if (!navigator.geolocation) return setErr('Brak GPS w tej przeglądarce');
    const id = navigator.geolocation.watchPosition(
      p => { const q = { lat: p.coords.latitude, lng: p.coords.longitude }; setPos(q); setErr(''); socket.emit('pos', q); },
      e => setErr('Włącz lokalizację: ' + e.message), { enableHighAccuracy: true, maximumAge: 2000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  // cykliczne ponawianie pozycji (stojący gracz też jest widoczny dla serwera)
  useEffect(() => {
    const t = setInterval(() => pos && socket.emit('pos', pos), 3000);
    return () => clearInterval(t);
  }, [pos]);
  return { pos, err };
}

function FlyOnce({ pos, zoom }) { const map = useMap(); const done = useRef(false);
  useEffect(() => { if (pos && !done.current) { map.setView([pos.lat, pos.lng], zoom); done.current = true; } }, [pos]); return null; }
function Picker({ onPick }) { useMapEvents({ click: e => onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) }); return null; }

function GameMap({ area, pos, dots = [], onPick, big, zoom = 16 }) {
  return (
    <div className={'map' + (big ? ' big' : '')}>
      <MapContainer center={[area?.lat ?? pos?.lat ?? 52.23, area?.lng ?? pos?.lng ?? 21.01]} zoom={area ? 16 : pos ? zoom : 6} style={{ height: '100%' }}>
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
        <FlyOnce pos={area ? null : pos} zoom={zoom} />
        {onPick && <Picker onPick={onPick} />}
        {area && <Circle center={[area.lat, area.lng]} radius={area.r} pathOptions={{ color: '#39ff14', fillOpacity: 0.05 }} />}
        {pos && <CircleMarker center={[pos.lat, pos.lng]} radius={9} pathOptions={{ color: '#fff', fillColor: '#d8ffd8', fillOpacity: 1 }}><Tooltip>Ty</Tooltip></CircleMarker>}
        {dots.map(d => <CircleMarker key={d.id} center={[d.pos.lat, d.pos.lng]} radius={8} pathOptions={{ color: '#fff', fillColor: d.color, fillOpacity: 1 }}><Tooltip>{d.name}</Tooltip></CircleMarker>)}
      </MapContainer>
    </div>
  );
}

function Home({ onEnter }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const go = (ev, ...a) => socket.emit(ev, ...a, pid, r => r.error ? setErr(r.error) : onEnter());
  return (
    <div className="stack">
      <h1>Manhunt</h1><p>Chowany z pościgiem. Załóż pokój albo dołącz kodem od znajomych.</p>
      <input placeholder="Twoje imię" value={name} onChange={e => setName(e.target.value)} />
      <button disabled={!name} onClick={() => go('create', name)}>Załóż pokój</button>
      <div className="row"><input placeholder="Kod pokoju" value={code} maxLength={4} onChange={e => setCode(e.target.value.toUpperCase())} />
        <button className="ghost" disabled={!name || code.length < 4} onClick={() => socket.emit('join', code, name, pid, r => r.error ? setErr(r.error) : onEnter())}>Dołącz</button></div>
      {err && <div className="warn">{err}</div>}
    </div>
  );
}

const VARIANT_LABEL = { standard: 'Standard (teren w kole, wszyscy pieszo)', hardcore: 'Hardcore (całe miasto, łowcy mogą jeździć)' };

function Lobby({ g, pos }) {
  const host = g.hostId === g.me, s = g.settings, hard = s.variant === 'hardcore'; const [err, setErr] = useState('');
  const set = p => socket.emit('settings', p);
  const num = (k, label, step = 1) => <label>{label}<input type="number" min="1" step={step} disabled={!host} value={s[k]} onChange={e => set({ [k]: +e.target.value || 1 })} /></label>;
  return (
    <div className="stack">
      <p style={{ margin: '8px 0 0' }}>Kod pokoju</p><div className="code">{g.code}</div>
      <div className="card"><h2>Gracze ({g.players.length})</h2>{g.players.map(p => <div className="pl" key={p.id}><span>{p.name}</span>{p.id === g.hostId && <span>host</span>}</div>)}</div>
      {host ? <>
        <select value={s.variant} onChange={e => set({ variant: e.target.value })}>
          <option value="standard">{VARIANT_LABEL.standard}</option><option value="hardcore">{VARIANT_LABEL.hardcore}</option></select>
        {hard ? <div className="card"><h2>Zasady hardcore</h2>
          <p style={{ margin: 0 }}>Brak granic terenu, cała okolica to plansza. Uciekinierzy poruszają się tylko pieszo. Łowcy mogą używać aut, rowerów i komunikacji. Jeśli uciekinier jedzie szybciej niż biegacz przez ok. 15 s, jego pozycja jest jawna dla łowców przez 60 s. Zasięg łapania: {g.catchM} m.</p></div>
          : <>
            <p>Dotknij mapy, żeby ustawić środek terenu gry.</p>
            <GameMap area={s.area} pos={pos} onPick={c => set({ area: { ...c, r: s.area?.r ?? 150 } })} />
            <label>Promień terenu: {s.area?.r ?? 150} m<input type="range" min="50" max="1000" step="10" value={s.area?.r ?? 150} disabled={!s.area} onChange={e => set({ area: { ...s.area, r: +e.target.value } })} /></label>
          </>}
        <select value={s.mode} onChange={e => set({ mode: e.target.value })}><option value="infection">Zaraza (złapany zostaje łowcą)</option><option value="classic">Klasyczny (złapany odpada)</option></select>
        <div className="row">{num('hunters', 'Łowcy')}{num('hideSec', 'Chowanie (s)', 10)}</div>
        <div className="row">{num('gameSec', 'Czas gry (s)', 30)}{num('radarSec', 'Radar co (s)', 10)}</div>
        <button onClick={() => socket.emit('start', r => r?.error && setErr(r.error))}>Start gry</button>
        {err && <div className="warn">{err}</div>}
      </> : <>
        <p>Tryb: {VARIANT_LABEL[s.variant]}</p>
        <p>Czekaj, aż host ustawi grę i ją uruchomi.</p></>}
    </div>
  );
}

function Game({ g, pos }) {
  const now = useNow(); const [msg, setMsg] = useState('');
  const me = g.players.find(p => p.id === g.me); const hunter = me?.role === 'hunter'; const s = g.settings;
  const hard = s.variant === 'hardcore'; const area = hard ? null : s.area;
  const out = pos && area && dist(pos, area) > area.r;
  const left = g.phaseEnd - now;
  const dots = useMemo(() => [
    ...g.players.filter(p => p.role === 'hunter' && p.pos && p.id !== g.me).map(p => ({ id: p.id, name: p.name, pos: p.pos, color: '#ff4d4d' })),
    ...g.reveal.map(p => ({ id: p.id, name: p.name + ' (radar)', pos: p.pos, color: '#39ff14' })),
    ...(g.exposed || []).map(p => ({ id: 'x' + p.id, name: p.name + ' (pojazd!)', pos: p.pos, color: '#ffa500' }))], [g]);
  const catchIt = id => socket.emit('catch', id, r => setMsg(r?.error || 'Złapany!'));

  if (g.phase === 'hiding' && hunter) return <div className="cover"><p>Jesteś łowcą. Zamknij oczy i nie podglądaj.</p><div className="time">{fmt(left)}</div></div>;
  const caught = me?.caught;
  return (
    <div>
      <div className="hud"><span className="badge" style={{ background: hunter ? 'var(--hun)' : 'var(--run)' }}>{hunter ? 'Łowca' : caught ? 'Złapany' : 'Uciekinier'}{hard ? ' · hardcore' : ''}</span>
        <span className="time">{fmt(left)}</span></div>
      <p style={{ margin: '0 0 8px' }}>{g.phase === 'hiding' ? (hard && !hunter ? 'Ukryj się pieszo, zanim łowcy ruszą.' : 'Ukryj się, zanim łowcy ruszą.') : hunter ? `Radar odświeży się za ${fmt(g.nextReveal - now)}` : caught ? 'Odpadasz z gry. Obserwuj.' : 'Nie daj się złapać do końca czasu.'}</p>
      {out && <div className="warn">Wyszedłeś poza teren gry! Wróć do zielonego koła.</div>}
      {g.vehicle && !hunter && <div className="warn">Wykryto pojazd! Poruszaj się pieszo. Twoja pozycja jest widoczna dla łowców.</div>}
      <GameMap area={area} pos={pos} dots={dots} big zoom={hard ? 14 : 16} />
      {hunter && g.phase === 'playing' && <div className="card" style={{ marginTop: 10 }}>
        <h2>Złap uciekiniera (w zasięgu {g.catchM} m)</h2>
        {g.players.filter(p => p.role === 'runner' && !p.caught).map(p => <div className="pl" key={p.id}><span className="run">{p.name}</span><button style={{ width: 'auto', padding: '6px 14px' }} onClick={() => catchIt(p.id)}>Złap</button></div>)}
        {msg && <p>{msg}</p>}</div>}
    </div>
  );
}

function Ended({ g }) {
  const host = g.hostId === g.me; const win = g.winner === 'hunters';
  return <div className="stack"><h1 className={win ? 'hun' : 'run'}>{win ? 'Wygrali łowcy' : 'Wygrali uciekinierzy'}</h1>
    <div className="card">{g.players.map(p => <div className="pl" key={p.id}><span>{p.name}</span><span className={p.role === 'hunter' ? 'hun' : 'run'}>{p.role === 'hunter' ? 'łowca' : p.caught ? 'złapany' : 'uciekinier'}</span></div>)}</div>
    {host ? <button onClick={() => socket.emit('again')}>Zagraj jeszcze raz</button> : <p>Host może zacząć nową rundę.</p>}</div>;
}

export default function App() {
  const [g, setG] = useState(null); const [inRoom, setIn] = useState(false); const { pos, err } = useGeo();
  useEffect(() => {
    const resume = () => socket.emit('resume', pid, r => r?.ok && setIn(true));
    socket.on('state', setG); socket.on('connect', resume);
    if (socket.connected) resume();
    return () => { socket.off('state', setG); socket.off('connect', resume); };
  }, []);
  // ekran nie gaśnie w trakcie gry
  useEffect(() => {
    if (!inRoom || !navigator.wakeLock) return;
    let lock; const get = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch {} };
    get(); const vis = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, [inRoom]);
  return (
    <div className="app">
      {err && <div className="warn">{err}</div>}
      {!inRoom || !g ? <Home onEnter={() => setIn(true)} />
        : g.phase === 'lobby' ? <Lobby g={g} pos={pos} />
        : g.phase === 'ended' ? <Ended g={g} />
        : <Game g={g} pos={pos} />}
    </div>
  );
}