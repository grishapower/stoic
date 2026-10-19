// Meshy REST client: auth only to api.meshy.ai, retries for idempotent GETs, polling with backoff.
import { createWriteStream, mkdirSync } from 'node:fs';
import { rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getMeshyKey } from './env.mjs';

export const BASE = 'https://api.meshy.ai';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MeshyError extends Error {
  constructor(message, { status, body, ambiguous = false } = {}) {
    super(message);
    this.status = status;
    this.body = body;
    // ambiguous = the request may have reached the server (a paid task may exist)
    this.ambiguous = ambiguous;
  }
}

async function request(method, endpoint, body, { retries = method === 'GET' ? 5 : 0 } = {}) {
  const url = endpoint.startsWith('http') ? endpoint : BASE + endpoint;
  if (!url.startsWith(BASE)) throw new Error('Refusing to send credentials outside api.meshy.ai');
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${getMeshyKey()}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(1500 * 2 ** attempt++);
        continue;
      }
      throw new MeshyError(`${method} ${endpoint} network error: ${err.message}`, { ambiguous: method !== 'GET' });
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (res.ok) return json;
    // 429 means the request was rejected, so even a POST is safe to retry.
    const retriable = res.status === 429 || (method === 'GET' && res.status >= 500);
    const maxTries = res.status === 429 ? Math.max(retries, 4) : retries;
    if (retriable && attempt < maxTries) {
      await sleep(2000 * 2 ** attempt++);
      continue;
    }
    throw new MeshyError(`${method} ${endpoint} -> HTTP ${res.status}: ${JSON.stringify(json).slice(0, 600)}`, {
      status: res.status,
      body: json,
      ambiguous: method !== 'GET' && res.status >= 500,
    });
  }
}

export const api = {
  get: (endpoint) => request('GET', endpoint),
  post: (endpoint, body) => request('POST', endpoint, body),
};

export async function getBalance() {
  const b = await api.get('/openapi/v1/balance');
  return b;
}

// Endpoint per task kind (create + get share the base path).
export const TASK_ENDPOINTS = {
  preview: '/openapi/v2/text-to-3d',
  refine: '/openapi/v2/text-to-3d',
  image: '/openapi/v1/image-to-3d',
  rig: '/openapi/v1/rigging',
  animate: '/openapi/v1/animations',
  remesh: '/openapi/v1/remesh',
  retexture: '/openapi/v1/retexture',
};

export const FINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED']);

export async function getTask(kind, taskId) {
  return api.get(`${TASK_ENDPOINTS[kind]}/${taskId}`);
}

// Poll until final state. Backoff 4s -> 30s; transient errors are retried inside api.get.
export async function waitForTask(kind, taskId, { timeoutMs = 45 * 60_000, label = '' } = {}) {
  const start = Date.now();
  let delay = 4000;
  let lastLine = '';
  for (;;) {
    let task;
    try {
      task = await getTask(kind, taskId);
    } catch (err) {
      console.warn(`  poll error (${err.message}); retrying`);
      await sleep(Math.min(delay * 2, 60_000));
      continue;
    }
    const line = `  [${label || kind}] ${taskId} ${task.status} ${task.progress ?? 0}%` +
      (task.status === 'PENDING' && task.preceding_tasks != null ? ` (queue ${task.preceding_tasks})` : '');
    if (line !== lastLine) {
      console.log(line);
      lastLine = line;
    }
    if (FINAL.has(task.status)) return task;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${kind} ${taskId}`);
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.35), 30_000);
  }
}

// Download a (pre-signed) asset URL without credentials; atomic rename on success.
export async function download(url, dest, { retries = 4 } = {}) {
  if (!url) return null;
  mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tmp = `${dest}.part`;
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      await rename(tmp, dest);
      const { size } = await stat(dest);
      console.log(`  saved ${dest.split('/assets-src/').pop()} (${(size / 1024).toFixed(0)} KB)`);
      return dest;
    } catch (err) {
      if (attempt >= retries) throw new Error(`Download failed for ${dest}: ${err.message}`);
      await sleep(2000 * 2 ** attempt);
    }
  }
}
