import { spawnSync } from 'node:child_process';

// npm reexporta su política de scripts al lanzar otro npm. El relé tiene su propio proyecto y lockfile.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_allow_scripts$/i.test(key)));
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--prefix', 'relay', '--include=dev'], { env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
