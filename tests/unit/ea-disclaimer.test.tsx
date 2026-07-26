// P-170 — Component/report proof that the validation disclaimer is always visible.
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EaValidationNotice } from "@/components/engineering/ea-study-workspace";
import { EA_VALIDATION_DISCLAIMER } from "@/lib/electrical/disclaimer";

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

describe("EA validation disclaimer", () => {
  it("renders in the study workspace notice", () => {
    const html = renderToStaticMarkup(<EaValidationNotice />);
    // Normalise the JSX-escaped output before comparing.
    const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
    expect(text).toContain(EA_VALIDATION_DISCLAIMER);
  });

  it("is mounted under the workspace header", () => {
    const src = read("src/components/engineering/ea-study-workspace.tsx");
    const headerEnd = src.indexOf("<EaValidationNotice />");
    expect(headerEnd).toBeGreaterThan(0);
    expect(src).toContain('from "@/lib/electrical/disclaimer"');
  });

  it("is the disclaimer carried into the report payload and PDF footer", () => {
    const server = read("src/lib/ea-report.server.ts");
    expect(server).toContain("disclaimer: EA_VALIDATION_DISCLAIMER,");

    const pdf = read("src/lib/exports/ea-study-report-pdf.ts");
    expect(pdf).toContain("payload.disclaimer");
  });

  it("never claims certification or standards compliance", () => {
    expect(EA_VALIDATION_DISCLAIMER.toLowerCase()).not.toContain("certified");
    expect(EA_VALIDATION_DISCLAIMER.toLowerCase()).not.toContain("compliant with");
  });
});
