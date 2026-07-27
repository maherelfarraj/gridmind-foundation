/**
 * Award-state invariants for RFQ bids.
 *
 * The awarded state of a bid is represented twice: as rows in
 * `rfq_line_awards` (the source of truth) and as `rfq_bids.status = 'awarded'`
 * (a denormalised label). These must never drift apart:
 *
 *    bid.status === 'awarded'  ⟺  at least one award row references that bid
 *
 * `rfq_unaward_line()` enforces this transactionally in the database; the
 * helpers below make the same rule executable in tests and in application code.
 */

export type BidStateRow = { id: string; status: string };
export type AwardStateRow = { rfq_bid_id: string };

export type InvariantViolation = {
  bid_id: string;
  kind: "awarded_without_award_row" | "award_row_without_awarded_status";
};

/** Returns every bid whose status disagrees with its award rows. */
export function findAwardInvariantViolations(
  bids: readonly BidStateRow[],
  awards: readonly AwardStateRow[],
): InvariantViolation[] {
  const awarded = new Set(awards.map((a) => a.rfq_bid_id));
  const out: InvariantViolation[] = [];
  for (const bid of bids) {
    const hasRow = awarded.has(bid.id);
    if (bid.status === "awarded" && !hasRow) {
      out.push({ bid_id: bid.id, kind: "awarded_without_award_row" });
    } else if (bid.status !== "awarded" && hasRow) {
      out.push({ bid_id: bid.id, kind: "award_row_without_awarded_status" });
    }
  }
  return out;
}

export function awardInvariantHolds(
  bids: readonly BidStateRow[],
  awards: readonly AwardStateRow[],
): boolean {
  return findAwardInvariantViolations(bids, awards).length === 0;
}

/**
 * Pure model of the transactional unaward performed by `rfq_unaward_line()`:
 * delete the award row and, when no awards remain for that bid, revert the bid
 * status to its pre-award state. Both effects apply together or not at all.
 */
export function applyUnaward(
  bids: readonly BidStateRow[],
  awards: readonly (AwardStateRow & { id: string })[],
  awardId: string,
  preAwardStatus = "submitted",
): { bids: BidStateRow[]; awards: (AwardStateRow & { id: string })[] } {
  const target = awards.find((a) => a.id === awardId);
  if (!target) return { bids: [...bids], awards: [...awards] };

  const nextAwards = awards.filter((a) => a.id !== awardId);
  const stillAwarded = nextAwards.some((a) => a.rfq_bid_id === target.rfq_bid_id);
  const nextBids = bids.map((b) =>
    b.id === target.rfq_bid_id && !stillAwarded && b.status === "awarded"
      ? { ...b, status: preAwardStatus }
      : b,
  );
  return { bids: nextBids, awards: nextAwards };
}

/** Award is idempotent: awarding an already-awarded line changes nothing. */
export function isLineAlreadyAwarded(
  awards: readonly { line_no: number }[],
  lineNo: number,
): boolean {
  return awards.some((a) => a.line_no === lineNo);
}
