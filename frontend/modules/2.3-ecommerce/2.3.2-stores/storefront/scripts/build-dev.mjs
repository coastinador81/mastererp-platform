import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const values = Object.fromEntries(
  readFileSync(new URL('../.env.dev', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=');
      if (separator < 1) throw new Error(`Invalid DEV environment line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

if (process.argv.includes('--local')) {
  values.EXPO_PUBLIC_STOREFRONT_API_URL = '/dev-api';
}

const result = spawnSync('npm', ['run', 'build'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, ...values },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
