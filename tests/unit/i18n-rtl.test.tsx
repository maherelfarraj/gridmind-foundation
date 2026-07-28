// P-240 — RTL render + nav-label fallback checks for the Arabic chrome pass.
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { createI18n } from "@/lib/i18n";
import { applyDocumentLocale } from "@/lib/i18n/locale-provider";
import { translateNavLabel } from "@/lib/i18n/nav-label";

function NavSample({ labels }: { labels: string[] }) {
  const i18n = createI18n("ar");
  return (
    <I18nextProvider i18n={i18n}>
      <ul>
        {labels.map((l) => (
          <li key={l}>{translateNavLabel(i18n.t.bind(i18n), l)}</li>
        ))}
      </ul>
    </I18nextProvider>
  );
}

describe("RTL chrome rendering", () => {
  it("flips <html> dir and lang when Arabic is applied", () => {
    applyDocumentLocale("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    applyDocumentLocale("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });

  it("renders Arabic nav labels", () => {
    render(<NavSample labels={["Procurement", "Finance", "Green H₂"]} />);
    expect(screen.getByText("المشتريات")).toBeTruthy();
    expect(screen.getByText("المالية")).toBeTruthy();
    // H₂ stays intact inside the Arabic label.
    expect(screen.getByText(/الهيدروجين الأخضر\s*H₂/)).toBeTruthy();
  });

  it("falls back to the English label for unknown nav entries", () => {
    render(<NavSample labels={["Brand New Module"]} />);
    expect(screen.getByText("Brand New Module")).toBeTruthy();
  });
});
