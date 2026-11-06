// Verifica el relé real sin abrir Electron ni reproducir audio.
// npm run check:relay -- wss://spotaple-jam.<subdominio>.workers.dev
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const target = process.argv[2] ?? process.env.SPOTAPLE_JAM_RELAY;
if (!target) {
  console.error('Uso: npm run check:relay -- <ws(s)://relé> (o SPOTAPLE_JAM_RELAY)');
  process.exit(2);
}
const base = new URL(target);
if (!['ws:', 'wss:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
  throw new Error('La dirección debe ser ws:// o wss://, sin credenciales, parámetros ni fragmentos.');
}
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const code = Array.from(randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
const url = `${base.href.replace(/\/+$/, '')}/${code}`;
const peers = [];

async function connect(id, name, create = false) {
  const ws = new WebSocket(url);
  const messages = [];
  const peer = {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    async until(predicate) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        const error = messages.find((m) => m.t === 'error');
        if (error) throw new Error(`El relé respondió ${error.code}`);
        if (ws.readyState === WebSocket.CLOSED) throw new Error('El relé cerró la conexión.');
        await sleep(25);
      }
      throw new Error('El relé no devolvió el estado esperado en 10 s.');
    },
  };
  peers.push(peer);
  ws.onmessage = (event) => {
    try { messages.push(JSON.parse(String(event.data))); } catch { /* ignora datos ajenos al protocolo */ }
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No se pudo abrir el WebSocket en 10 s.')), 10_000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Falló la conexión WebSocket.')); };
  });
  peer.send({ t: 'hello', protocol: 1, memberId: id, name, ...(create ? { create: true } : {}) });
  await peer.until((m) => m.t === 'state' && m.state.members.some((member) => member.id === id));
  return peer;
}

try {
  const adminId = `probe-admin-${randomBytes(8).toString('hex')}`;
  const memberId = `probe-member-${randomBytes(8).toString('hex')}`;
  const admin = await connect(adminId, 'Prueba admin', true);
  const member = await connect(memberId, 'Prueba miembro');
  await admin.until((m) => m.t === 'state' && m.state.members.length === 2);
  console.log('OK  crear sala y unir dos clientes');

  admin.send({ t: 'ping', id: 1 });
  await admin.until((m) => m.t === 'pong' && m.id === 1 && Number.isFinite(m.serverTime));
  console.log('OK  ping/pong y reloj del servidor');

  member.send({ t: 'queue.add', track: { id: 'wU26xVT_vBU', title: 'Prueba de conexión', artists: [{ name: 'Spotaple' }] } });
  await admin.until((m) => m.t === 'state' && m.state.now?.item.track.id === 'wU26xVT_vBU');
  console.log('OK  canción pedida por el miembro llega al admin');

  member.send({ t: 'like.toggle' });
  await admin.until((m) => m.t === 'state' && m.state.members.find((entry) => entry.id === memberId)?.likesReceived === 1);
  admin.send({ t: 'mode.set', mode: 'everyone' });
  await member.until((m) => m.t === 'state' && m.state.mode === 'everyone');
  console.log('OK  likes y cambio de modo compartidos');

  admin.send({ t: 'leave' });
  await member.until((m) => m.t === 'state' && m.state.adminId === memberId && m.state.members.length === 1);
  console.log('OK  traspaso de admin al salir');
  member.send({ t: 'leave' });
  await member.until((m) => m.t === 'state' && m.state.closed);
  console.log('OK  cierre de la sala de prueba');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const { ws, send } of peers) {
    if (ws.readyState === WebSocket.OPEN) send({ t: 'leave' });
    try { ws.close(); } catch { /* ya cerrado */ }
  }
}
