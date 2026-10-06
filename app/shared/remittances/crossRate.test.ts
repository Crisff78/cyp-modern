import assert from "node:assert/strict";
import test from "node:test";
import { formatCrossRate } from "./crossRate";

test("cross rate uses source per destination for exact normal and inverse currency pairs", () => {
  assert.deepEqual(formatCrossRate("60.000000", "75.000000"), { text: "0.8", approximate: false });
  assert.deepEqual(formatCrossRate("75.000000", "60.000000"), { text: "1.25", approximate: false });
  assert.deepEqual(formatCrossRate("0.500000", "2.000000"), { text: "0.25", approximate: false });
  assert.deepEqual(formatCrossRate("1.000000", "1.000000"), { text: "1", approximate: false });
});

test("same currency and repeated equivalent rates display exact one without approximating", () => {
  for (const rate of ["0.000001", "0.500000", "1.000000", "60.125000", "999999999999.999999"])
    assert.deepEqual(formatCrossRate(rate, rate), { text: "1", approximate: false });
  assert.deepEqual(formatCrossRate("00001.0", "1.000000"), { text: "1", approximate: false });
  assert.deepEqual(formatCrossRate("1", "8"), { text: "0.125", approximate: false });
});

test("repeating quotients retain twelve significant digits and declare the approximation", () => {
  assert.deepEqual(formatCrossRate("1.000000", "3.000000"), { text: "0.333333333333", approximate: true });
  assert.deepEqual(formatCrossRate("2.000000", "3.000000"), { text: "0.666666666667", approximate: true });
  assert.deepEqual(formatCrossRate("1.000000", "6.000000"), { text: "0.166666666667", approximate: true });
});

test("half-up presentation carries across whole digits without changing financial calculations", () => {
  assert.deepEqual(formatCrossRate("123456789012.000000", "1.000000"), { text: "123456789012", approximate: false });
  assert.deepEqual(formatCrossRate("123456789012.400000", "1.000000"), { text: "123456789012", approximate: true });
  assert.deepEqual(formatCrossRate("123456789012.500000", "1.000000"), { text: "123456789013", approximate: true });
  assert.deepEqual(formatCrossRate("999999999999.500000", "1.000000"), { text: "1000000000000", approximate: true });
});

test("minimum and maximum supported rates never display zero, infinity or scientific notation", () => {
  assert.deepEqual(formatCrossRate("0.000001", "999999999999.999999"), { text: "0.000000000000000001", approximate: true });
  assert.deepEqual(formatCrossRate("999999999999.999999", "0.000001"), { text: "1000000000000000000", approximate: true });
  assert.deepEqual(formatCrossRate("0.000001", "100000000000.000000"), { text: "0.00000000000000001", approximate: false });
  assert.deepEqual(formatCrossRate("100000000000.000000", "0.000001"), { text: "100000000000000000", approximate: false });
});

test("invalid source or destination rates fail instead of inventing a display value", () => {
  const invalid = ["", " ", "0", "0.000000", "-1", "+1", "1e6", "NaN", "Infinity", "1,000000", ".5", "1.", "1.0000000", "1000000000000", " 1.000000 "];
  for (const rate of invalid) {
    assert.throws(() => formatCrossRate(rate, "1.000000"), /tasa/i, `invalid source ${rate}`);
    assert.throws(() => formatCrossRate("1.000000", rate), /tasa/i, `invalid destination ${rate}`);
  }
  assert.throws(() => formatCrossRate(null as unknown as string, "1.000000"), /tasa/i);
});
