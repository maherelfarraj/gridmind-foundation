// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — Radial load flow (backward/forward sweep). Pure, deterministic.
import { z } from "zod";

import {
  assumption,
  cAbs,
  cAdd,
  cArgDeg,
  cConj,
  cDiv,
  cMul,
  cSub,
  cx,
  round,
  warn,
  type CalcOutput,
  type CalcWarning,
  type Complex,
} from "./types";

export const LOAD_FLOW_METHOD =
  "Backward/forward sweep on a radial single-line network. Bus injections are converted to " +
  "constant-power current phasors I = conj(S / (3 · V_phase)); the backward pass accumulates " +
  "branch currents from the leaves toward the source, the forward pass propagates " +
  "V_child = V_parent − Z_branch · I_branch. Iteration stops when the largest bus voltage " +
  "change falls below 1e-6 pu. Branch losses are 3 · |I|² · R (kW) and 3 · |I|² · X (kvar). " +
  "Per-unit voltages are referred to each bus's declared kV base on the given MVA base.";

export const loadFlowBusSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kvBase: z.number().positive(),
  pKw: z.number().default(0),
  qKvar: z.number().default(0),
});

export const loadFlowBranchSchema = z.object({
  fromBus: z.string().min(1),
  toBus: z.string().min(1),
  rOhm: z.number().min(0),
  xOhm: z.number().min(0),
});

export const loadFlowInputSchema = z.object({
  baseMva: z.number().positive().default(100),
  buses: z.array(loadFlowBusSchema).min(2),
  branches: z.array(loadFlowBranchSchema).min(1),
  sourceBusId: z.string().min(1),
  sourceVPu: z.number().positive().default(1),
  maxIterations: z.number().int().min(1).max(500).default(50),
});

export type LoadFlowInput = z.infer<typeof loadFlowInputSchema>;

export type LoadFlowBusResult = {
  id: string;
  name: string;
  vPu: number;
  vKv: number;
  angleDeg: number;
};

export type LoadFlowBranchResult = {
  fromBus: string;
  toBus: string;
  iA: number;
  pLossKw: number;
  qLossKvar: number;
};

export type LoadFlowResults = {
  inputSheet: LoadFlowInput;
  baseMva: number;
  buses: LoadFlowBusResult[];
  branches: LoadFlowBranchResult[];
  totalLossKw: number;
  totalLossKvar: number;
  converged: boolean;
  iterations: number;
  maxMismatchPu: number;
};

const V_MIN_PU = 0.95;
const V_MAX_PU = 1.05;
const TOLERANCE_PU = 1e-6;

type Topology = {
  order: string[];
  parentBranch: Map<string, number>;
  loop: boolean;
  disconnected: string[];
};

/** BFS from the source; flags cycles (loop) and unreachable buses. */
function analyseTopology(input: LoadFlowInput): Topology {
  const adjacency = new Map<string, Array<{ branch: number; other: string }>>();
  for (const bus of input.buses) adjacency.set(bus.id, []);
  input.branches.forEach((branch, index) => {
    adjacency.get(branch.fromBus)?.push({ branch: index, other: branch.toBus });
    adjacency.get(branch.toBus)?.push({ branch: index, other: branch.fromBus });
  });

  const order: string[] = [];
  const parentBranch = new Map<string, number>();
  const visited = new Set<string>([input.sourceBusId]);
  const usedBranches = new Set<number>();
  let loop = false;

  const queue = [input.sourceBusId];
  while (queue.length > 0) {
    const busId = queue.shift() as string;
    order.push(busId);
    for (const edge of adjacency.get(busId) ?? []) {
      if (usedBranches.has(edge.branch)) continue;
      usedBranches.add(edge.branch);
      if (visited.has(edge.other)) {
        loop = true;
        continue;
      }
      visited.add(edge.other);
      parentBranch.set(edge.other, edge.branch);
      queue.push(edge.other);
    }
  }

  const disconnected = input.buses.map((b) => b.id).filter((id) => !visited.has(id));
  return { order, parentBranch, loop, disconnected };
}

