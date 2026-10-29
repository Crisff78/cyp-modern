import assert from "node:assert/strict";
import test from "node:test";
import {
  editMoneyEntry,
  moneyEntryCents,
  moneyEntryDisplay,
  moneyEntryPaste,
  moneyEntryValue,
  moneyTypedDisplay,
} from "../../shared/moneyEntry";
import { decimalCents } from "../../shared/remittances/output";

// Since 29-10-2026 amounts are typed from left to right, as any number (Rardiel): 1500 is 1,500.00.
const typeAll = (keys: string, start = "") => {
  let shown = start, edit = { typed: "", value: "", caret: 0 };
  const steps: string[] = [];
  for (const key of keys) {
    edit = editMoneyEntry(shown, shown.length, shown.length, key)!;
    assert.ok(edit, `${keys}: ${key}`);
    shown = moneyTypedDisplay(edit.typed);
    assert.equal(edit.caret, shown.length, "the caret stays after what was typed");
    steps.push(shown);
  }
  return { ...edit, shown, steps };
};

test("digits are typed from left to right, with the commas of the thousands and without floating point", () => {
  const thousand = typeAll("1500");
  assert.deepEqual(thousand.steps, ["1", "15", "150", "1,500"]);
  assert.equal(thousand.value, "1500.00");
  assert.equal(moneyEntryDisplay(thousand.value), "1,500.00", "leaving the field shows the whole amount");
  assert.equal(decimalCents(thousand.value), 150000);
  // The point starts the cents, up to two.
  const cents = typeAll("1500.5");
  assert.deepEqual(cents.steps.slice(-2), ["1,500.", "1,500.5"]);
  assert.equal(cents.value, "1500.50");
  assert.equal(typeAll("0.05").value, "0.05");
  assert.equal(typeAll(".5").shown, "0.5", "a point first means zero units");
  assert.equal(typeAll("007").shown, "7", "zeros in front are dropped");
  assert.equal(typeAll("1234567").shown, "1,234,567");
  assert.equal(moneyEntryDisplay("123456789012.05"), "123,456,789,012.05");
  assert.equal(moneyEntryDisplay("1000"), "1,000.00", "A saved decimal value is shown as it is.");
});

test("backspace, forward delete and selected replacements work as in any text field", () => {
  assert.deepEqual(editMoneyEntry("1,000.00", 8, 8, "", "backward"), { typed: "1000.0", value: "1000.00", caret: 7 });
  assert.deepEqual(editMoneyEntry("1,000.00", 0, 8, "5"), { typed: "5", value: "5.00", caret: 1 });
  assert.deepEqual(editMoneyEntry("1,000.00", 0, 8, ""), { typed: "", value: "", caret: 0 });
  assert.deepEqual(editMoneyEntry("5", 1, 1, "", "backward"), { typed: "", value: "", caret: 0 });
  assert.equal(editMoneyEntry("123.45", 1, 2, "9")?.value, "193.45");
  assert.equal(editMoneyEntry("123.45", 1, 1, "", "forward")?.value, "13.45");
  assert.equal(editMoneyEntry("123.45", 2, 2, "0")?.value, "1203.45");
  // The comma is skipped: deleting after it removes the digit before it.
  assert.equal(editMoneyEntry("1,500", 5, 5, "", "backward")?.typed, "150");
  // A second point only takes the caret to the cents.
  assert.deepEqual(editMoneyEntry("12.5", 2, 2, "."), { typed: "12.5", value: "12.50", caret: 3 });
  // A third decimal is refused, not rounded.
  assert.equal(editMoneyEntry("12.50", 5, 5, "1"), undefined);
});

test("paste takes the amount as written and rejects the whole malformed clipboard", () => {
  assert.equal(moneyEntryPaste("1500"), "1500.00");
  assert.equal(moneyEntryPaste("1000.5"), "1000.50");
  assert.equal(moneyEntryPaste("1,000"), "1000.00");
  assert.equal(moneyEntryPaste("1,000.05"), "1000.05");
  assert.equal(moneyEntryPaste("90071992547409"), "90071992547409.00");
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
    "1​",
    "900719925474099",
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
  assert.equal(editMoneyEntry(largest, largest.length, largest.length, "2"), undefined);
  assert.equal(editMoneyEntry("90,071,992,547,409.9", 20, 20, "2"), undefined, "one cent over the largest amount");
  assert.equal(editMoneyEntry("90,071,992,547,409", 18, 18, "1"), undefined, "a fifteenth digit");
  assert.equal(editMoneyEntry("1.00", 0, 4, "1e3"), undefined);
  assert.equal(moneyEntryDisplay("1;DROP"), "1;DROP");
});
