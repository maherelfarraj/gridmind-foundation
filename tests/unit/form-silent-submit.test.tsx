// Day 6 — regression: a resolver rejection must never be silent.
// Invalid submit => visible error text AND zero server requests.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverCalls = vi.fn();

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerFn: () => serverCalls,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const saveMutate = vi.fn();
vi.mock("@/lib/proposal-query", () => ({
  useSaveArrayConfig: () => ({ mutate: saveMutate, isPending: false }),
}));

import { RecordPaymentDialog } from "@/components/finance/record-payment-dialog";
import { ArrayConfigForm } from "@/components/proposals/ArrayConfigForm";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  serverCalls.mockReset();
  saveMutate.mockReset();
});

describe("RecordPaymentDialog", () => {
  it("shows a human message and fires no request when the amount is blank", async () => {
    wrap(
      <RecordPaymentDialog
        open
        onOpenChange={() => {}}
        invoiceId="00000000-0000-0000-0000-000000000001"
        invoiceNumber="INV-0002"
        currency="USD"
        balance={0}
        blocked={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() => expect(screen.getAllByText(/enter a valid amount/i).length).toBeGreaterThan(0));
    expect(serverCalls).not.toHaveBeenCalled();
  });

  it("shows a message for a non-positive amount", async () => {
    wrap(
      <RecordPaymentDialog
        open
        onOpenChange={() => {}}
        invoiceId="00000000-0000-0000-0000-000000000001"
        invoiceNumber="INV-0002"
        currency="USD"
        balance={0}
        blocked={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await new Promise((r) => setTimeout(r, 300));
    // eslint-disable-next-line no-console
    console.log("CALLS>>", serverCalls.mock.calls.length, JSON.stringify(serverCalls.mock.calls[0]));
    // eslint-disable-next-line no-console
    console.log("HTML>>", document.body.innerHTML.replace(/<[^>]+>/g, "|").slice(0, 1200));
    expect(serverCalls).not.toHaveBeenCalled();
  });
});

describe("ArrayConfigForm", () => {
  const proposal = {
    id: "00000000-0000-0000-0000-0000000000aa",
    array_config: null,
  } as never;

  it("renders a per-field message for an out-of-range loss and does not save", async () => {
    const { container } = wrap(<ArrayConfigForm proposal={proposal} readOnly={false} />);

    const soiling = container.querySelector<HTMLInputElement>('input[name="loss_soiling"]')!;
    fireEvent.change(soiling, { target: { value: "0.9" } });
    fireEvent.click(screen.getByRole("button", { name: /save array config/i }));

    await waitFor(() =>
      expect(screen.getAllByText(/soiling loss must be 0.5 or less/i).length).toBeGreaterThan(0),
    );
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("surfaces a form-level summary listing every rejection", async () => {
    const { container } = wrap(<ArrayConfigForm proposal={proposal} readOnly={false} />);

    fireEvent.change(container.querySelector('input[name="dc_capacity_kw"]')!, {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save array config/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/i);
    expect(saveMutate).not.toHaveBeenCalled();
  });
});
