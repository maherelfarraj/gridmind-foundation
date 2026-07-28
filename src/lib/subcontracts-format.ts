// P-258 — Money formatting for the subcontract module (kept out of route files
// so fast refresh stays component-only).
export function money(amount: number, code: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code || "USD",
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  } catch {
    return `${Number(amount || 0).toFixed(2)} ${code}`;
  }
}
