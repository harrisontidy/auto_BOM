import assert from "node:assert/strict";
import test from "node:test";
import { applyAiInterpretation, inferPackage, normalizeValue, parseCsv } from "./parser.js";

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
  assert.deepEqual(bom[1].warnings, ["Footprint not present in export"]);
});

test("recognizes KiCad Designator and Designation columns", () => {
  const csv = "Id,Designator,Footprint,Quantity,Designation,Supplier and ref\n2,\"C2, C15, C19\",C_0805_2012Metric,3,100nF,";
  const [part] = parseCsv(csv);
  assert.deepEqual(part.references, ["C2", "C15", "C19"]);
  assert.equal(part.value, "100nF");
  assert.equal(part.valueSource, "Designation");
  assert.equal(part.componentType, "Capacitor");
  assert.equal(part.packageDescription, "0805 (2 × 1.2 mm)");
  assert.deepEqual(part.warnings, []);
});

test("derives safe physical facts without inventing an electrical value", () => {
  const [part] = parseCsv("Designator,Footprint,Quantity,Designation\nC18,CP_Radial_D10.0mm_P5.00mm,1,");
  assert.equal(part.componentType, "Capacitor");
  assert.equal(part.packageDescription, "Radial, 10 mm diameter, 5 mm pitch");
  assert.match(part.warnings[0], /value not present/);
});

test("AI interpretation cannot overwrite explicit BOM facts", () => {
  const [original] = parseCsv("Designator,Footprint,Quantity,Designation\nR4,R_0805_2012Metric,1,15.8k");
  const result = applyAiInterpretation(original, {
    references: ["R3"], value: "22.1k", footprint: "R_0603_1608Metric", quantity: 99,
    searchTerms: "15.8 kΩ 0805 resistor", warnings: ["Tolerance missing"],
  });
  assert.deepEqual(result.references, ["R4"]);
  assert.equal(result.value, "15.8k");
  assert.equal(result.footprint, "R_0805_2012Metric");
  assert.equal(result.quantity, 1);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.aiSearchTerms, "15.8 kΩ 0805 resistor");
});

test("does not interpret a bare fuse rating as resistance", () => {
  const [fuse] = parseCsv("Designator,Footprint,Quantity,Designation\nF1,FUSE_3587,1,15");
  assert.equal(fuse.normalizedValue, "15");
});
