import type { AudioLike } from '../../src/renderer/src/player/player';
import type { PreparedAudio, Track } from '../../src/shared/types';

/** Audio simulado: reproduce eventos como lo haría un HTMLAudioElement. */
export class FakeAudio extends EventTarget implements AudioLike {
  src = '';
  currentTime = 0;
  duration = NaN;
  volume = 1;
  muted = false;
  paused = true;
  error: { code: number } | null = null;
  play() {
    this.paused = false;
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
  /** true: el evento 'pause' no sale solo (un navegador real lo dispara más tarde); se dispara con `firePause()`. */
  manualPause = false;
  pendingPause = false;
  pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.manualPause) {
      this.pendingPause = true;
      return;
    }
    this.dispatchEvent(new Event('pause'));
  }
  firePause() {
    if (!this.pendingPause) return;
    this.pendingPause = false;
    this.dispatchEvent(new Event('pause'));
  }
  /** Simula que la fuente se cargó: duración conocida. */
  loaded(duration = 200) {
    this.duration = duration;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  ended() {
    this.dispatchEvent(new Event('ended'));
  }
  fail(code = 4) {
    this.error = { code };
    this.dispatchEvent(new Event('error'));
  }
}

export const track = (n: number): Track => ({ id: `track${String(n).padStart(6, '0')}`, title: `Canción ${n}`, artists: [{ name: 'Artista' }], durationSec: 180 });
export const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i));
export const flush = () => new Promise((r) => setTimeout(r, 0));
export const ok = (id: string): PreparedAudio => ({ trackId: id, mimeType: 'audio/webm' });
