import type { MusicProvider } from './music/provider';

/**
 * Una canción descargada suena del disco, así que su loudness solo está si se guardó al bajarla. Las que se bajaron
 * antes de existir «Normalizar volumen» no lo tienen: al reproducirlas con «Normalizar» activo se le pide a YouTube,
 * una sola vez por sesión y canción (sin red no se insiste), y se guarda. Espera `timeoutMs` como mucho; si tarda más,
 * esa reproducción sale sin ajuste y el dato se guarda igual cuando llega, para las siguientes.
 */
export function createLoudnessFill(d: {
  provider: Pick<MusicProvider, 'resolveAudio'>;
  store: { setLoudness(trackId: string, lkfs: number): void };
  enabled: () => boolean;
  timeoutMs?: number;
}): (trackId: string) => Promise<number | undefined> {
  const tried = new Set<string>();
  const timeoutMs = d.timeoutMs ?? 2000;
  return async (trackId) => {
    if (!d.enabled() || tried.has(trackId)) return undefined;
    tried.add(trackId);
    const job = d.provider.resolveAudio(trackId).then(
      (a) => {
        if (a.loudnessLkfs !== undefined) d.store.setLoudness(trackId, a.loudnessLkfs);
        return a.loudnessLkfs;
      },
      () => undefined,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    try {
      return await Promise.race([job, limit]);
    } finally {
      clearTimeout(timer);
    }
  };
}
