// P-264 — Client wiring for document content indexing.
// Text-based PDFs get their text extracted in the browser and stored on the
// register row (search weight C). Images and CAD files stay metadata-only —
// we do not pretend to OCR them.
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { setDocumentContentText } from "@/lib/documents-search.functions";
import { extractPdfText } from "@/lib/pdf-text-extractor";

export function isTextExtractable(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function useIndexDocumentText() {
  const store = useServerFn(setDocumentContentText);
  return useMutation({
    mutationFn: async ({ documentId, file }: { documentId: string; file: File }) => {
      if (!isTextExtractable(file)) return { ok: true as const, characters: 0 };
      let text = "";
      try {
        text = await extractPdfText(file);
      } catch {
        // Scanned/encrypted PDFs simply stay metadata-only.
        return { ok: true as const, characters: 0 };
      }
      if (!text.trim()) return { ok: true as const, characters: 0 };
      return store({ data: { documentId, text: text.slice(0, 400_000) } });
    },
  });
}
