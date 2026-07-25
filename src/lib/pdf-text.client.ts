// P-078 — Client PDF text extraction (browser only, dynamic import).
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export async function extractPdfText(file: File): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("PDF extraction is only available in the browser.");
  }
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  // Use a matching bundled worker via Vite ?url import
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  (pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await (pdfjs as any).getDocument({ data: buf }).promise;
  const chunks: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = (content.items as TextItem[])
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    chunks.push(text);
    if (chunks.join("\n").length > 150_000) break;
  }
  return chunks.join("\n\n");
}
