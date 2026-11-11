import { execFileSync } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import runtime from './modules/spotaple-runtime/android/src/main/assets/spotaple/runtime.cjs';

const directory = process.argv[2];
const assets = join(import.meta.dirname, 'modules/spotaple-runtime/android/src/main/assets/spotaple/renderer');
const app = await runtime.startRuntime(directory, assets);
await app.close();
await mkdir(join(directory, 'offline'), { recursive: true });
const db = new DatabaseSync(join(directory, 'spotaple.db'));
const queue = [
  { id: 'smokeTrack1', title: 'Spotaple primera prueba', artists: [{ name: 'Spotaple' }], durationSec: 16 },
  { id: 'smokeTrack2', title: 'Spotaple segunda prueba', artists: [{ name: 'Spotaple' }], durationSec: 35 },
];
for (const track of queue) {
  const file = join(directory, 'offline', `${track.id}.webm`);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${track.durationSec}`, '-c:a', 'libopus', file]);
  db.prepare('INSERT INTO tracks(id, title, artists, duration_sec, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    track.id, track.title, JSON.stringify(track.artists), track.durationSec, Date.now(),
  );
  db.prepare('INSERT INTO favorites VALUES (?, ?)').run(track.id, Date.now());
  db.prepare('INSERT INTO downloads VALUES (?, ?, ?, ?)').run(track.id, 'opus', (await stat(file)).size, Date.now());
}
const set = db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)');
const now = new Date();
const monday = new Date(now);
monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
const play = db.prepare('INSERT INTO plays(track_id, played_at) VALUES (?, ?)');
for (let i = 0; i < 15; i++) play.run(queue[0].id, now.getTime() - i * 60_000);
db.prepare('INSERT INTO generated_lists VALUES (?, ?, ?, ?, ?, ?, ?)').run(
  'weekly', '1', monday.toISOString().slice(0, 10), 'Descubrimiento semanal', 'Canciones elegidas para vos', JSON.stringify(queue), now.getTime(),
);
set.run('app_settings', JSON.stringify({ radio: false, forYou: true, normalize: false }));
set.run('player_state', JSON.stringify({ queue, index: 0, positionSec: 0, volume: 0.8, muted: false, repeat: 'off', shuffle: false }));
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();
