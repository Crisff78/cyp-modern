import test from "node:test";
import assert from "node:assert/strict";
import { confirmedRraaPreview } from "../src/rraaValidation";
import { StrictApiError } from "../../shared/remittances/strictApi";

const expected = { clientId: "QA-COMPANY", stationCode: "QA-STATION", deviceId: "QA-DEVICE" };
const result = { ...expected, license: "QA-LICENSE", validatedAt: "2026-10-09T16:00:00.000Z" };
const denied = (error: unknown) => error instanceof StrictApiError && error.code === "RRAA_PREVIEW_INVALID" && !error.uncertain;

test("RRAA preview confirms a complete response for the requested company, station and device", () => {
  assert.equal(confirmedRraaPreview(result, expected), result);
  assert.equal(confirmedRraaPreview(result, { ...expected, stationCode: " QA-STATION ", deviceId: " QA-DEVICE " }), result);
  assert.equal(confirmedRraaPreview({ ...result, clientId: "0" }, { ...expected, clientId: "0" }).clientId, "0");
});

test("RRAA preview never accepts incomplete, foreign or malformed validation as authorization", () => {
  for (const row of [null, undefined, [], [result], "OK", {}, { ...result, clientId: undefined },
    { ...result, clientId: "OTHER-COMPANY" }, { ...result, stationCode: "OTHER-STATION" }, { ...result, deviceId: "OTHER-DEVICE" },
    { ...result, license: "" }, { ...result, license: " padded " }, { ...result, license: "x|y" }, { ...result, license: "x\ny" },
    { ...result, license: "x".repeat(1025) }, { ...result, validatedAt: "invalid" }, { ...result, validatedAt: "2026-02-30T16:00:00.000Z" }])
    assert.throws(() => confirmedRraaPreview(row, expected), denied);
});
