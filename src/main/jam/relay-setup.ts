import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { JAM_RELAY_HEALTH_PATH, JAM_RELAY_SERVICE, type JamRelayStatus } from '../../shared/jam/config';
import { parseRelayUrl } from '../../shared/jam/invite';
import { PROTOCOL } from '../../shared/jam/types';

interface PendingRelay {
  relay: string;
  claim: string;
  expiresAt?: number;
}

export function readDeployment(output: string): PendingRelay | null {
  const claimText = /^\s*Claim URL:\s*(\S+)\s*$/m.exec(output)?.[1];
  const claim = claimText ? URL.parse(claimText) : null;
  if (!claim || claim.origin !== 'https://dash.cloudflare.com' || claim.username || claim.password ||
      claim.pathname !== '/claim-preview' || !claim.searchParams.get('claimToken')) return null;
  const relay = output.split(/\r?\n/).map(parseRelayUrl).find(Boolean);
  return relay ? { relay, claim: claim.href } : null;
}

async function deployRelay(source: string, signal: AbortSignal): Promise<PendingRelay> {
  const cli = join(source, 'relay/node_modules/wrangler/wrangler-dist/cli.js');
  const preload = join(source, 'relay/src/wrangler-electron.cjs');
  if (!existsSync(cli)) throw new Error('Faltan los archivos para configurar Cloudflare. En desarrollo, ejecutá npm ci --prefix relay.');
  if (process.platform !== 'win32' && existsSync(join(homedir(), '.wrangler'))) {
    throw new Error('La configuración automática del relé requiere el instalador de Windows.');
  }
  const work = await mkdtemp(join(tmpdir(), 'spotaple-jam-'));
  try {
    const config = join(work, 'relay/wrangler.toml');
    await mkdir(dirname(config), { recursive: true });
    await Promise.all([
      cp(join(source, 'relay/wrangler.toml'), config),
      cp(join(source, 'relay/src/worker.ts'), join(work, 'relay/src/worker.ts')),
      cp(join(source, 'src/shared'), join(work, 'src/shared'), { recursive: true }),
    ]);

    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CLOUDFLARE_|CF_|WRANGLER_|ELECTRON_|NODE_OPTIONS$|NODE_PATH$|USERPROFILE$|XDG_CONFIG_HOME$|XDG_CACHE_HOME$)/i.test(key)));
    // Un directorio por intento: Wrangler no debe leer la cuenta local ni conservar las credenciales temporales.
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--require', preload, cli, 'deploy', '--temporary', '--config', config], {
        cwd: dirname(config),
        env: {
          ...env,
          USERPROFILE: work,
          ELECTRON_RUN_AS_NODE: '1',
          XDG_CONFIG_HOME: join(work, 'config'),
          XDG_CACHE_HOME: join(work, 'cache'),
          CLOUDFLARE_AUTH_USE_KEYRING: 'false',
          WRANGLER_LOG_PATH: join(work, 'wrangler.log'),
          WRANGLER_SEND_METRICS: 'false',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
      });
      let captured = '';
      let failed = false;
      child.on('error', () => { failed = true; });
      const collect = (chunk: Buffer) => { captured = (captured + chunk.toString()).slice(-64_000); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('close', (code) => {
        if (code === 0 && !failed) resolve(captured);
        else reject(new Error('Cloudflare no pudo preparar el relé. Revisá tu conexión y volvé a intentar.'));
      });
    });
    const result = readDeployment(output);
    if (!result) throw new Error('Cloudflare no devolvió la dirección del relé. Volvé a intentar.');
    return result;
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

export function createRelaySetup(d: {
  source: string;
  stored: unknown;
  override?: string;
  save(url: string): void;
  emit(status: JamRelayStatus): void;
  open(url: string): Promise<void>;
  fetch: typeof fetch;
  deploy?: typeof deployRelay;
}) {
  let url = parseRelayUrl(d.stored);
  let pending: PendingRelay | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let task: Promise<void> | null = null;
  const shutdown = new AbortController();
  const state = (): JamRelayStatus => d.override || url ? 'ready' : pending ? 'claim' : task ? 'preparing' : 'unconfigured';
  const openClaim = async () => {
    if (!pending) throw new Error('Primero prepará el relé.');
    try {
      await d.open(pending.claim);
    } catch {
      throw new Error('No se pudo abrir Cloudflare en el navegador. Volvé a intentar desde Jam.');
    }
  };

  return {
    state,
    url: () => url,
    async prepare(accepted: boolean) {
      if (!accepted) throw new Error('Aceptá las condiciones de Cloudflare para preparar el relé.');
      if (d.override || url || task) return;
      clearTimeout(expiry);
      pending = null;
      task = (d.deploy ?? deployRelay)(d.source, shutdown.signal).then((result) => {
        pending = result;
        if (result.expiresAt) {
          expiry = setTimeout(() => {
            if (pending !== result) return;
            pending = null;
            d.emit(state());
          }, Math.max(0, result.expiresAt - Date.now()));
          expiry.unref();
        }
      });
      d.emit(state());
      try {
        await task;
      } finally {
        task = null;
        d.emit(state());
      }
      if (!shutdown.signal.aborted) await openClaim();
    },
    openClaim,
    async activate() {
      if (!pending || url) return;
      const candidate = pending;
      try {
        const check = await d.fetch(candidate.relay.replace(/^wss:/, 'https:') + JAM_RELAY_HEALTH_PATH, {
          redirect: 'error', signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(10_000)]),
        });
        const info = check.ok ? await check.json() as { service?: string; protocol?: number } : null;
        if (info?.service !== JAM_RELAY_SERVICE || info.protocol !== PROTOCOL) throw new Error();
      } catch {
        throw new Error('No se pudo comprobar el relé. Revisá que hayas terminado la activación en Cloudflare.');
      }
      if (pending !== candidate) return;
      d.save(candidate.relay);
      url = candidate.relay;
      pending = null;
      clearTimeout(expiry);
      d.emit(state());
    },
    async stop() {
      shutdown.abort();
      await task?.catch(() => undefined);
      clearTimeout(expiry);
    },
  };
}

export type RelaySetup = ReturnType<typeof createRelaySetup>;
