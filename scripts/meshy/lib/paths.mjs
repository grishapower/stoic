// Shared project paths for the Meshy pipeline.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ENV_FILE = path.join(ROOT, '.env.local');
export const MESHY_DIR = path.join(ROOT, 'assets-src/meshy');
export const REGISTRY_FILE = path.join(MESHY_DIR, 'assets.json');
export const LEDGER_FILE = path.join(MESHY_DIR, 'ledger.json');
export const RAW_DIR = path.join(MESHY_DIR, 'raw');
export const MODELS_DIR = path.join(ROOT, 'public/assets/models');
export const MANIFEST_FILE = path.join(ROOT, 'src/data/generated/models.json');

export const rel = (p) => path.relative(ROOT, p);
