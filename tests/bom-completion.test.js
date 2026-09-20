import test from "node:test";
import assert from "node:assert/strict";
import { completeSchematicBom } from "../services/bom-completion.js";

const environment = { SOURCING_SUPPLIER: "digikey", OPENAI_API_KEY: "test", DIGIKEY_CLIENT_ID: "test", DIGIKEY_CLIENT_SECRET: "test" };

test("completes a missing passive with the cheapest in-stock DigiKey result", async () => {
  let reviews = 0;
  const result = await completeSchematicBom([
    { reference: "R1", value: "10k", footprint: "Resistor_SMD:R_0805_2012Metric" },
  ], environment, {
    interpretBomCsv: async (_csv, parts) => ({ parts }),
    searchDigiKey: async () => ({ candidates: [{ manufacturerPartNumber: "RC0805FR-0710KL", digiKeyPartNumber: "311-10.0KCRCT-ND", quantityAvailable: 5000, unitPrice: 0.02, currency: "CAD", datasheetUrl: "https://example.test/r", parameters: { "Package / Case": "0805", "Resistance": "10kΩ" }, description: "10 kOhm 0805 resistor" }] }),
    reviewCandidates: async () => { reviews += 1; },
    resolveKiCadAssets: async () => ({ footprintId: "Resistor_SMD:R_0805_2012Metric" }),
  });
  assert.equal(result.failed, 0);
  assert.equal(result.parts[0].manufacturerPartNumber, "RC0805FR-0710KL");
  assert.equal(result.parts[0].digiKeyPartNumber, "311-10.0KCRCT-ND");
  assert.equal(reviews, 0);
});

