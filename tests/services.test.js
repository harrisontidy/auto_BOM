import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildFallbackQuery, buildSearchQueries, buildSearchQuery, buildSpecializedQuery, candidateCanFulfill, isCompatibleCandidate, isExactPartNumberMatch, normalizeProduct } from "../services/digikey.js";
import { footprintFor, genericSymbol, resolveKiCadAssets } from "../services/kicad-assets.js";

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

test("uses only an explicit part number when one is already assigned", () => {
  assert.deepEqual(buildSearchQueries({
    componentType: "Voltage regulator",
    supplierPartNumber: " LM2596S-5.0 ",
    normalizedValue: "5 V",
    aiSearchTerms: "5V 3A buck regulator",
  }), ["LM2596S-5.0"]);
  assert.equal(isExactPartNumberMatch("LM2596S-5.0", { manufacturerPartNumber: "LM2596S-5.0/NOPB" }), false);
  assert.equal(isExactPartNumberMatch("LM2596S-5.0", { manufacturerPartNumber: "LM2596S-5.0" }), true);
  assert.equal(isCompatibleCandidate(
    { componentType: "Resistor", value: "10 kOhm", footprint: "R_0805", supplierPartNumber: "311-10K-ND" },
    { digiKeyPartNumber: "311-10K-ND", parameters: {} },
  ), true);
});

test("builds a DigiKey-friendly fallback for common capacitors", () => {
  assert.equal(buildFallbackQuery({ componentType: "Capacitor", normalizedValue: "100 nF", footprint: "C_0805_2012Metric" }), "0.1uF 0805 ceramic capacitor");
  assert.equal(buildFallbackQuery({ componentType: "Capacitor", normalizedValue: "470 µF", footprint: "CP_Radial_D10.0mm_P5.00mm" }), "470uF CP Radial D10.0mm P5.00mm electrolytic capacitor");
});

test("rejects loose DigiKey passive matches with the wrong value or package", () => {
  const component = { componentType: "Capacitor", normalizedValue: "100 nF", footprint: "C_0805_2012Metric" };
  assert.equal(isCompatibleCandidate(component, { parameters: { Capacitance: "0.1 µF", "Package / Case": "0805 (2012 Metric)" } }), true);
  assert.equal(isCompatibleCandidate(component, { parameters: { Capacitance: "8200 pF", "Package / Case": "0805 (2012 Metric)" } }), false);
  assert.equal(isCompatibleCandidate(component, { parameters: { Capacitance: "100 nF", "Package / Case": "0603 (1608 Metric)" } }), false);
  assert.equal(isCompatibleCandidate(
    { componentType: "Resistor", normalizedValue: "15.8 kΩ", footprint: "R_0805_2012Metric" },
    { parameters: { Resistance: "15.8 kOhms", "Package / Case": "0805 (2012 Metric)" } },
  ), true);
});

test("ignores zero-stock and unaffordable high-MOQ packaging", () => {
  const candidate = normalizeProduct({
    ManufacturerProductNumber: "PART-1",
    ProductVariations: [
      { DigiKeyProductNumber: "PART-1CT-ND", QuantityAvailableforPackageType: 0, MinimumOrderQuantity: 1, PackageType: { Name: "Cut Tape (CT)" }, StandardPricing: [{ BreakQuantity: 1, UnitPrice: 0.1 }] },
      { DigiKeyProductNumber: "PART-1TR-ND", QuantityAvailableforPackageType: 5000, MinimumOrderQuantity: 1000, PackageType: { Name: "Tape & Reel (TR)" }, StandardPricing: [{ BreakQuantity: 1000, UnitPrice: 0.04 }] },
      { DigiKeyProductNumber: "PART-1DKR-ND", QuantityAvailableforPackageType: 500, MinimumOrderQuantity: 1, PackageType: { Name: "Digi-Reel" }, StandardPricing: [{ BreakQuantity: 1, UnitPrice: 0.12 }] },
    ],
  }, 1);
  assert.equal(candidate.digiKeyPartNumber, "PART-1DKR-ND");
  assert.equal(candidate.quantityAvailable, 500);
  assert.equal(candidateCanFulfill(candidate, 1), true);
  assert.equal(candidateCanFulfill({ quantityAvailable: 4 }, 5), false);
  assert.equal(candidateCanFulfill({ quantityAvailable: 5000, minimumOrderQuantity: 1000 }, 1), false);
});

test("builds a concise power-regulator query even when AI terms are verbose", () => {
  assert.equal(buildSpecializedQuery({
    componentType: "Voltage regulator",
    originalQuery: "5 V 3 A highly efficient voltage regulator for a 12 V input",
    summary: "12 V input to 5 V output, 3 A high-efficiency buck regulator",
    value: "12 V to 5 V at 3 A",
    requirements: ["12 V input"],
    aiSearchTerms: "5 V output, 3 A Power IC or module (unspecified) Voltage regulator",
  }), "5V 3A buck regulator");
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

test("only creates a generic connector for an explicit 2.54 mm pin header", () => {
  assert.equal(genericSymbol("Connector", "USB-C receptacle", 16), "");
  assert.equal(footprintFor("Connector", "USB-C receptacle", 16), "");
  assert.equal(genericSymbol("Connector", "1x03 2.54 mm vertical pin header", 3), "Connector_Generic:Conn_01x03");
  assert.equal(footprintFor("Connector", "1x03 2.54 mm vertical pin header", 3), "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical");
});

test("uses an exact KiCad symbol and safely removes a tape-reel suffix", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-bom-symbols-"));
  try {
    await writeFile(join(directory, "Regulator_Test.kicad_sym"), `(kicad_symbol_lib\n\t(symbol "TPS5430DDA"\n\t\t(property "Footprint" "Package_SO:SO-PowerPAD-8_3.9x4.9mm_P1.27mm")\n\t)\n)`);
    const assets = await resolveKiCadAssets({ componentType: "Integrated circuit" }, { manufacturerPartNumber: "TPS5430DDAR" }, { KICAD10_SYMBOL_DIR: directory });
    assert.equal(assets.symbolId, "Regulator_Test:TPS5430DDA");
    assert.equal(assets.footprintId, "Package_SO:SO-PowerPAD-8_3.9x4.9mm_P1.27mm");
    assert.equal(assets.exactSymbol, true);
    assert.equal(assets.placeable, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
