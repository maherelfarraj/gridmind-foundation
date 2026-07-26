// P-142 — Client wiring for the connectivity engine: debounced local run + persisted run.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { validateSldRevision } from "@/lib/sld-validation.functions";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import { MEASURE_SYMBOL } from "@/lib/sld/canvas-types";
import {
  issueSeverityByObject,
  runValidation,
  summarizeIssues,
  type ConnSymbolMeta,
  type ValidationIssue,
} from "@/lib/sld/connectivity";
import type { SymbolTypeRecord } from "@/lib/sld/symbol-registry";

export function toConnSymbols(symbols: SymbolTypeRecord[]): ConnSymbolMeta[] {
  return symbols.map((s) => ({
    type_key: s.type_key,
    display_name: s.display_name,
    category: s.category,
    ports: (s.ports ?? []).map((p) => ({
      key: p.key,
      required: (p as { required?: boolean }).required === true,
    })),
  }));
}

/** Advisory validation recomputed from local canvas state, debounced on edits. */
export function useLiveValidation(
  symbols: SymbolTypeRecord[],
  projectVoltagesKv: number[],
  delayMs = 400,
) {
  const objects = useCanvasStore((s) => s.objects);
  const connections = useCanvasStore((s) => s.connections);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  const connSymbols = useMemo(() => toConnSymbols(symbols), [symbols]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const graphObjects = objects
        .filter((o) => o.symbol_type !== MEASURE_SYMBOL)
        .map((o) => ({
          id: o.id,
          symbol_type: o.symbol_type,
          tag: o.tag,
          properties: o.properties,
        }));
      setIssues(
        runValidation(
          graphObjects,
          connections.map((c) => ({
            id: c.id,
            connection_type: c.connection_type,
            cable_number: c.cable_number,
            from_object_id: c.from_object_id,
            from_port: c.from_port,
            to_object_id: c.to_object_id,
            to_port: c.to_port,
            properties: c.properties ?? {},
          })),
          connSymbols,
          { projectVoltagesKv },
        ),
      );
    }, delayMs);
    return () => clearTimeout(handle);
  }, [objects, connections, connSymbols, projectVoltagesKv, delayMs]);

  const severityByObject = useMemo(() => issueSeverityByObject(issues), [issues]);
  const summary = useMemo(() => summarizeIssues(issues), [issues]);

  return { issues, severityByObject, ...summary };
}

/** Persists a validation snapshot on the revision (audited). */
export function useRunValidation(drawingId: string) {
  const fn = useServerFn(validateSldRevision);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (fn as any)({ data: { drawingId, dryRun: false } }),
    onSuccess: async (res: any) => {
      if (res.error_count > 0) {
        toast.error(`Validation: ${res.error_count} error(s), ${res.warning_count} warning(s)`);
      } else if (res.warning_count > 0) {
        toast.warning(`Validation passed with ${res.warning_count} warning(s)`);
      } else {
        toast.success("Validation passed — no issues found");
      }
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
    },
    onError: (err) => toast.error(String((err as any)?.message ?? "Validation failed")),
  });
}
