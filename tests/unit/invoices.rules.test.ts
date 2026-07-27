
describe("defaultDueDate", () => {
  it("adds the default net terms", () => {
    expect(defaultDueDate("2026-07-27")).toBe("2026-08-26");
  });
  it("handles month and year rollover", () => {
    expect(defaultDueDate("2026-12-20", 30)).toBe("2027-01-19");
  });
  it("supports custom and zero terms", () => {
    expect(defaultDueDate("2026-07-27", 45)).toBe("2026-09-10");
    expect(defaultDueDate("2026-07-27", 0)).toBe("2026-07-27");
  });
  it("rejects an invalid issue date", () => {
    expect(() => defaultDueDate("not-a-date")).toThrow();
  });
});
