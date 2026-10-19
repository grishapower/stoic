// Minimal .env.local parser. The key is only ever returned to the API client, never logged.
import { readFileSync, existsSync } from 'node:fs';
import { ENV_FILE } from './paths.mjs';

export function readEnvFile(file = ENV_FILE) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function getMeshyKey() {
  const key = process.env.MESHY_API_KEY || readEnvFile().MESHY_API_KEY;
  if (!key) throw new Error('MESHY_API_KEY missing (expected in .env.local)');
  return key;
}
