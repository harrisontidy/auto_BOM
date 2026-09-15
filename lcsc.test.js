import test from "node:test";
import assert from "node:assert/strict";
import { normalizeJlcpcbProduct, searchJlcpcb } from "./services/lcsc.js";
import { completeSchematicBom } from "./services/bom-completion.js";
import { sourcingSupplier } from "./services/sourcing.js";

const raw = (changes = {}) => ({
  componentCode: "C123", componentModelEn: "R-10K", componentBrandEn: "Example",
  stockCount: 100, minPurchaseNum: 1, componentLibraryType: "base", isBuyComponent: "1",
  componentSpecificationEn: "0805", describe: "10kΩ 0805 resistor",
  attributes: [{ attribute_name_en: "Resistance", attribute_value_name: "10kΩ" }],
  componentPrices: [{ startNumber: 1, endNumber: 9, productPrice: 0.02 }, { startNumber: 10, endNumber: -1, productPrice: 0.01 }],
  ...changes,
});
const response = (items) => async () => ({ ok: true, json: async () => ({ code: 200, data: { componentPageInfo: { list: items, total: items.length } } }) });
const component = { componentType: "Resistor", value: "10 kOhm", footprint: "0805", quantity: 10 };

test("JLC normalization uses JLC stock and the requested price tier, without DigiKey fields", () => {
  const part = normalizeJlcpcbProduct(raw({ canPresaleNumber: 100000 }), 10);
  assert.equal(part.unitPrice, 0.01);
  assert.equal(part.currency, "USD");
  assert.equal(part.quantityAvailable, 100);
  assert.equal(part.lcscPartNumber, "C123");
  assert.equal(part.digiKeyPartNumber, undefined);
  assert.equal(part.libraryType, "Basic");
  assert.equal(normalizeJlcpcbProduct(raw({ stockCount: null })).quantityAvailable, 0);
  assert.equal(normalizeJlcpcbProduct(raw({ componentPrices: [] })).unitPrice, null);
});

test("JLC search rejects insufficient stock, MOQ, wrong value/package and unavailable parts", async () => {
  const items = [raw(), raw({ componentCode: "C124", stockCount: 9, canPresaleNumber: 10000 }),
    raw({ componentCode: "C125", minPurchaseNum: 20 }), raw({ componentCode: "C126", componentSpecificationEn: "0603" }),
    raw({ componentCode: "C127", attributes: [{ attribute_name_en: "Resistance", attribute_value_name: "1kΩ" }] }),
    raw({ componentCode: "C128", isBuyComponent: "0" })];
  const result = await searchJlcpcb(component, {}, response(items));
  assert.deepEqual(result.candidates.map((c) => c.lcscPartNumber), ["C123"]);
});

test("an exact C-number cannot match a similar C-number or MPN substring", async () => {
  const result = await searchJlcpcb({ supplierPartNumber: "C123", quantity: 1 }, {}, response([
    raw({ componentCode: "C1230" }), raw(), raw({ componentCode: "C124", componentModelEn: "C123ABC" }),
    raw({ componentCode: "C125", componentModelEn: "C123" }),
  ]));
  assert.deepEqual(result.candidates.map((c) => c.lcscPartNumber), ["C123"]);
});

test("ordinary passive search does not accept a resistor array", async () => {
  const result = await searchJlcpcb({...component,footprint:'0603'}, {}, response([
    raw({componentSpecificationEn:'0603x4',describe:'10kΩ Resistor Networks, Arrays'}),
  ]));
  assert.equal(result.candidates.length,0);
});

test("catalog errors fail visibly; no credentials or alternate supplier used", async () => {
  await assert.rejects(searchJlcpcb(component, {}, async () => ({ ok: false, status: 403 })), /403/);
  await assert.rejects(searchJlcpcb(component, {}, async () => ({ ok: true, json: async () => ({ code: 200, data: {} }) })), /unexpected catalog response/);
  assert.equal(sourcingSupplier("lcsc"), "lcsc");
  assert.throws(() => sourcingSupplier("other"), /Supplier must/);
});

