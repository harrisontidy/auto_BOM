import { searchDigiKey } from "./digikey.js";
import { searchJlcpcb } from "./lcsc.js";

export function sourcingSupplier(value = process.env.SOURCING_SUPPLIER || "lcsc") {
  if (!["lcsc", "digikey"].includes(value)) throw new Error("Supplier must be lcsc or digikey.");
  return value;
}

export function supplierLabel(supplier) { return supplier === "lcsc" ? "JLCPCB / LCSC" : "DigiKey"; }
export function supplierField(supplier) { return supplier === "lcsc" ? "lcscPartNumber" : "digiKeyPartNumber"; }
export function candidatePartNumber(candidate) { return candidate.supplierPartNumber || candidate.lcscPartNumber || candidate.digiKeyPartNumber || ""; }

export async function searchSupplier(component, environment = process.env) {
  const supplier = sourcingSupplier(environment.SOURCING_SUPPLIER || "lcsc");
  const result = supplier === "lcsc" ? await searchJlcpcb(component, environment) : await searchDigiKey(component, environment);
  return { ...result, supplier, candidates: result.candidates.map((candidate) => ({
    ...candidate, supplier, supplierPartNumber: candidatePartNumber(candidate),
  })) };
}
