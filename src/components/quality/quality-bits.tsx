// P-183 — Shared bits for the quality surfaces: result badge, calibration chip.
import { Badge } from "@/components/ui/badge";
import { calibrationChipLabel, calibrationState, type TestResultStatus } from "@/lib/quality.rules";

const RESULT_TONE: Record<TestResultStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  pass: "default",
  fail: "destructive",
  conditional: "secondary",
};

export function ResultBadge({ result }: { result: TestResultStatus | string }) {
  const key = (result as TestResultStatus) ?? "pending";
  return <Badge variant={RESULT_TONE[key] ?? "outline"}>{key.replace(/_/g, " ")}</Badge>;
}

/**
 * Calibration warning chip: shown wherever a tool tag is picked. Instruments
 * due within 30 days warn; expired or untraceable instruments are destructive.
 */
export function CalibrationChip({
  nextDue,
  referenceDate,
}: {
  nextDue: string | null | undefined;
  referenceDate: string;
}) {
  const state = calibrationState(nextDue, referenceDate);
  const tone =
    state === "expired" || state === "unknown"
      ? "destructive"
      : state === "due_soon"
        ? "secondary"
        : "outline";
  return <Badge variant={tone}>{calibrationChipLabel(state, nextDue)}</Badge>;
}
