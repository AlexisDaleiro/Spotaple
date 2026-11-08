import { describe, expect, it, vi } from 'vitest';
import { createRelaySetup, readDeployment } from '../src/main/jam/relay-setup';

const relay = 'wss://spotaple-jam.anfitrion.workers.dev';
const claim = 'https://dash.cloudflare.com/claim-preview?claimToken=prueba';

describe('configuración del relé de Jam', () => {
  it('solo acepta la dirección del Worker y el enlace de activación de Cloudflare', () => {
    const log = `Temporary account ready:\r\n  Claim URL: ${claim}\r\nUploaded spotaple-jam\r\n  ${relay.replace('wss:', 'https:')}\r\n`;
    expect(readDeployment(log)).toEqual({ relay, claim });
    expect(readDeployment(log.replace('dash.cloudflare.com', 'dash.cloudflare.com.example.org'))).toBeNull();
    expect(readDeployment(log.replace('.workers.dev', '.example.org'))).toBeNull();
  });

  it('espera el consentimiento y conserva el relé solo después de comprobarlo', async () => {
    const deploy = vi.fn(async () => ({ relay, claim }));
    const save = vi.fn();
    const open = vi.fn(async () => {});
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ service: 'spotaple-jam', protocol: 1 }));
    const setup = createRelaySetup({ source: '', stored: null, deploy, save, open, fetch, emit: vi.fn() });
    await expect(setup.prepare(false)).rejects.toThrow('Aceptá');
    expect(deploy).not.toHaveBeenCalled();

    await Promise.all([setup.prepare(true), setup.prepare(true)]);
    expect(deploy).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledExactlyOnceWith(claim);
    expect(setup.state()).toBe('claim');
    expect(setup.url()).toBeNull();

    await expect(setup.activate()).rejects.toThrow('No se pudo comprobar');
    expect(setup.state()).toBe('claim');
    expect(save).not.toHaveBeenCalled();

    await setup.activate();
    expect(setup.state()).toBe('ready');
    expect(setup.url()).toBe(relay);
    expect(save).toHaveBeenCalledExactlyOnceWith(relay);
  });
});
