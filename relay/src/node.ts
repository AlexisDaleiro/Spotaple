/**
 * Relé del Jam sobre Node: el mismo servidor de salas que usa la app en red local, pero con muchas salas
 * por código y traspaso de admin. Sirve para probar el modo Internet sin Cloudflare y para auto-hospedarlo.
 */
import { startNodeHost } from '../../src/main/jam/node-host';

const port = Number(process.env['PORT'] ?? process.argv[2]) || 8787;
const host = await startNodeHost({ port, rooms: 'multi', transferAdmin: true });
console.log(`Relé del Jam escuchando en el puerto ${host.port}: ws://<esta-pc>:${host.port}/<CODIGO>`);
