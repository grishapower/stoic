// Credit ledger + hard budget guard. Every paid call goes through paidCall().
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { LEDGER_FILE } from './paths.mjs';
import { getBalance, MeshyError } from './api.mjs';

// Known costs (docs/research/api-notes.md).
export const COSTS = {
  preview: 20, // meshy-6 / meshy-7.1
  preview_lite: 5, // meshy-6-lite
  refine: 10,
  image: 30, // image-to-3D textured
  image_mesh_only: 20,
  rig: 5,
  animate_per_action: 3,
  remesh: 5,
  retexture: 10,
};

const DEFAULT_LEDGER = { cap: 900, start_balance: 4120, entries: [] };

export function loadLedger() {
  if (!existsSync(LEDGER_FILE)) return structuredClone(DEFAULT_LEDGER);
  return JSON.parse(readFileSync(LEDGER_FILE, 'utf8'));
}

export function saveLedger(ledger) {
  mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  ledger.total_credits = ledgerTotal(ledger);
  const run = currentRun(ledger);
  if (run) run.credits = runTotal(ledger, run.id);
  writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + '\n');
}

// Credits charged so far: refunded (failed/canceled) tasks count 0, otherwise actual or expected.
export function entryCredits(e) {
  if (e.final_status === 'FAILED' || e.final_status === 'CANCELED') return 0;
  return e.consumed_credits ?? e.expected_credits;
}

export function ledgerTotal(ledger) {
  return ledger.entries.reduce((sum, e) => sum + entryCredits(e), 0);
}

/**
 * Guarded paid call. Prints cost + running total, checks the live balance, refuses past the cap,
 * then performs `create()` (which must return the task id) and records it immediately.
 */
// The run currently in progress (ledger.current_run), with its own cap on top of the project-wide ledger.cap.
export function currentRun(ledger) {
  return ledger.current_run ? (ledger.runs || []).find((r) => r.id === ledger.current_run) || null : null;
}

export function runTotal(ledger, runId) {
  return ledger.entries.filter((e) => e.run === runId).reduce((sum, e) => sum + entryCredits(e), 0);
}

export async function paidCall({ asset, operation, expected, details = {}, dryRun = false }, create) {
  const ledger = loadLedger();
  const total = ledgerTotal(ledger);
  const bal = await getBalance();
  const balance = bal.balance;
  const spentByBalance = ledger.start_balance - balance;
  const spent = Math.max(total, spentByBalance);
  const run = currentRun(ledger);
  const runSpent = run ? Math.max(runTotal(ledger, run.id), run.start_balance - balance) : 0;
  console.log(
    `\n$ PAID CALL ${asset}/${operation}: expected ${expected} credits | ledger total ${total} | ` +
      `balance ${balance} (spent vs start ${spentByBalance}) | after: ${spent + expected}/${ledger.cap}` +
      (run ? ` | run ${run.id}: ${runSpent} -> ${runSpent + expected}/${run.cap}` : ''),
  );
  if (spent + expected > ledger.cap) {
    throw new Error(`REFUSED: ${asset}/${operation} would exceed the ${ledger.cap}-credit cap (${spent} + ${expected}).`);
  }
  if (run && runSpent + expected > run.cap) {
    throw new Error(`REFUSED: ${asset}/${operation} would exceed the ${run.id} run cap ${run.cap} (${runSpent} + ${expected}).`);
  }
  if (balance < expected) throw new Error(`REFUSED: balance ${balance} < expected ${expected}`);
  if (dryRun) {
    console.log('  (dry run: not calling the API)');
    return null;
  }
  let taskId;
  try {
    taskId = await create();
  } catch (err) {
    if (err instanceof MeshyError && err.ambiguous) {
      ledger.entries.push({
        timestamp: new Date().toISOString(), asset, operation, task_id: null, expected_credits: expected,
        ...(run ? { run: run.id } : {}), balance_before: balance, balance_after: null, final_status: 'UNKNOWN', error: err.message, ...details,
      });
      saveLedger(ledger);
      console.error('  Ambiguous failure: a task may have been created. Check the balance / task list before retrying.');
    }
    throw err;
  }
  let balanceAfter = null;
  try {
    balanceAfter = (await getBalance()).balance;
  } catch {
    /* non-fatal */
  }
  const fresh = loadLedger(); // re-read: another process may have written meanwhile
  fresh.entries.push({
    timestamp: new Date().toISOString(), asset, operation, task_id: taskId, expected_credits: expected,
    ...(run ? { run: run.id } : {}), balance_before: balance, balance_after: balanceAfter, ...details,
  });
  saveLedger(fresh);
  console.log(`  task ${taskId} created; balance ${balance} -> ${balanceAfter}`);
  return taskId;
}

// Record final status + consumed credits once a task finishes.
export function settleEntry(taskId, task, balanceAfter) {
  const ledger = loadLedger();
  const e = ledger.entries.find((x) => x.task_id === taskId);
  if (!e) return;
  e.final_status = task.status;
  if (typeof balanceAfter === 'number') e.balance_after_settled = balanceAfter;
  if (typeof task.consumed_credits === 'number') e.consumed_credits = task.consumed_credits;
  if (task.status === 'FAILED' || task.status === 'CANCELED') e.consumed_credits = 0;
  e.settled_at = new Date().toISOString();
  saveLedger(ledger);
}
