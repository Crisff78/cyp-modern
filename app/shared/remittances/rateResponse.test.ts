import assert from "node:assert/strict";
import test from "node:test";
import { confirmedRateResponse } from "./rateResponse";
import { StrictApiError } from "./strictApi";
import type { Rate } from "./types";

const expected: Pick<Rate, "currency" | "date" | "rate"> = { currency: "USD", date: "2026-10-06", rate: "60.50" };
const response: Rate = { id: "synthetic-rate-id", currency: "USD", date: "2026-10-06", rate: "60.500000" };
const pendingResponse = (error: unknown) => error instanceof StrictApiError
  && error.status === 200 && error.uncertain === true && error.code === "RATE_CONFIRMATION_INVALID";

test("rate confirmation accepts equivalent exact decimals without requiring legacy timestamps", () => {
  assert.equal(confirmedRateResponse(response, expected), response);
  assert.equal(Object.hasOwn(response, "updatedAt"), false);
  for (const rate of ["60.5", "60.50", "60.500000", "00060.500000"])
    assert.equal(confirmedRateResponse({ ...response, rate }, expected).rate, rate);
});

test("rate confirmation preserves the returned change metadata", () => {
  const recorded: Rate = { ...response, changeId: "synthetic-change-id", updatedAt: "2026-10-06T16:00:00.000Z", updatedBy: "synthetic-actor" };
  assert.equal(confirmedRateResponse(recorded, expected), recorded);
});

test("rate confirmation supports each real currency and the fixed DOP reference", () => {
  for (const currency of ["DOP", "USD", "EUR"] as const) {
    const rate = currency === "DOP" ? "1" : "0.005000";
    const returned: Rate = { ...response, currency, rate: currency === "DOP" ? "1.000000" : rate };
    assert.equal(confirmedRateResponse(returned, { ...expected, currency, rate }), returned);
  }
});

test("empty, null, nonobject and incomplete responses keep the operation pending", () => {
  for (const result of [null, undefined, {}, [], [response], true, 1, "saved", { id: response.id }, { ...response, id: undefined }, { ...response, currency: undefined }, { ...response, date: undefined }, { ...response, rate: undefined }])
    assert.throws(() => confirmedRateResponse(result, expected), pendingResponse);
});

test("rate confirmation rejects empty, oversized and controlled identifiers", () => {
  for (const id of ["", " ", " synthetic-rate-id", "synthetic-rate-id ", "id\n", "id\tvalue", "id\u0000", "id\u007f", "id\u2028", "x".repeat(81), 1, null])
    assert.throws(() => confirmedRateResponse({ ...response, id }, expected), pendingResponse);
  assert.equal(confirmedRateResponse({ ...response, id: "x".repeat(80) }, expected).id.length, 80);
});

test("a different currency, business date or rate cannot acknowledge the operation", () => {
  for (const patch of [{ currency: "EUR" }, { currency: "usd" }, { currency: "GBP" }, { date: "2026-10-05" }, { date: "2026-10-06 " }, { date: 20261006 }, { rate: "60.500001" }, { rate: "60.499999" }])
    assert.throws(() => confirmedRateResponse({ ...response, ...patch }, expected), pendingResponse);
});

test("rate confirmation rejects malformed or unsupported API decimal precision", () => {
  for (const rate of ["", "0", "0.000000", "-60.5", "+60.5", "60,50", ".5", "1.", "6.05e1", "60.5000000", "1000000000000", " 60.500000", "60.500000\n", "60.50.0", 60.5, null])
    assert.throws(() => confirmedRateResponse({ ...response, rate }, expected), pendingResponse);
  assert.throws(() => confirmedRateResponse(response, { ...expected, rate: "60.5000000" }), pendingResponse);
});

test("rate comparison detects a one-millionth difference beyond floating point precision", () => {
  const maximum = { ...expected, rate: "999999999999.999999" };
  assert.equal(confirmedRateResponse({ ...response, rate: maximum.rate }, maximum).rate, maximum.rate);
  assert.throws(() => confirmedRateResponse({ ...response, rate: "999999999999.999998" }, maximum), pendingResponse);
  const minimum = { ...expected, rate: "0.000001" };
  assert.equal(confirmedRateResponse({ ...response, rate: "0.000001" }, minimum).rate, minimum.rate);
  assert.throws(() => confirmedRateResponse({ ...response, rate: "0.000002" }, minimum), pendingResponse);
});
