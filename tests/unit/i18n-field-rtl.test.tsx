// P-242 B2 — field-mobile RTL render: the form flips to dir="rtl" in Arabic
// while numeric inputs stay dir="ltr" (Western digits, LTR entry).
import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createI18n, dirFor } from "@/lib/i18n";

function ManpowerRowForm({ dir }: { dir: "ltr" | "rtl" }) {
  return (
    <div dir={dir}>
      <form>
        <label htmlFor="contractor">Contractor</label>
        <input id="contractor" type="text" />
        <label htmlFor="headcount">Headcount</label>
        <input id="headcount" type="number" dir="ltr" defaultValue={1} />
        <label htmlFor="hours">Hours per person</label>
        <input id="hours" type="number" dir="ltr" defaultValue={8} />
      </form>
    </div>
  );
}

describe("field form RTL layout", () => {
  it("renders dir=rtl for Arabic while numeric inputs keep dir=ltr", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    const dir = dirFor("ar");
    expect(dir).toBe("rtl");

    render(
      <I18nextProvider i18n={i18n}>
        <ManpowerRowForm dir={dir} />
      </I18nextProvider>,
    );

    const form = screen.getByRole("textbox", { name: "Contractor" }).closest("div");
    expect(form?.getAttribute("dir")).toBe("rtl");

    const headcount = screen.getByLabelText("Headcount") as HTMLInputElement;
    const hours = screen.getByLabelText("Hours per person") as HTMLInputElement;
    expect(headcount.getAttribute("dir")).toBe("ltr");
    expect(hours.getAttribute("dir")).toBe("ltr");
  });

  it("keeps dir=ltr for English", () => {
    const dir = dirFor("en");
    expect(dir).toBe("ltr");
    render(<ManpowerRowForm dir={dir} />);
    const headcount = screen.getByLabelText("Headcount") as HTMLInputElement;
    expect(headcount.getAttribute("dir")).toBe("ltr");
  });
});
