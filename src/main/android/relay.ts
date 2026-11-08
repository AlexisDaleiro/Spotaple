import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { parseRelayUrl } from '../../shared/jam/invite';

const API = 'https://api.cloudflare.com/client/v4';
const PREVIEW = '/provisioning/previews';
const WORKER = 'spotaple-jam';
const FAILED = 'Cloudflare no pudo preparar el relé. Revisá tu conexión y volvé a intentar.';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

type Challenge = { challengeToken: string; seed: string; k: number; g: number };
type Account = {
  account: { id: string; apiToken: string; expiresAt: string };
  claim: { url: string; expiresAt: string };
};

async function checkpoints(challenge: Challenge, signal: AbortSignal) {
  const { k, g, seed, challengeToken } = challenge;
  const decoded = Buffer.from(seed, 'base64url');
  if (typeof challengeToken !== 'string' || !challengeToken || decoded.length !== 32 ||
    !Number.isSafeInteger(k) || !Number.isSafeInteger(g) || k < 1 || g < 1 || k > 4096 || k * g > 64_000_000) {
    throw new Error(FAILED);
  }
  const digest = (input: Buffer) => createHash('sha256').update(input).digest();
  let hash = digest(decoded);
  const blocks = [hash];
  let iterations = 0;
  for (let segment = 0; segment < k; segment++) {
    for (let step = 0; step < g; step++) {
      hash = digest(hash);
      if (++iterations % 2048 === 0) {
        signal.throwIfAborted();
        await setImmediate();
      }
    }
    blocks.push(hash);
  }
  return { checkpoints: Buffer.concat(blocks).toString('base64') };
}

export async function deployAndroidRelay(source: string, signal: AbortSignal, fetchImpl: typeof fetch) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(API + path, { ...init, redirect: 'error', signal: deadline });
    if (!response.ok) throw new Error(FAILED);
    const body = await response.json() as { success: boolean; result: T };
    if (!body.success) throw new Error(FAILED);
    return body.result;
  }
  try {
    const worker = await readFile(source);
    const challenge = await call<Challenge>(PREVIEW + '/challenge', {
      method: 'POST', headers: JSON_HEADERS, body: '{}',
    });
    const solution = await checkpoints(challenge, deadline);
    const { account, claim } = await call<Account>(PREVIEW, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        termsOfService: 'https://www.cloudflare.com/terms/',
        privacyPolicy: 'https://www.cloudflare.com/privacypolicy/',
        acceptTermsOfService: 'yes', challengeToken: challenge.challengeToken, solution,
      }),
    });
    const url = URL.parse(claim.url);
    const expiresAt = Math.min(Date.parse(claim.expiresAt), Date.parse(account.expiresAt));
    if (!url || url.origin !== 'https://dash.cloudflare.com' || url.username || url.password ||
      url.pathname !== '/claim-preview' || !url.searchParams.get('claimToken') ||
      !/^[a-f0-9]{32}$/.test(account.id) || !account.apiToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error(FAILED);
    }
    const headers = { Authorization: `Bearer ${account.apiToken}` };
    const workers = `/accounts/${account.id}/workers`;
    const script = `${workers}/scripts/${WORKER}`;
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
      main_module: 'worker.mjs', compatibility_date: '2025-06-01',
      bindings: [{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'Room' }],
      migrations: { new_tag: 'v1', new_sqlite_classes: ['Room'] },
    })], { type: 'application/json' }), 'metadata.json');
    form.append('worker.mjs', new Blob([worker], { type: 'application/javascript+module' }), 'worker.mjs');
    await call(script, { method: 'PUT', headers, body: form });
    await call(script + '/subdomain', { method: 'POST', headers: { ...headers, ...JSON_HEADERS }, body: '{"enabled":true}' });
    const { subdomain } = await call<{ subdomain: string }>(workers + '/subdomain', { headers });
    const relay = /^[a-z0-9-]+$/.test(subdomain) && parseRelayUrl(`wss://${WORKER}.${subdomain}.workers.dev`);
    if (!relay) throw new Error(FAILED);
    return { relay, claim: url.href, expiresAt };
  } catch {
    throw new Error(FAILED);
  }
}
