import { describe, expect, it } from "vitest";

import {
  applyUnaward,
  awardInvariantHolds,
  findAwardInvariantViolations,
  isLineAlreadyAwarded,
} from "@/lib/rfq-award.invariants";

const BID_PETRA = "9e45ccee-85c5-465a-bd65-5027dc615f1b";
const BID_TRINA = "77e9b85b-dfc2-4f5d-bd50-57fa503244b1";
const BID_LONGI = "ecae3084-9641-4bd6-a01a-5787c67a6e2b";

describe("RFQ award invariant: bid.status = 'awarded' ⟺ an award row exists", () => {
  it("holds for a consistent snapshot", () => {
    const bids = [
      { id: BID_PETRA, status: "awarded" },
      { id: BID_TRINA, status: "awarded" },
      { id: BID_LONGI, status: "submitted" },
    ];
    const awards = [{ rfq_bid_id: BID_PETRA }, { rfq_bid_id: BID_TRINA }];
    expect(awardInvariantHolds(bids, awards)).toBe(true);
  });

  it("detects the Day-2 defect: awarded bid with no surviving award row", () => {
    const bids = [
      { id: BID_PETRA, status: "awarded" },
      { id: BID_TRINA, status: "awarded" },
    ];
    const awards = [{ rfq_bid_id: BID_TRINA }];
    expect(findAwardInvariantViolations(bids, awards)).toEqual([
      { bid_id: BID_PETRA, kind: "awarded_without_award_row" },
    ]);
  });

  it("detects the reverse drift: award row on a non-awarded bid", () => {
    const bids = [{ id: BID_PETRA, status: "submitted" }];
    const awards = [{ rfq_bid_id: BID_PETRA }];
    expect(findAwardInvariantViolations(bids, awards)).toEqual([
      { bid_id: BID_PETRA, kind: "award_row_without_awarded_status" },
    ]);
  });
});

describe("transactional unaward", () => {
  it("deletes the award row and reverts the bid status together", () => {
    const bids = [{ id: BID_PETRA, status: "awarded" }];
    const awards = [{ id: "a1", rfq_bid_id: BID_PETRA }];

    const next = applyUnaward(bids, awards, "a1");

    expect(next.awards).toHaveLength(0);
    expect(next.bids[0].status).toBe("submitted");
    expect(awardInvariantHolds(next.bids, next.awards)).toBe(true);
  });

  it("keeps the bid awarded while another awarded line remains", () => {
    const bids = [{ id: BID_PETRA, status: "awarded" }];
    const awards = [
      { id: "a1", rfq_bid_id: BID_PETRA },
      { id: "a3", rfq_bid_id: BID_PETRA },
    ];

    const next = applyUnaward(bids, awards, "a1");

    expect(next.awards.map((a) => a.id)).toEqual(["a3"]);
    expect(next.bids[0].status).toBe("awarded");
    expect(awardInvariantHolds(next.bids, next.awards)).toBe(true);
  });

  it("is a no-op for an unknown award id and preserves the invariant", () => {
    const bids = [{ id: BID_TRINA, status: "awarded" }];
    const awards = [{ id: "a2", rfq_bid_id: BID_TRINA }];

    const next = applyUnaward(bids, awards, "does-not-exist");

    expect(next.awards).toHaveLength(1);
    expect(next.bids[0].status).toBe("awarded");
    expect(awardInvariantHolds(next.bids, next.awards)).toBe(true);
  });

  it("leaves other vendors' awards untouched", () => {
    const bids = [
      { id: BID_PETRA, status: "awarded" },
      { id: BID_TRINA, status: "awarded" },
    ];
    const awards = [
      { id: "a1", rfq_bid_id: BID_PETRA },
      { id: "a2", rfq_bid_id: BID_TRINA },
    ];

    const next = applyUnaward(bids, awards, "a1");

    expect(next.bids.find((b) => b.id === BID_TRINA)?.status).toBe("awarded");
    expect(awardInvariantHolds(next.bids, next.awards)).toBe(true);
  });
});

describe("award idempotency", () => {
  it("reports an already-awarded line so Award cannot toggle it off", () => {
    const awards = [{ line_no: 2 }];
    expect(isLineAlreadyAwarded(awards, 2)).toBe(true);
    expect(isLineAlreadyAwarded(awards, 1)).toBe(false);
  });
});
