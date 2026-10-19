// Concept art via Meshy text-to-image (budget-guarded, 9 credits per image on the pro models).
//
//   node scripts/meshy/concept.mjs <id> [--model nano-banana-pro] [--aspect 16:9] [--dry-run]
//
// Prompts live in docs/concept/prompts.json ({ preamble, items: { <id>: prompt } }).
// Images are saved to docs/concept/<id>.png; the task id is recorded next to the prompt.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api, download, FINAL } from './lib/api.mjs';
import { paidCall, settleEntry } from './lib/budget.mjs';
import { getBalance } from './lib/api.mjs';
import { ROOT } from './lib/paths.mjs';

const CONCEPT_DIR = path.join(ROOT, 'docs/concept');
const PROMPTS = path.join(CONCEPT_DIR, 'prompts.json');
const COST = { 'nano-banana': 3, 'nano-banana-2': 6, 'nano-banana-2-lite': 3, 'nano-banana-pro': 9, 'gpt-image-2': 9, 'gpt-image-2-5-flare': 9, 'gpt-image-2-5-sunburst': 9 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const model = opt('model', 'nano-banana-pro');
const aspect = opt('aspect', '16:9');
const dryRun = args.includes('--dry-run');

if (!id) {
  console.error('usage: node scripts/meshy/concept.mjs <id> [--model nano-banana-pro] [--aspect 16:9] [--dry-run]');
  process.exit(1);
}
const prompts = JSON.parse(readFileSync(PROMPTS, 'utf8'));
const item = prompts.items[id];
if (!item) throw new Error(`No prompt "${id}" in ${PROMPTS}`);
const prompt = `${prompts.preamble} ${item.prompt}`.slice(0, 2000);
const out = path.join(CONCEPT_DIR, `${id}.png`);
if (existsSync(out) && !args.includes('--force')) {
  console.log(`${id}: already generated (${path.relative(ROOT, out)}); use --force to regenerate`);
  process.exit(0);
}
const expected = COST[model];
if (!expected) throw new Error(`Unknown model ${model}`);

const taskId = await paidCall(
  { asset: `concept:${id}`, operation: 'text-to-image', expected, details: { ai_model: model }, dryRun },
  async () => (await api.post('/openapi/v1/text-to-image', { ai_model: model, prompt, aspect_ratio: aspect })).result,
);
if (!taskId) process.exit(0);

let task;
for (let delay = 3000; ; delay = Math.min(delay * 1.3, 15000)) {
  task = await api.get(`/openapi/v1/text-to-image/${taskId}`);
  process.stdout.write(`  ${id} ${task.status} ${task.progress ?? 0}%\r`);
  if (FINAL.has(task.status)) break;
  await sleep(delay);
}
console.log('');
let balanceAfter = null;
try {
  balanceAfter = (await getBalance()).balance;
} catch {
  /* non-fatal */
}
settleEntry(taskId, task, balanceAfter);
if (task.status !== 'SUCCEEDED') throw new Error(`${id}: ${task.status} ${JSON.stringify(task.task_error ?? '')}`);
await download(task.image_urls[0], out);
item.taskId = taskId;
item.model = model;
item.aspect = aspect;
item.generatedAt = new Date().toISOString();
writeFileSync(PROMPTS, JSON.stringify(prompts, null, 2) + '\n');
console.log(`${id}: done → ${path.relative(ROOT, out)}`);
