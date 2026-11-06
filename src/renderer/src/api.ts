import type { SpotapleApi } from '@shared/api';
import type { ErrorCode, IpcResult } from '@shared/types';

/** Error con código, reconstruido aquí porque las clases Error no sobreviven al contextBridge. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const unwrap = <T>(res: IpcResult<T>): T => {
  if (res.ok) return res.data;
  throw new AppError(res.error.code, res.error.message);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapApi(raw: any): any {
  if (typeof raw === 'function') return (...args: unknown[]) => raw(...args).then(unwrap);
  if (raw && typeof raw === 'object') return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, unwrapApi(v)]));
  return raw;
}

export const bridgeAvailable = typeof window !== 'undefined' && Boolean(window.spotapleBridge);

/** API tipada. Cada método devuelve el dato o lanza `AppError`. */
export const api: SpotapleApi = bridgeAvailable ? unwrapApi(window.spotapleBridge) : (undefined as unknown as SpotapleApi);

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Algo salió mal. Probá de nuevo.');
