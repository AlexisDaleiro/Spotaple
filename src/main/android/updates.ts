import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UpdateState } from '../../shared/updates';

const REPO = 'AlexisDaleiro/Spotaple';
const MAX_APK = 300 * 1024 * 1024;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareVersion(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  return left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!;
}

export function createAndroidUpdates(
  dataDir: string,
  current: string,
  emit: (state: UpdateState) => void,
  requestInstall: () => void,
  fetchImpl: typeof fetch = fetch,
) {
  let state: UpdateState = { status: SEMVER.test(current) ? 'idle' : 'unsupported' };
  const dir = join(dataDir, 'updates');
  const temporary = join(dir, 'spotaple.apk.part');
  const set = (next: UpdateState) => {
    state = next;
    emit(next);
  };

  return {
    state: () => state,
    async check() {
      if (state.status !== 'idle' && state.status !== 'current' && state.status !== 'error') return;
      set({ status: 'checking' });
      try {
        const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error('No se pudo consultar GitHub.');
        const releases = await response.json() as {
          tag_name: string;
          prerelease: boolean;
          assets: { name: string; size: number; digest: string | null; browser_download_url: string }[];
        }[];
        const available = releases.flatMap((release) => {
          const version = release.tag_name.replace(/^android-v/, '');
          if (release.prerelease || release.tag_name !== `android-v${version}` || !SEMVER.test(version)) return [];
          const asset = release.assets.find((item) => item.name === 'Spotaple-Android.apk' &&
            item.browser_download_url === `https://github.com/${REPO}/releases/download/android-v${version}/Spotaple-Android.apk` &&
            item.size > 0 && item.size <= MAX_APK && /^sha256:[a-f0-9]{64}$/.test(item.digest ?? ''));
          return asset ? [{ version, asset }] : [];
        }).sort((a, b) => compareVersion(b.version, a.version))[0];
        if (!available || compareVersion(available.version, current) <= 0) {
          set({ status: 'current' });
          return;
        }
        const { version, asset } = available;
        await mkdir(dir, { recursive: true });
        set({ status: 'downloading', version, percent: 0 });
        const download = await fetchImpl(asset.browser_download_url, { signal: AbortSignal.timeout(180_000) });
        if (!download.ok || !download.body) throw new Error('No se pudo descargar el APK.');
        const hash = createHash('sha256');
        let bytes = 0;
        let progress = 0;
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            if (bytes > asset.size) {
              callback(new Error('Tamaño de APK inesperado.'));
              return;
            }
            hash.update(chunk);
            const percent = Math.floor(bytes * 100 / asset.size);
            if (percent !== progress) {
              progress = percent;
              set({ status: 'downloading', version, percent });
            }
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(download.body as import('node:stream/web').ReadableStream), meter, createWriteStream(temporary));
        if (bytes !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest) throw new Error('APK incompleto.');
        await rename(temporary, join(dir, 'spotaple.apk'));
        set({ status: 'ready', version });
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined);
        set({ status: 'error' });
      }
    },
    async install() {
      if (state.status === 'ready') requestInstall();
    },
  };
}
