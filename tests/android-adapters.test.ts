import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deployAndroidRelay } from '../mobile/relay';
import { createAndroidUpdates } from '../mobile/updates';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'spotaple-android-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('actualizaciones de Android', () => {
  const apkUrl = 'https://github.com/AlexisDaleiro/Spotaple/releases/download/android-v0.3.0/Spotaple-Android.apk';
  const bytes = new TextEncoder().encode('apk de prueba');
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

  function fakeReleases(hash: string) {
    return vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([
        { tag_name: 'v9.0.0', prerelease: false, assets: [] },
        { tag_name: 'android-v0.3.0', prerelease: false, assets: [
          { name: 'Spotaple-Android.apk', size: bytes.length, digest: hash, browser_download_url: apkUrl },
        ] },
      ]))
      .mockResolvedValueOnce(new Response(bytes));
  }

  it('descarga el APK de Android, comprueba el digest y pide instalarlo', async () => {
    const fetchImpl = fakeReleases(digest);
    const install = vi.fn();
    const updates = createAndroidUpdates(directory, '0.2.0', vi.fn(), install, fetchImpl);
    await updates.check();
    expect(updates.state()).toEqual({ status: 'ready', version: '0.3.0' });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(apkUrl);
    expect(await readFile(join(directory, 'updates', 'spotaple.apk'))).toEqual(Buffer.from(bytes));
    await updates.install();
    expect(install).toHaveBeenCalledOnce();
  });

  it('descarta un APK cuyo contenido no coincide con GitHub', async () => {
    const install = vi.fn();
    const updates = createAndroidUpdates(directory, '0.2.0', vi.fn(), install, fakeReleases(`sha256:${'0'.repeat(64)}`));
    await updates.check();
    await updates.install();
    expect(updates.state()).toEqual({ status: 'error' });
    expect(install).not.toHaveBeenCalled();
    await expect(readFile(join(directory, 'updates', 'spotaple.apk.part'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

it('prepara el Worker de Jam y conserva las credenciales solo para el despliegue', async () => {
  const source = join(directory, 'worker.mjs');
  await writeFile(source, 'export default { fetch: () => new Response() };');
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const claim = 'https://dash.cloudflare.com/claim-preview?claimToken=example';
  const ok = (result: unknown) => Response.json({ success: true, result });
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(ok({ challengeToken: 'challenge', seed: Buffer.alloc(32).toString('base64url'), k: 2, g: 3 }))
    .mockResolvedValueOnce(ok({ account: { id: 'a'.repeat(32), apiToken: 'temporary', expiresAt }, claim: { url: claim, expiresAt } }))
    .mockResolvedValueOnce(ok({}))
    .mockResolvedValueOnce(ok({}))
    .mockResolvedValueOnce(ok({ subdomain: 'example' }));
  const deployed = await deployAndroidRelay(source, new AbortController().signal, fetchImpl);
  expect(deployed).toEqual({ relay: 'wss://spotaple-jam.example.workers.dev', claim, expiresAt: Date.parse(expiresAt) });
  const accountRequest = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
  expect(accountRequest.acceptTermsOfService).toBe('yes');
  expect(Buffer.from(accountRequest.solution.checkpoints, 'base64')).toHaveLength(96);
  const upload = fetchImpl.mock.calls[2]?.[1];
  expect(upload?.headers).toEqual({ Authorization: 'Bearer temporary' });
  const form = upload?.body as FormData;
  const metadata = JSON.parse(await (form.get('metadata') as Blob).text());
  expect(metadata.migrations).toEqual({ new_tag: 'v1', new_sqlite_classes: ['Room'] });
  expect(metadata.bindings).toEqual([{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'Room' }]);
});
