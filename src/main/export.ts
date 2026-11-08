import { copyFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { exportFileName, formatFromMime, type AudioFormat, type ExportResult } from '../shared/offline';
import type { Track } from '../shared/types';
import { downloadTo } from './download';
import type { MusicProvider } from './music/provider';
import type { Offline } from './offline';

export interface ExportDeps {
  offline: Pick<Offline, 'local'>;
  provider: MusicProvider;
  fetchImpl: typeof fetch;
  /** Diálogo «Guardar como» del sistema (lo abre main: el renderer nunca pasa una ruta). `null` = la persona canceló. */
  pickSavePath: (suggestedName: string, format: AudioFormat) => Promise<string | null>;
}

/**
 * «Descargar canción»: pide dónde guardar y deja la canción ahí en el formato elegido. Si ya está descargada en ese
 * formato copia el archivo local; si no, la baja directo al destino. Cancelar el diálogo no es un error.
 */
export async function exportTrack(d: ExportDeps, track: Track, format: AudioFormat): Promise<ExportResult> {
  const dest = await d.pickSavePath(exportFileName(track, format), format);
  if (!dest) return { saved: false };

  const local = d.offline.local(track.id);
  if (local && formatFromMime(local.mimeType) === format) {
    try {
      await copyFile(local.file, dest);
      return { saved: true, name: basename(dest) };
    } catch {
      /* el archivo local no se pudo leer: se baja de nuevo */
    }
  }
  await downloadTo({ provider: d.provider, fetchImpl: d.fetchImpl, id: track.id, variant: format === 'aac' ? 'aac' : 'high', expect: format, destFor: () => dest });
  return { saved: true, name: basename(dest) };
}
