#!/usr/bin/env node
// Print Markdown tables (tasks, credits, outputs) from assets.json + ledger.json for docs/assets/meshy.md.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry } from './lib/registry.mjs';
import { loadLedger, ledgerTotal, entryCredits } from './lib/budget.mjs';
import { ROOT, MANIFEST_FILE } from './lib/paths.mjs';

const reg = loadRegistry();
const ledger = loadLedger();
const manifest = existsSync(MANIFEST_FILE) ? JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) : {};

console.log('### Paid calls (ledger)\n');
console.log('| # | time (UTC) | asset | operation | task id | credits | status | balance before → after |');
console.log('|---|---|---|---|---|---|---|---|');
ledger.entries.forEach((e, i) => {
  console.log(`| ${i + 1} | ${e.timestamp.slice(0, 16).replace('T', ' ')} | ${e.asset} | ${e.operation} | \`${e.task_id}\` | ${entryCredits(e)} | ${e.final_status ?? 'pending'} | ${e.balance_before} → ${e.balance_after_settled ?? e.balance_after ?? '?'} |`);
});
console.log(`\n**Total: ${ledgerTotal(ledger)} credits** (cap ${ledger.cap}; start balance ${ledger.start_balance}).\n`);

console.log('### Per asset\n');
console.log('| asset | status | variant(s) | credits | output | size (w×h×d m) | triangles | file size |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [id, a] of Object.entries(reg.assets)) {
  const outs = Object.entries(a.optimized || {});
  const variants = Object.keys(a.attempts || {}).join(', ') || '-';
  if (!outs.length) {
    console.log(`| ${id} | ${a.status} | ${variants} | ${a.credits_spent ?? 0} | - | - | - | - |`);
    continue;
  }
  for (const [outId, o] of outs) {
    const m = manifest[outId] || {};
    const bytes = existsSync(path.join(ROOT, o.path)) ? statSync(path.join(ROOT, o.path)).size : o.bytes;
    console.log(`| ${id} | ${a.status} | ${variants} (sel. ${a.outputs?.[outId] ?? a.selected_variant ?? '-'}) | ${a.credits_spent ?? 0} | \`${o.path}\` | ${(m.size || o.size || []).join(' × ')} | ${m.triangles ?? o.triangles} | ${(bytes / 1024).toFixed(0)} KB |`);
  }
}
