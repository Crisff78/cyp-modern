import assert from "node:assert/strict";
import test from "node:test";
import {
  editMoneyEntry,
  moneyEntryCents,
  moneyEntryDisplay,
  moneyEntryPaste,
  moneyEntryValue,
} from "../../shared/moneyEntry";
import { decimalCents } from "../../shared/remittances/output";

test("ATM digits move from cents into whole amounts and grouped thousands without floating point", () => {
  let value = "",
    formatted = "";
  const expected = ["0.01", "0.10", "1.00", "10.00", "100.00", "1,000.00"];
  for (const [index, digit] of [..."100000"].entries()) {
    const next = editMoneyEntry(
      formatted,
      formatted.length,
      formatted.length,
      digit,
    )!;
    value = next.value;
    formatted = moneyEntryDisplay(value);
    assert.equal(formatted, expected[index]);
    assert.equal(next.caret, formatted.length);
  }
  assert.equal(value, "1000.00");
  assert.equal(decimalCents(value), 100000);
  assert.equal(moneyEntryDisplay("123456789012.05"), "123,456,789,012.05");
  assert.equal(
    moneyEntryDisplay("1000"),
    "1,000.00",
    "A saved decimal value is not shifted again.",
  );
});

test("ATM backspace, forward delete and selected replacements preserve cents and caret", () => {
  assert.deepEqual(editMoneyEntry("1,000.00", 8, 8, "", "backward"), {
    value: "100.00",
    caret: 6,
  });
  assert.deepEqual(editMoneyEntry("1,000.00", 0, 8, "5"), {
    value: "0.05",
    caret: 4,
  });
  assert.deepEqual(editMoneyEntry("1,000.00", 0, 8, ""), {
    value: "",
    caret: 0,
  });
  assert.deepEqual(editMoneyEntry("0.00", 4, 4, "", "backward"), {
    value: "",
    caret: 0,
  });
  assert.equal(editMoneyEntry("123.45", 1, 2, "9")?.value, "193.45");
  assert.equal(editMoneyEntry("123.45", 1, 1, "", "forward")?.value, "13.45");
  assert.equal(editMoneyEntry("123.45", 2, 2, "0")?.value, "1203.45");
});

test("paste recognizes digit cents or explicit decimal amounts and rejects the whole malformed clipboard", () => {
  assert.equal(moneyEntryPaste("100000"), "1000.00");
  assert.equal(moneyEntryPaste("1000.5"), "1000.50");
  assert.equal(moneyEntryPaste("1,000"), "1000.00");
  assert.equal(moneyEntryPaste("1,000.05"), "1000.05");
  assert.equal(moneyEntryPaste("9007199254740991"), "90071992547409.91");
  for (const invalid of [
    "",
    "1e3",
    "0x10",
    "-1",
    "+1",
    "1,25",
    "1.000,00",
    "1,000.001",
    " 100",
    "100\n",
    "1;DROP TABLE",
    "１２",
    "1\u200b",
    "9007199254740992",
    "90,071,992,547,409.92",
    "0".repeat(25),
  ]) {
    assert.equal(moneyEntryPaste(invalid), undefined, invalid);
  }
});

test("the safe integer boundary is exact, and invalid editing never becomes a different amount", () => {
  const safe = BigInt(Number.MAX_SAFE_INTEGER);
  assert.equal(moneyEntryCents("90,071,992,547,409.91"), safe);
  assert.equal(moneyEntryCents("90,071,992,547,409.92"), undefined);
  assert.equal(moneyEntryValue(safe), "90071992547409.91");
  const largest = "90,071,992,547,409.91";
  assert.equal(
    editMoneyEntry(largest, largest.length, largest.length, "2"),
    undefined,
  );
  assert.equal(editMoneyEntry("1.00", 0, 4, "1e3"), undefined);
  assert.equal(moneyEntryDisplay("1;DROP"), "1;DROP");
});
