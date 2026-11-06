// Sonda de red del modo Jam: comprueba si dos PCs (o esta PC y un servidor) pueden hablarse por WebSocket.
//   npm run check:jam -- listen [puerto]         escucha (por defecto 47800) y responde pong
//   npm run check:jam -- connect <host:puerto>    se conecta al "listen" de otra PC
//   npm run check:jam -- url <ws(s)://...>        prueba cualquier servidor (p. ej. el relé de internet)
// Usa el mismo ping/pong JSON del protocolo del jam, así también sirve contra el relé.
import os from 'node:os';
import { WebSocketServer } from 'ws';

const [mode, arg] = process.argv.slice(2);
const TIMEOUT_MS = 8000;

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function listen(port) {
  const wss = new WebSocketServer({ port, host: '0.0.0.0' });
  wss.on('connection', (ws) =>
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(String(data));
        if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id, serverTime: Date.now() }));
      } catch {
        /* mensaje que no es del protocolo: se ignora */
      }
    }),
  );
  wss.on('listening', () => {
    const ips = lanAddresses();
    console.log(`Escuchando en el puerto ${port}. Desde otra PC: npm run check:jam -- connect ${ips[0] ?? '<ip>'}:${port}`);
    console.log(`Direcciones de esta PC: ${ips.join(', ') || '(ninguna)'}`);
    console.log('Si Windows pregunta por el firewall, permití el acceso en redes privadas. Ctrl+C para salir.');
  });
  wss.on('error', (e) => (console.log(`FAIL  no se pudo escuchar: ${e.message}`), process.exit(1)));
}

function probe(url) {
  const proxy = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].filter((k) => process.env[k]);
  console.log(`Conectando a ${url}${proxy.length ? ` (el entorno define ${proxy.join(', ')}; el WebSocket de Node no lo usa)` : ''}`);
  let done = false;
  const finish = (ok, msg) => {
    if (done) return;
    done = true;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${msg}`);
    process.exit(ok ? 0 : 1);
  };
  setTimeout(() => finish(false, 'sin respuesta en 8 s (firewall, proxy o una red que aísla los equipos entre sí)'), TIMEOUT_MS);
  const ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'ping', id: 1 }));
  ws.onmessage = (e) => {
    try {
      if (JSON.parse(String(e.data)).t === 'pong') finish(true, 'ping→pong');
    } catch {
      /* se sigue esperando el pong */
    }
  };
  ws.onerror = (e) => finish(false, `error de conexión${e.message ? `: ${e.message}` : ''}`);
  ws.onclose = () => finish(false, 'el servidor cerró la conexión sin responder');
}

if (mode === 'listen') listen(Number(arg) || 47800);
else if (mode === 'connect' && arg) probe(`ws://${arg}/`);
else if (mode === 'url' && arg) probe(arg);
else {
  console.log('Uso: check:jam -- listen [puerto] | connect <host:puerto> | url <ws(s)://...>');
  process.exit(2);
}
