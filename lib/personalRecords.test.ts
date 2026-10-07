import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_PERSONAL_DATA, type PersonalRecords } from "./personalData.ts";
import {
  furthestScrollWasBeaten,
  NEW_RECORD_SESSION,
  recordVisiblePrime,
  sessionAfterJump,
  type RecordSession,
} from "./personalRecords.ts";

/** Plays a sequence of user actions through the record rules. */
function play(actions: Array<{ scrollTo: bigint } | { jumpTo: bigint; lands: bigint }>) {
  let records: PersonalRecords = EMPTY_PERSONAL_DATA.records;
  let session: RecordSession = NEW_RECORD_SESSION;
  for (const action of actions) {
    if ("jumpTo" in action) {
      session = sessionAfterJump(action.jumpTo);
      records = recordVisiblePrime(records, session, action.lands);
    } else {
      records = recordVisiblePrime(records, session, action.scrollTo);
    }
  }
  return records;
}

describe("furthest scroll", () => {
  it("counts scrolling from 2", () => {
    const records = play([{ scrollTo: 113n }, { scrollTo: 7919n }]);
    assert.equal(records.furthestScroll, "7919");
  });

  it("ignores everything after a jump, including scrolling on from there", () => {
    const records = play([
      { scrollTo: 7919n },
      { jumpTo: 1_000_000n, lands: 1_000_003n },
      { scrollTo: 1_020_000n },
    ]);
    assert.equal(records.furthestScroll, "7919");
  });

  it("resumes after jumping back to 2 (or anything below it)", () => {
    for (const backToStart of [2n, 1n, 0n]) {
      const records = play([
        { scrollTo: 7919n },
        { jumpTo: 1_000_000n, lands: 1_000_003n },
        { jumpTo: backToStart, lands: 29n },
        { scrollTo: 7907n }, // not past the record yet
        { scrollTo: 104_729n },
      ]);
      assert.equal(records.furthestScroll, "104729");
    }
  });

  it("never goes down", () => {
    const records = play([{ scrollTo: 7919n }, { jumpTo: 2n, lands: 29n }, { scrollTo: 113n }]);
    assert.equal(records.furthestScroll, "7919");
  });
});

describe("biggest prime visited", () => {
  it("includes jumps", () => {
    const records = play([{ scrollTo: 7919n }, { jumpTo: 1_000_000n, lands: 1_000_003n }]);
    assert.equal(records.biggestPrimeVisited, "1000003");
  });

  it("works far past 2^64", () => {
    const huge = 2n ** 100n + 277n;
    const records = play([{ jumpTo: huge, lands: huge }]);
    assert.equal(records.biggestPrimeVisited, huge.toString());
  });
});

describe("“New record!”", () => {
  it("is for beating an existing record, not for setting the first one", () => {
    const none = EMPTY_PERSONAL_DATA.records;
    const first = { furthestScroll: "113", biggestPrimeVisited: "113" };
    const beaten = { furthestScroll: "7919", biggestPrimeVisited: "7919" };
    assert.equal(furthestScrollWasBeaten(none, first), false);
    assert.equal(furthestScrollWasBeaten(first, beaten), true);
    assert.equal(furthestScrollWasBeaten(beaten, beaten), false);
  });
});
