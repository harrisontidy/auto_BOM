import assert from "node:assert/strict";
import test from "node:test";
import { normalizeValue, parseCsv } from "./parser.js";

test("normalizes common resistor notation", () => {
  assert.equal(normalizeValue("4k7"), "4.7 kΩ");
  assert.equal(normalizeValue("10K"), "10 kΩ");
});

test("normalizes equivalent capacitor values", () => {
  assert.equal(normalizeValue("0.1uF"), "100 nF");
  assert.equal(normalizeValue("100nF"), "100 nF");
});

test("groups equivalent parts and reports missing footprints", () => {
  const bom = parseCsv("Reference,Value,Footprint,Quantity\nR1,4k7,0603,1\nR2,4.7K,0603,1\nD1,LED,,1");
  assert.equal(bom.length, 2);
  assert.deepEqual(bom[0].references, ["R1", "R2"]);
  assert.equal(bom[0].quantity, 2);
  assert.deepEqual(bom[1].warnings, ["Missing footprint"]);
});

