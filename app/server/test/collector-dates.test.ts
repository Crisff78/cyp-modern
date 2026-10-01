import assert from "node:assert/strict";
import { test } from "node:test";
import { businessDay, dateLabel, timeLabel } from "../../client-collector/src/services/dates.js";

for (const timeZone of ["UTC", "Asia/Tokyo", "America/New_York"]) {
  test(`collector dates keep Dominican time in ${timeZone}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = timeZone;
    try {
      const timestamp = "2026-09-30T02:00:00Z";
      assert.equal(businessDay(timestamp), "2026-09-29");
      assert.match(dateLabel(timestamp), /^29 de septiembre/);
      assert.match(dateLabel(timestamp), /10:00\s*p\.\s*m\./);
      assert.match(timeLabel(new Date(timestamp)), /^10:00:00\s*p\.\s*m\./);

      assert.equal(dateLabel("2026-09-30"), "30 de septiembre");
      assert.equal(businessDay("2026-09-30"), "2026-09-30");
      assert.equal(businessDay("2026-10-01T03:59:59Z"), "2026-09-30");
      assert.equal(businessDay("2026-10-01T04:00:00Z"), "2026-10-01");
      assert.equal(dateLabel("2026-09-30T11:00:00+09:00"), dateLabel(timestamp));
      assert.equal(dateLabel("2026-09-30T02:00:00"), dateLabel(timestamp));
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
}
