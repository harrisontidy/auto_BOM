import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildFallbackQuery, buildSearchQuery } from "./services/digikey.js";
import { footprintFor, genericSymbol, resolveKiCadAssets } from "./services/kicad-assets.js";

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

test("maps ordinary passives to safe KiCad symbols and footprints", () => {
  assert.equal(genericSymbol("Resistor", "0805"), "Device:R");
  assert.equal(footprintFor("resistor", "0805 (2012 metric)"), "Resistor_SMD:R_0805_2012Metric");
  assert.equal(genericSymbol("Capacitor", "0805 ceramic"), "Device:C");
  assert.equal(footprintFor("capacitor", "0805 ceramic"), "Capacitor_SMD:C_0805_2012Metric");
});

test("does not invent a generic IC symbol with an unknown pinout", () => {
  assert.equal(genericSymbol("Integrated circuit", "QFN-24"), "");
});

test("uses an exact KiCad symbol's assigned footprint when available", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-bom-symbols-"));
  try {
    await writeFile(join(directory, "Regulator_Test.kicad_sym"), `(kicad_symbol_lib\n\t(symbol "TPS5430DDAR"\n\t\t(property "Footprint" "Package_SO:SO-PowerPAD-8_3.9x4.9mm_P1.27mm")\n\t)\n)`);
    const assets = await resolveKiCadAssets({ componentType: "Integrated circuit" }, { manufacturerPartNumber: "TPS5430DDAR" }, { KICAD10_SYMBOL_DIR: directory });
    assert.equal(assets.symbolId, "Regulator_Test:TPS5430DDAR");
    assert.equal(assets.footprintId, "Package_SO:SO-PowerPAD-8_3.9x4.9mm_P1.27mm");
    assert.equal(assets.placeable, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
