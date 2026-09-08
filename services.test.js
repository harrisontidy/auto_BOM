import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackQuery, buildSearchQuery } from "./services/digikey.js";

test("builds a DigiKey query from normalized value and KiCad footprint", () => {
  assert.equal(buildSearchQuery({ value: "4k7", normalizedValue: "4.7 kΩ", footprint: "Resistor_SMD:R_0603_1608Metric" }), "4.7 kohm 0603");
});

test("keeps named footprints when no standard size is present", () => {
  assert.equal(buildSearchQuery({ value: "ATmega328P-AU", normalizedValue: "ATmega328P-AU", footprint: "Package_QFP:TQFP-32_7x7mm_P0.8mm" }), "ATmega328P-AU TQFP-32 7x7mm P0.8mm");
});

test("prefers an explicit supplier number and then AI reviewed search terms", () => {
  assert.equal(buildSearchQuery({ supplierPartNumber: "296-12345-1-ND", aiSearchTerms: "ignored" }), "296-12345-1-ND");
  assert.equal(buildSearchQuery({ aiSearchTerms: "100 nF ceramic capacitor 0805" }), "100 nF ceramic capacitor 0805");
});

test("builds a DigiKey-friendly fallback for common capacitors", () => {
  assert.equal(buildFallbackQuery({ componentType: "Capacitor", normalizedValue: "100 nF", footprint: "C_0805_2012Metric" }), "0.1uF 0805 ceramic capacitor");
  assert.equal(buildFallbackQuery({ componentType: "Capacitor", normalizedValue: "470 µF", footprint: "CP_Radial_D10.0mm_P5.00mm" }), "470uF CP Radial D10.0mm P5.00mm electrolytic capacitor");
});
