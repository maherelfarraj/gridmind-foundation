// P-078 — Client PDF text extraction (browser only, dynamic import).
// pdfjs ESM sub-paths have no bundled type declarations — treat as any.

export async function extractPdfText(file: File): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("PDF extraction is only available in the browser.");
  }
  // @ts-expect-error — no type declarations for pdfjs-dist ESM build entry
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  // @ts-expect-error — Vite ?url loader for the matching worker bundle
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  (pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await (pdfjs as any).getDocument({ data: buf }).promise;
  const chunks: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = (content.items as Array<{ str?: string }>)
      .map((it) => (it && typeof it.str === "string" ? it.str : ""))
      .join(" ");
    chunks.push(text);
    if (chunks.join("\n").length > 150_000) break;
  }
  return chunks.join("\n\n");
}
