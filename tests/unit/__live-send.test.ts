import { describe, expect, it } from "vitest";
import { sendEventEmail } from "@/lib/email/dispatch.server";
import { EMAIL_EVENTS } from "@/lib/email/registry";

const TO = "maher@next.jo";
const PARAMS: Record<string, Record<string, unknown>> = {
  client_invite: { role: "company_admin", accept_url: "/accept-invite?token=demo" },
  sub_invite: { accept_url: "/accept-invite?token=demo", expires_at: "2026-08-15" },
  transmittal: { transmittal_number: "TR-0001", subject: "NEPCO grid code submission", from_party: "GridMind EPC", to_party: "NEPCO", response_due: "2026-08-12", item_count: 4 },
  claim_submitted: { claim_number: "SCL-0003", subcontract_number: "SC-0001", net_payable: 128400, currency: "JOD" },
  claim_certified: { claim_number: "SCL-0003", subcontract_number: "SC-0001", net_payable: 128400, currency: "JOD" },
  payment: { invoice_number: "INV-0007", amount: 95000, currency: "JOD", payment_date: "2026-07-29", balance_after: 12000, method: "bank_transfer" },
  compliance_expiry: { doc_type: "insurance", title: "Contractors all-risk policy", expiry_date: "2026-08-20" },
  scheduled_report: { report_name: "East Amman weekly field report", period: "weekly", project_name: "GSI-EAM-001", sections: ["hse", "progress"], generated_at: new Date().toISOString() },
};

describe("live sends", () => {
  it("sends one per template plus an Arabic-locale send", async () => {
    const results: Record<string, string> = {};
    for (const event of EMAIL_EVENTS) {
      const out = await sendEventEmail({ event, to: TO, companyName: "GridMind EPC", params: PARAMS[event], idempotencyKey: `live-${event}-${Date.now()}` });
      results[event] = out.status === "failed" ? `failed:${out.error}` : out.status;
    }
    const ar = await sendEventEmail({ event: "transmittal", to: TO, locale: "ar-JO", companyName: "GridMind EPC", params: PARAMS.transmittal, idempotencyKey: `live-ar-${Date.now()}` });
    results["transmittal(ar)"] = ar.status === "failed" ? `failed:${ar.error}` : ar.status;
    console.log(JSON.stringify(results, null, 2));
    expect(Object.values(results).every((v) => v === "sent")).toBe(true);
  }, 120000);
});
