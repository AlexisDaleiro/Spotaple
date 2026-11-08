import { describe, expect, it } from 'vitest';
import { sanitizeExportRequest } from '../src/main/validate';

const track = { id: 'abcDEF12345', title: 'One More Time', artists: [{ name: 'Daft Punk' }] };

describe('sanitizeExportRequest', () => {
  it('acepta una canción y un formato válidos', () => {
    expect(sanitizeExportRequest({ track, format: 'aac' })).toMatchObject({ track: { id: 'abcDEF12345', title: 'One More Time' }, format: 'aac' });
    expect(sanitizeExportRequest({ track, format: 'opus' }).format).toBe('opus');
  });

  it('rechaza un formato que no existe', () => {
    expect(() => sanitizeExportRequest({ track, format: 'mp3' })).toThrow('Solicitud inválida.');
    expect(() => sanitizeExportRequest({ track })).toThrow('Solicitud inválida.');
  });

  it('rechaza una canción sin id o un pedido que no es objeto', () => {
    expect(() => sanitizeExportRequest({ track: { ...track, id: undefined }, format: 'opus' })).toThrow('Solicitud inválida.');
    expect(() => sanitizeExportRequest(null)).toThrow('Solicitud inválida.');
    expect(() => sanitizeExportRequest('opus')).toThrow('Solicitud inválida.');
  });
});