export function radialLoadFlow(rawInput: LoadFlowInput): CalcOutput<LoadFlowResults> {
  const input = loadFlowInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];
  const byId = new Map(input.buses.map((b) => [b.id, b]));

  if (!byId.has(input.sourceBusId)) {
    warnings.push(
      warn(
        "source_bus_missing",
        "critical",
        `Source bus ${input.sourceBusId} is not in the bus list.`,
      ),
    );
    return emptyResult(input, warnings);
  }

  const topology = analyseTopology(input);
  if (topology.loop) {
    warnings.push(
      warn(
        "loop_detected",
        "critical",
        "The network contains a loop. The backward/forward sweep solves radial networks only — " +
          "no solution was produced.",
      ),
    );
  }
  if (topology.disconnected.length > 0) {
    warnings.push(
      warn(
        "disconnected_bus",
        "critical",
        `Buses not reachable from the source: ${topology.disconnected.join(", ")}.`,
      ),
    );
  }
  if (topology.loop || topology.disconnected.length > 0) {
    return emptyResult(input, warnings);
  }

  const sourceBus = byId.get(input.sourceBusId) as z.infer<typeof loadFlowBusSchema>;
  // Phase voltages in volts; the source bus is the slack reference at angle 0.
  const sourcePhaseV = (input.sourceVPu * sourceBus.kvBase * 1000) / Math.sqrt(3);
  const voltage = new Map<string, Complex>();
  for (const bus of input.buses) voltage.set(bus.id, cx(sourcePhaseV, 0));

  const reverseOrder = [...topology.order].reverse();
  const branchCurrent = new Map<number, Complex>();
  let iterations = 0;
  let converged = false;
  let maxMismatch = 0;

  for (let iter = 1; iter <= input.maxIterations; iter += 1) {
    iterations = iter;
    branchCurrent.clear();

    // Backward sweep: accumulate load + downstream currents toward the source.
    const accumulated = new Map<string, Complex>();
    for (const busId of reverseOrder) {
      const bus = byId.get(busId) as z.infer<typeof loadFlowBusSchema>;
      const v = voltage.get(busId) as Complex;
      // Three-phase apparent power per bus, VA.
      const s = cx(bus.pKw * 1000, bus.qKvar * 1000);
      const loadCurrent = cAbs(v) > 0 ? cConj(cDiv(s, cMul(cx(3, 0), v))) : cx(0, 0);
      const downstream = accumulated.get(busId) ?? cx(0, 0);
      const total = cAdd(loadCurrent, downstream);
      accumulated.set(busId, total);
      const parent = topology.parentBranch.get(busId);
      if (parent !== undefined) {
        branchCurrent.set(parent, total);
        const branch = input.branches[parent];
        const upstreamId = branch.toBus === busId ? branch.fromBus : branch.toBus;
        accumulated.set(upstreamId, cAdd(accumulated.get(upstreamId) ?? cx(0, 0), total));
      }
    }

    // Forward sweep: propagate voltages from the source outward.
    maxMismatch = 0;
    voltage.set(input.sourceBusId, cx(sourcePhaseV, 0));
    for (const busId of topology.order) {
      const parent = topology.parentBranch.get(busId);
      if (parent === undefined) continue;
      const branch = input.branches[parent];
      const upstreamId = branch.toBus === busId ? branch.fromBus : branch.toBus;
      const z = cx(branch.rOhm, branch.xOhm);
      const i = branchCurrent.get(parent) ?? cx(0, 0);
      const next = cSub(voltage.get(upstreamId) as Complex, cMul(z, i));
      const previous = voltage.get(busId) as Complex;
      const bus = byId.get(busId) as z.infer<typeof loadFlowBusSchema>;
      const basePhase = (bus.kvBase * 1000) / Math.sqrt(3);
      maxMismatch = Math.max(maxMismatch, cAbs(cSub(next, previous)) / basePhase);
      voltage.set(busId, next);
    }

    if (maxMismatch < TOLERANCE_PU) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    warnings.push(
      warn(
        "not_converged",
        "critical",
        `The sweep did not converge within ${input.maxIterations} iterations ` +
          `(largest voltage change ${round(maxMismatch, 6)} pu).`,
      ),
    );
  }

  const buses: LoadFlowBusResult[] = input.buses.map((bus) => {
    const v = voltage.get(bus.id) as Complex;
    const vLineKv = (cAbs(v) * Math.sqrt(3)) / 1000;
    const vPu = vLineKv / bus.kvBase;
    if (converged && (vPu < V_MIN_PU || vPu > V_MAX_PU)) {
      warnings.push(
        warn(
          "voltage_out_of_band",
          "warning",
          `Bus ${bus.name} settles at ${round(vPu, 4)} pu, outside the 0.95–1.05 pu band.`,
        ),
      );
    }
    return {
      id: bus.id,
      name: bus.name,
      vPu: round(vPu, 6),
      vKv: round(vLineKv, 6),
      angleDeg: round(cArgDeg(v), 6),
    };
  });

  let totalLossKw = 0;
  let totalLossKvar = 0;
  const branches: LoadFlowBranchResult[] = input.branches.map((branch, index) => {
    const i = branchCurrent.get(index) ?? cx(0, 0);
    const iA = cAbs(i);
    const pLossKw = (3 * iA * iA * branch.rOhm) / 1000;
    const qLossKvar = (3 * iA * iA * branch.xOhm) / 1000;
    totalLossKw += pLossKw;
    totalLossKvar += qLossKvar;
    return {
      fromBus: branch.fromBus,
      toBus: branch.toBus,
      iA: round(iA, 4),
      pLossKw: round(pLossKw, 6),
      qLossKvar: round(qLossKvar, 6),
    };
  });

  return {
    results: {
      inputSheet: input,
      baseMva: input.baseMva,
      buses,
      branches,
      totalLossKw: round(totalLossKw, 6),
      totalLossKvar: round(totalLossKvar, 6),
      converged,
      iterations,
      maxMismatchPu: round(maxMismatch, 9),
    },
    warnings,
    assumptionsEcho: [
      assumption("model", "Balanced three-phase, constant-power loads", "GridMind default"),
      assumption("topology", "Radial only — no meshed solution", "Backward/forward sweep limit"),
      assumption("tolerance_pu", TOLERANCE_PU, "GridMind default"),
      assumption("base_mva", input.baseMva, "Input sheet"),
      assumption("source_v_pu", input.sourceVPu, "Input sheet"),
      assumption("voltage_band_pu", `${V_MIN_PU}–${V_MAX_PU}`, "IEC 60038 indicative band"),
    ],
  };
}

function emptyResult(input: LoadFlowInput, warnings: CalcWarning[]): CalcOutput<LoadFlowResults> {
  return {
    results: {
      inputSheet: input,
      baseMva: input.baseMva,
      buses: [],
      branches: [],
      totalLossKw: 0,
      totalLossKvar: 0,
      converged: false,
      iterations: 0,
      maxMismatchPu: 0,
    },
    warnings,
    assumptionsEcho: [
      assumption("model", "Balanced three-phase, constant-power loads", "GridMind default"),
      assumption("topology", "Radial only — no meshed solution", "Backward/forward sweep limit"),
    ],
  };
}
