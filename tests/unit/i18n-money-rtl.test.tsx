// P-241 — RTL money-table render: amounts stay LTR + tabular inside an RTL
// document, and money columns keep end alignment in both directions.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoneyCell, Num } from "@/components/ui/num";

function AgingTable({ dir }: { dir: "ltr" | "rtl" }) {
  return (
    <div dir={dir}>
      <table>
        <thead>
          <tr>
            <th className="text-start">Invoice</th>
            <th className="text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-start">INV-0001</td>
            <td>
              <MoneyCell>225,000.00 USD</MoneyCell>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <Num>3</Num>
      </p>
    </div>
  );
}

describe("RTL money tables", () => {
  it("keeps amounts LTR inside an RTL flow", () => {
    render(<AgingTable dir="rtl" />);
    const money = screen.getByText("225,000.00 USD");
    expect(money.getAttribute("dir")).toBe("ltr");
    expect(money.className).toContain("tabular-nums");
    expect(money.className).toContain("text-end");
  });

  it("keeps Latin codes untranslated and LTR-safe", () => {
    render(<AgingTable dir="rtl" />);
    expect(screen.getByText("INV-0001")).toBeTruthy();
    expect(screen.getByText("3").getAttribute("dir")).toBe("ltr");
  });

  it("uses logical alignment classes, not physical ones", () => {
    const { container } = render(<AgingTable dir="ltr" />);
    expect(container.innerHTML).not.toContain("text-right");
    expect(container.innerHTML).not.toContain("text-left");
  });
});
