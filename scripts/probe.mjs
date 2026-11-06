// Comprobación de compatibilidad con YouTube (usar cuando algo deje de reproducir):
// busca una canción real y, por cada cliente de InnerTube que usa la app, comprueba que googlevideo
// entrega el archivo COMPLETO (pide un byte del medio). Sale con código 0 si al menos un cliente sirve.
//   npm run check:youtube            (opcional: node scripts/probe.mjs "otra búsqueda")
import vm from 'node:vm';
import { Innertube, Log, Platform } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);
// Mismo aislamiento que src/main/music/youtube/eval.ts: contexto vacío + tiempo máximo.
Platform.shim.eval = (data) => JSON.parse(JSON.stringify(vm.runInNewContext(`(function(){${data.output}})()`, Object.create(null), { timeout: 5000 })));

const CLIENTS = ['VISIONOS', 'ANDROID_VR', 'IOS', 'TV_SIMPLY', 'YTMUSIC'];
const t0 = Date.now();
const yt = await Innertube.create({ retrieve_player: true });
console.log(`sesión creada en ${Date.now() - t0} ms`);

const query = process.argv[2] || 'Daft Punk One More Time';
const search = await yt.music.search(query, { type: 'song' });
const first = search.contents?.[0]?.contents?.[0];
if (!first?.id) throw new Error('la búsqueda no devolvió canciones: la respuesta de YouTube Music cambió');
console.log(`canción: «${first.title}» (${first.id})`);

let working = 0;
for (const client of CLIENTS) {
  try {
    const info = client === 'YTMUSIC' ? await yt.music.getInfo(first.id) : await yt.getBasicInfo(first.id, { client });
    const status = info.playability_status?.status;
    const fmt = info.chooseFormat({ type: 'audio', quality: 'best', format: 'any', codec: 'opus' });
    const url = await fmt.decipher(yt.session.player);
    const len = Number(fmt.content_length);
    const mid = Math.floor(len / 2);
    const head = await fetch(url, { headers: { Range: 'bytes=0-99' } });
    await head.arrayBuffer();
    const deep = await fetch(url, { headers: { Range: `bytes=${mid}-${mid}` } });
    await deep.arrayBuffer();
    const ok = head.status === 206 && deep.status === 206;
    if (ok) working++;
    console.log(`${ok ? 'SIRVE ' : 'NO    '} ${client.padEnd(11)} ${status} itag ${fmt.itag} ${fmt.mime_type.split(';')[0]} · inicio ${head.status} · mitad ${deep.status}`);
  } catch (e) {
    console.log(`ERROR  ${client.padEnd(11)} ${String(e.message).split('\n')[0].slice(0, 80)}`);
  }
}
console.log(working ? `\n${working} cliente(s) entregan el audio completo.` : '\nNingún cliente entrega el audio completo: YouTube cambió algo (ver README, "Límites de la integración").');
process.exit(working ? 0 : 1);
