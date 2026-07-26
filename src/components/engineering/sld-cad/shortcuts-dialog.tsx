// P-138 — Keyboard shortcuts cheatsheet ("?").
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS: Array<[string, string]> = [
  ["Wheel", "Zoom around cursor (0.1×–16×)"],
  ["Space + drag / middle-drag", "Pan the sheet"],
  ["F", "Fit to content"],
  ["Delete / Backspace", "Remove selected objects from revision"],
  ["Ctrl + D", "Duplicate selection"],
  ["Ctrl + C / Ctrl + V", "Copy / paste"],
  ["R", "Rotate 90°"],
  ["M", "Mirror"],
  ["Arrow keys", "Nudge by grid (Shift = 10×)"],
  ["Ctrl + Z / Ctrl + Shift + Z", "Undo / redo"],
  ["Ctrl + S", "Save canvas"],
  ["Esc", "Cancel tool / clear selection"],
  ["?", "This cheatsheet"],
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Canvas shortcuts</DialogTitle>
          <DialogDescription>Keyboard and pointer controls for the SLD canvas.</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border text-sm">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-1.5">
              <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
              <dd className="text-right">{desc}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