test("uses AI candidate review for an IC and keeps the reviewed selection", async () => {
  const candidates = [
    { manufacturerPartNumber: "A", digiKeyPartNumber: "A-ND", quantityAvailable: 10 },
    { manufacturerPartNumber: "B", digiKeyPartNumber: "B-ND", quantityAvailable: 20 },
  ];
  const result = await completeSchematicBom([
    { reference: "U1", value: "5V regulator", footprint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" },
  ], environment, {
    interpretBomCsv: async (_csv, parts) => ({ parts: parts.map((part) => ({ ...part, searchTerms: "5V regulator 3A SOIC-8" })) }),
    searchDigiKey: async () => ({ candidates }),
    reviewCandidates: async () => ({ selectedManufacturerPartNumber: "B", selectedDigiKeyPartNumber: "B-ND", confidence: 0.94, concerns: [] }),
    resolveKiCadAssets: async () => ({ footprintId: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" }),
  });
  assert.equal(result.parts[0].manufacturerPartNumber, "B");
});

test("leaves an IC unresolved when AI candidate review is unavailable", async () => {
  let assetLookups = 0;
  const result = await completeSchematicBom([
    { reference: "U1", value: "5V regulator", footprint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" },
  ], environment, {
    interpretBomCsv: async (_csv, parts) => ({ parts }),
    searchDigiKey: async () => ({ candidates: [
      { manufacturerPartNumber: "SAFE-FIRST", digiKeyPartNumber: "SAFE-FIRST-ND", quantityAvailable: 100 },
    ] }),
    reviewCandidates: async () => { throw new Error("temporary AI outage"); },
    resolveKiCadAssets: async () => { assetLookups += 1; return { footprintId: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" }; },
  });
  assert.equal(result.failed, 1);
  assert.equal(result.parts[0].status, "needs review");
  assert.match(result.parts[0].error, /AI candidate review failed/i);
  assert.equal(result.parts[0].manufacturerPartNumber, "");
  assert.equal(assetLookups, 0);
});

test("does not search a line that already has a DigiKey number", async () => {
  let searches = 0;
  const result = await completeSchematicBom([
    { reference: "C1", value: "100nF", footprint: "Capacitor_SMD:C_0805_2012Metric", manufacturerPartNumber: "EXISTING", digiKeyPartNumber: "EXISTING-ND" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async () => { searches += 1; return { candidates: [] }; },
  });
  assert.equal(result.parts[0].status, "already assigned");
  assert.equal(searches, 0);
});

test("copies a sibling's DigiKey number only to unassigned references", async () => {
  let searchedPart;
  const result = await completeSchematicBom([
    { reference: "C1", value: "100nF", footprint: "Capacitor_SMD:C_0805_2012Metric", manufacturerPartNumber: "CAP-MPN", digiKeyPartNumber: "KEEP-ND" },
    { reference: "C2", value: "100nF", footprint: "Capacitor_SMD:C_0805_2012Metric", manufacturerPartNumber: "CAP-MPN", digiKeyPartNumber: "" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async (part) => {
      searchedPart = part;
      return { candidates: [{ manufacturerPartNumber: "CAP-MPN", digiKeyPartNumber: "KEEP-ND", quantityAvailable: 20 }] };
    },
    resolveKiCadAssets: async () => ({ footprintId: "Capacitor_SMD:C_0805_2012Metric" }),
  });
  assert.deepEqual(result.parts[0].references, ["C2"]);
  assert.equal(result.parts[0].digiKeyPartNumber, "KEEP-ND");
  assert.equal(searchedPart.supplierPartNumber, "KEEP-ND");
});

test("enriches a single DigiKey-only row before calling it complete", async () => {
  const result = await completeSchematicBom([
    { reference: "D1", value: "SS14", footprint: "Diode_SMD:D_SMA", digiKeyPartNumber: "SS14-EXISTING-ND" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async (part) => {
      assert.equal(part.supplierPartNumber, "SS14-EXISTING-ND");
      return { candidates: [{ manufacturerPartNumber: "SS14", digiKeyPartNumber: "SS14-EXISTING-ND", quantityAvailable: 20 }] };
    },
    resolveKiCadAssets: async () => ({ footprintId: "Diode_SMD:D_SMA" }),
  });
  assert.equal(result.failed, 0);
  assert.equal(result.parts[0].status, "completed");
  assert.equal(result.parts[0].manufacturerPartNumber, "SS14");
  assert.equal(result.parts[0].digiKeyPartNumber, "SS14-EXISTING-ND");
});

test("enriches a grouped DigiKey-only row and copies its exact number to its sibling", async () => {
  const result = await completeSchematicBom([
    { reference: "D1", value: "SS14", footprint: "Diode_SMD:D_SMA", digiKeyPartNumber: "SS14-EXISTING-ND" },
    { reference: "D2", value: "SS14", footprint: "Diode_SMD:D_SMA", digiKeyPartNumber: "" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async (part) => {
      assert.equal(part.supplierPartNumber, "SS14-EXISTING-ND");
      return { candidates: [{ manufacturerPartNumber: "SS14", digiKeyPartNumber: "SS14-EXISTING-ND", quantityAvailable: 20 }] };
    },
    resolveKiCadAssets: async () => ({ footprintId: "Diode_SMD:D_SMA" }),
  });
  assert.equal(result.failed, 0);
  assert.deepEqual(result.parts[0].references, ["D1", "D2"]);
  assert.equal(result.parts[0].manufacturerPartNumber, "SS14");
  assert.equal(result.parts[0].digiKeyPartNumber, "SS14-EXISTING-ND");
});

test("keeps a DigiKey-only row unresolved when exact metadata enrichment finds nothing", async () => {
  const result = await completeSchematicBom([
    { reference: "D1", value: "SS14", footprint: "Diode_SMD:D_SMA", digiKeyPartNumber: "SS14-EXISTING-ND" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async (part) => {
      assert.equal(part.supplierPartNumber, "SS14-EXISTING-ND");
      return { candidates: [] };
    },
  });
  assert.equal(result.failed, 1);
  assert.equal(result.parts[0].status, "needs review");
  assert.deepEqual(result.parts[0].references, ["D1"]);
  assert.equal(result.parts[0].digiKeyPartNumber, "SS14-EXISTING-ND");
  assert.equal(result.parts[0].manufacturerPartNumber, "");
});

test("ordinary passive BOM lines do not depend on AI interpretation", async () => {
  let searches = 0;
  const result = await completeSchematicBom([
    { reference: "R1", value: "10k", footprint: "Resistor_SMD:R_0805_2012Metric" },
  ], environment, {
    interpretBomCsv: async () => { throw new Error("temporary AI outage"); },
    searchDigiKey: async () => {
      searches += 1;
      return { candidates: [{ manufacturerPartNumber: "R-MPN", digiKeyPartNumber: "R-ND", quantityAvailable: 20, parameters: { "Package / Case": "0805", "Resistance": "10kΩ" }, description: "10 kOhm 0805 resistor" }] };
    },
    resolveKiCadAssets: async () => ({ footprintId: "Resistor_SMD:R_0805_2012Metric" }),
  });
  assert.equal(result.failed, 0);
  assert.equal(result.aiFallback, false);
  assert.equal(searches, 1);
  assert.equal(result.interpretedLines, 0);
});

test("rejects malformed schematic symbols", async () => {
  await assert.rejects(() => completeSchematicBom([null]), /symbol must be an object/i);
  await assert.rejects(() => completeSchematicBom([{ reference: 1 }]), /reference must be text/i);
});

test("merges repeated units of one KiCad reference before searching", async () => {
  let searchedQuantity;
  const result = await completeSchematicBom([
    { reference: "U1", value: "LM358", footprint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", manufacturerPartNumber: "LM358DR" },
    { reference: "U1", value: "LM358", footprint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", manufacturerPartNumber: "LM358DR" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async (part) => {
      searchedQuantity = part.quantity;
      return { candidates: [{ manufacturerPartNumber: "LM358DR", digiKeyPartNumber: "296-LM358DRCT-ND", quantityAvailable: 20 }] };
    },
    resolveKiCadAssets: async () => ({ footprintId: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" }),
  });
  assert.equal(result.parts.length, 1);
  assert.deepEqual(result.parts[0].references, ["U1"]);
  assert.equal(searchedQuantity, 1);
});

test("does not search a resistor whose value is only the default R placeholder", async () => {
  let searches = 0;
  const result = await completeSchematicBom([
    { reference: "R1", value: "R", footprint: "Resistor_SMD:R_0805_2012Metric" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async () => { searches += 1; return { candidates: [] }; },
  });
  assert.equal(searches, 0);
  assert.equal(result.parts[0].status, "needs review");
  assert.match(result.parts[0].error, /placeholder/i);
});

test("honors a missing-value parser warning instead of sourcing an arbitrary part", async () => {
  let searches = 0;
  const result = await completeSchematicBom([
    { reference: "C1", value: "", footprint: "Capacitor_SMD:C_0805_2012Metric" },
  ], environment, {
    interpretBomCsv: async (_csv, parts) => ({ parts: parts.map((part) => ({ ...part, searchTerms: "0805 capacitor" })) }),
    searchDigiKey: async () => { searches += 1; return { candidates: [] }; },
  });
  assert.equal(searches, 0);
  assert.equal(result.parts[0].status, "needs review");
  assert.match(result.parts[0].error, /no electrical value/i);
});

test("does not let AI invent a missing electrical value from a blank source field", async () => {
  let searches = 0;
  const result = await completeSchematicBom([
    { reference: "R1", value: "", footprint: "Resistor_SMD:R_0805_2012Metric" },
  ], environment, {
    interpretBomCsv: async (_csv, parts) => ({ parts: parts.map((part) => ({ ...part, value: "10k", searchTerms: "10 kOhm 0805 resistor" })) }),
    searchDigiKey: async () => { searches += 1; return { candidates: [] }; },
  });
  assert.equal(searches, 0);
  assert.equal(result.parts[0].status, "needs review");
  assert.match(result.parts[0].error, /no electrical value/i);
});

test("selects the first in-stock resistor that matches both value and package", async () => {
  const result = await completeSchematicBom([
    { reference: "R1", value: "10k", footprint: "Resistor_SMD:R_0805_2012Metric" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async () => ({ candidates: [
      { manufacturerPartNumber: "WRONG-VALUE", digiKeyPartNumber: "WRONG-VALUE-ND", quantityAvailable: 100, description: "1 kOhm 0805 resistor" },
      { manufacturerPartNumber: "WRONG-SIZE", digiKeyPartNumber: "WRONG-SIZE-ND", quantityAvailable: 100, description: "10 kOhm 0603 resistor" },
      { manufacturerPartNumber: "RIGHT", digiKeyPartNumber: "RIGHT-ND", quantityAvailable: 100, parameters: { "Package / Case": "0805", "Resistance": "10kΩ" }, description: "10 kOhm 0805 resistor" },
    ] }),
    resolveKiCadAssets: async () => ({ footprintId: "Resistor_SMD:R_0805_2012Metric" }),
  });
  assert.equal(result.failed, 0);
  assert.equal(result.parts[0].manufacturerPartNumber, "RIGHT");
});

test("requires AI review for a diode without an exact part-number field", async () => {
  let reviews = 0;
  const candidates = [
    { manufacturerPartNumber: "DIODE-A", digiKeyPartNumber: "DIODE-A-ND", quantityAvailable: 100 },
    { manufacturerPartNumber: "DIODE-B", digiKeyPartNumber: "DIODE-B-ND", quantityAvailable: 100 },
  ];
  const result = await completeSchematicBom([
    { reference: "D1", value: "Schottky 40V 1A", footprint: "Diode_SMD:D_SMA" },
  ], environment, {
    interpretBomCsv: async (_csv, parts) => ({ parts }),
    searchDigiKey: async () => ({ candidates }),
    reviewCandidates: async () => { reviews += 1; return { selectedManufacturerPartNumber: "DIODE-B", selectedDigiKeyPartNumber: "DIODE-B-ND", confidence: 0.91, concerns: [] }; },
    resolveKiCadAssets: async () => ({ footprintId: "Diode_SMD:D_SMA" }),
  });
  assert.equal(reviews, 1);
  assert.equal(result.parts[0].manufacturerPartNumber, "DIODE-B");
});

test("does not choose a nontrivial part when AI review is disabled", async () => {
  const result = await completeSchematicBom([
    { reference: "F1", value: "2A fuse", footprint: "Fuse:Fuse_1206_3216Metric" },
  ], { SOURCING_SUPPLIER: "digikey" }, {
    searchDigiKey: async () => ({ candidates: [
      { manufacturerPartNumber: "FUSE-A", digiKeyPartNumber: "FUSE-A-ND", quantityAvailable: 100 },
    ] }),
  });
  assert.equal(result.parts[0].status, "needs review");
  assert.match(result.parts[0].error, /AI review is required/i);
  assert.equal(result.parts[0].manufacturerPartNumber, "");
});

test("does not auto-assign an AI selection with concerns or low confidence", async (t) => {
  for (const review of [
    { selectedManufacturerPartNumber: "DIODE-A", selectedDigiKeyPartNumber: "DIODE-A-ND", confidence: 0.95, concerns: ["Reverse-voltage rating is unclear"] },
    { selectedManufacturerPartNumber: "DIODE-A", selectedDigiKeyPartNumber: "DIODE-A-ND", confidence: 0.45, concerns: [] },
  ]) {
    await t.test(review.concerns.length ? "reported concern" : "low confidence", async () => {
      const result = await completeSchematicBom([
        { reference: "D1", value: "Schottky 40V 1A", footprint: "Diode_SMD:D_SMA" },
      ], environment, {
        interpretBomCsv: async (_csv, parts) => ({ parts }),
        searchDigiKey: async () => ({ candidates: [
          { manufacturerPartNumber: "DIODE-A", digiKeyPartNumber: "DIODE-A-ND", quantityAvailable: 100 },
        ] }),
        reviewCandidates: async () => review,
      });
      assert.equal(result.parts[0].status, "needs review");
      assert.equal(result.parts[0].manufacturerPartNumber, "");
      assert.match(result.parts[0].error, review.concerns.length ? /raised concerns/i : /confidence was too low/i);
    });
  }
});