test("Basic catalog is searched before cheaper Extended parts, even for a two-part BOM", async () => {
  const calls = [];
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return response(body.componentLibraryType === "base" ? [raw({ leastPatchNumber: 20 })]
      : [raw({ componentCode: "C999", componentLibraryType: "expand", componentPrices: [{ startNumber: 1, productPrice: 0.001 }] })])();
  };
  const search = part => searchJlcpcb(part, {}, fetcher);
  const bom = await completeSchematicBom([{ reference: "R1", value: "10k", footprint: "Resistor_SMD:R_0805_2012Metric" },
    { reference: "R2", value: "10k", footprint: "Resistor_SMD:R_0805_2012Metric" }], { SOURCING_SUPPLIER: "lcsc" },
    { searchSupplier: search, resolveKiCadAssets: async () => ({}) });
  assert.equal(bom.parts[0].lcscPartNumber, "C123");
  assert.equal(bom.parts[0].libraryType, "Basic");
  assert.equal(calls.length, 1);
  const noPreference = await searchJlcpcb({ ...component, preferBasic: false }, {}, fetcher);
  assert.equal(noPreference.candidates[0].lcscPartNumber, "C999");
});

test("Basic preference falls back to Extended when Basic stock is insufficient", async () => {
  const result = await searchJlcpcb(component, {}, async (_url, options) => {
    const body = JSON.parse(options.body);
    return response([raw(body.componentLibraryType === "base" ? { stockCount: 0 } : { componentLibraryType: "expand" })])();
  });
  assert.equal(result.candidates[0].libraryType, "Extended");
});

test("purchase minimum is distinct from JLC placement-related quantities", () => {
  assert.equal(normalizeJlcpcbProduct(raw({ minPurchaseNum: 1, leastPatchNumber: 20 })).minimumOrderQuantity, 1);
  assert.equal(normalizeJlcpcbProduct(raw({ minPurchaseNum: 100, leastPatchNumber: 1 })).minimumOrderQuantity, 100);
});

test("JLC's null-list empty Basic response falls back to the full catalog", async () => {
  const result = await searchJlcpcb(component, {}, async (_url, options) => {
    if (JSON.parse(options.body).componentLibraryType === "base") return { ok: true, json: async () => ({ code:200, data:{componentPageInfo:{total:0,list:null}} }) };
    return response([raw({componentLibraryType:'expand'})])();
  });
  assert.equal(result.candidates[0].libraryType,'Extended');
});

const assetStub = async () => ({ footprintId: "Resistor_SMD:R_0805_2012Metric" });
test("LCSC BOM fills an LCSC field without treating an existing DigiKey number as LCSC", async () => {
  const result = await completeSchematicBom([
    { reference: "R1", value: "10k", footprint: "Resistor_SMD:R_0805_2012Metric", digiKeyPartNumber: "OLD-ND" },
  ], { SOURCING_SUPPLIER: "lcsc" }, {
    searchSupplier: async () => ({ candidates: [normalizeJlcpcbProduct(raw())] }), resolveKiCadAssets: assetStub,
  });
  assert.equal(result.failed, 0);
  assert.equal(result.parts[0].lcscPartNumber, "C123");
  assert.equal(result.parts[0].digiKeyPartNumber, undefined);
  assert.equal(result.parts[0].supplier, "lcsc");
});

test("existing LCSC selections are rechecked and stay unresolved when JLC stock is insufficient", async () => {
  let calls = 0;
  const result = await completeSchematicBom([
    { reference: "R1", value: "10k", lcscPartNumber: "C123", manufacturerPartNumber: "R-10K" },
  ], { SOURCING_SUPPLIER: "lcsc" }, {
    searchSupplier: async (part) => { calls++; assert.equal(part.supplierPartNumber, "C123"); return { candidates: [] }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.parts[0].lcscPartNumber, "C123");
});

test("LCSC enrichment refuses an MPN conflict and never overwrites the existing selection", async () => {
  const result = await completeSchematicBom([
    { reference: "R1", value: "10k", lcscPartNumber: "C123", manufacturerPartNumber: "KEEP-MPN" },
  ], { SOURCING_SUPPLIER: "lcsc" }, {
    searchSupplier: async () => ({ candidates: [normalizeJlcpcbProduct(raw())] }), resolveKiCadAssets: assetStub,
  });
  assert.equal(result.failed, 1);
  assert.equal(result.parts[0].manufacturerPartNumber, "KEEP-MPN");
  assert.match(result.parts[0].error, /does not match/);
});
