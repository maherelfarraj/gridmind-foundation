// P-087 — Dispatch table: routes queued mutations to their server functions.
//
// The map is populated at runtime via `registerDispatcher()` so tests can wire
// stub handlers without importing the real server fns.
import {
  addManpowerRow,
  addQuantityRow,
  addWeatherDelay,
  attachPhoto,
  createObservation,
  submitDpr,
  upsertDprHeader,
} from "@/lib/dpr.functions";
import {
  recordUtilityWitness,
  reopenCommissioningTest,
  saveCommissioningTestResult,
} from "@/lib/commissioning.functions";

export type Dispatcher = (payload: Record<string, unknown>) => Promise<unknown>;

const table = new Map<string, Dispatcher>();

export function dispatcherKey(entity: string, action: string): string {
  return `${entity}.${action}`;
}

export function registerDispatcher(entity: string, action: string, fn: Dispatcher) {
  table.set(dispatcherKey(entity, action), fn);
}

export function getDispatcher(entity: string, action: string): Dispatcher | undefined {
  return table.get(dispatcherKey(entity, action));
}

export function clearDispatchersForTests() {
  table.clear();
}

/**
 * Registers the default production dispatchers. Called once at module load
 * via `registerDefaultDispatchers()` from the trigger bootstrap.
 */
export function registerDefaultDispatchers() {
  registerDispatcher("dpr", "upsert", (p) => upsertDprHeader({ data: p as any }));
  registerDispatcher("dpr", "manpower", (p) => addManpowerRow({ data: p as any }));
  registerDispatcher("dpr", "weather", (p) => addWeatherDelay({ data: p as any }));
  registerDispatcher("dpr", "quantity", (p) => addQuantityRow({ data: p as any }));
  registerDispatcher("dpr", "submit", (p) => submitDpr({ data: p as any }));
  registerDispatcher("photo", "attach", (p) => attachPhoto({ data: p as any }));
  registerDispatcher("observation", "create", (p) => createObservation({ data: p as any }));
  registerDispatcher("commissioning", "save_result", (p) =>
    saveCommissioningTestResult({ data: p as any }),
  );
  registerDispatcher("commissioning", "record_witness", (p) =>
    recordUtilityWitness({ data: p as any }),
  );
  registerDispatcher("commissioning", "reopen", (p) => reopenCommissioningTest({ data: p as any }));
}
