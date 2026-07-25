// P-097 — Certificate rules unit tests.
import { describe, expect, it } from "vitest";
import {
  allSigned,
  isPassingPr,
  missingCertParties,
  REQUIRED_PARTIES,
  suggestCertNumber,
  type CertSignature,
} from "@/lib/commissioning-certificates.rules";

const sig = (party: "contractor" | "client" | "utility"): CertSignature => ({
  party,
  name: "Test Signer",
  title: "Test",
  signed_at: new Date().toISOString(),
  file_path: `path/${party}.png`,
});

describe("REQUIRED_PARTIES", () => {
  it("MC requires contractor + client", () => {
    expect(REQUIRED_PARTIES.mechanical_completion).toEqual(["contractor", "client"]);
  });
  it("COD requires contractor + client + utility", () => {
    expect(REQUIRED_PARTIES.cod).toEqual(["contractor", "client", "utility"]);
  });
});

describe("missingCertParties + allSigned", () => {
  it("MC: only contractor present → client missing", () => {
    expect(missingCertParties("mechanical_completion", [sig("contractor")])).toEqual(["client"]);
    expect(allSigned("mechanical_completion", [sig("contractor")])).toBe(false);
  });
  it("MC: contractor + client → complete", () => {
    expect(allSigned("mechanical_completion", [sig("contractor"), sig("client")])).toBe(true);
  });
  it("COD: contractor + client → utility missing", () => {
    const partial = [sig("contractor"), sig("client")];
    expect(missingCertParties("cod", partial)).toEqual(["utility"]);
    expect(allSigned("cod", partial)).toBe(false);
  });
  it("COD: all three → complete", () => {
    expect(
      allSigned("cod", [sig("contractor"), sig("client"), sig("utility")]),
    ).toBe(true);
  });
});

describe("suggestCertNumber", () => {
  it("starts at 0001 when no matches", () => {
    expect(suggestCertNumber("mechanical_completion", [])).toBe("MC-0001");
    expect(suggestCertNumber("cod", ["MC-0007"])).toBe("COD-0001");
  });
  it("increments past highest same-prefix number", () => {
    expect(
      suggestCertNumber("mechanical_completion", ["MC-0001", "MC-0007", "COD-0099"]),
    ).toBe("MC-0008");
  });
  it("ignores non-matching formats", () => {
    expect(suggestCertNumber("cod", ["cod-3", "COD_5", "Other"])).toBe("COD-0001");
  });
});

describe("isPassingPr", () => {
  it("passes when measured >= contract", () => {
    expect(isPassingPr(80, 80)).toBe(true);
    expect(isPassingPr(82, 80)).toBe(true);
  });
  it("fails when measured < contract or values missing", () => {
    expect(isPassingPr(79.9, 80)).toBe(false);
    expect(isPassingPr(null, 80)).toBe(false);
    expect(isPassingPr(80, null)).toBe(false);
    expect(isPassingPr(NaN, 80)).toBe(false);
  });
});
