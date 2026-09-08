import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const symbolIndexPromises = new Map();

export async function resolveKiCadAssets(component, candidate, environment = process.env) {
  const componentType = String(component.componentType || "").toLowerCase();
  const packageText = [component.package, component.footprint, candidate?.parameters?.["Package / Case"], candidate?.description].filter(Boolean).join(" ");
  const manufacturerPartNumber = candidate?.manufacturerPartNumber || "";
  const symbolDirectory = environment.KICAD10_SYMBOL_DIR
    || (environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "Programs", "KiCad", "10.0", "share", "kicad", "symbols") : "");
  const footprintDirectory = environment.KICAD10_FOOTPRINT_DIR
    || (environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "Programs", "KiCad", "10.0", "share", "kicad", "footprints") : "");
  const exactSymbol = await findExactSymbol(manufacturerPartNumber, symbolDirectory);
  const symbolId = exactSymbol?.symbolId || genericSymbol(componentType, packageText, component.pinCount);
  const footprintId = exactSymbol?.footprintId || footprintFor(componentType, packageText, component.pinCount);
  const modelExpected = await footprintHasModel(footprintId, footprintDirectory);
  return {
    symbolId,
    footprintId,
    symbolSource: exactSymbol ? "Exact KiCad library match" : symbolId ? "KiCad generic symbol" : "No safe symbol match",
    footprintSource: exactSymbol?.footprintId ? "Footprint from KiCad symbol library" : footprintId ? "Matched KiCad footprint" : "No safe footprint match",
    modelExpected,
    placeable: Boolean(symbolId && footprintId),
  };
}

async function footprintHasModel(footprintId, directory) {
  const [library, footprint] = String(footprintId || "").split(":");
  if (!library || !footprint || !directory) return false;
  try {
    const content = await readFile(join(directory, `${library}.pretty`, `${footprint}.kicad_mod`), "utf8");
    return /^\s*\(model\s+/m.test(content);
  } catch {
    return false;
  }
}

export function genericSymbol(type, packageText = "", pinCount = 0) {
  type = String(type).toLowerCase();
  if (/resistor/.test(type)) return "Device:R";
  if (/capacitor/.test(type)) return /polar|electrolytic|radial/.test(packageText.toLowerCase()) ? "Device:C_Polarized" : "Device:C";
  if (/inductor|choke/.test(type)) return "Device:L";
  if (/fuse/.test(type)) return "Device:Fuse";
  if (/led/.test(type)) return "Device:LED";
  if (/diode/.test(type)) return "Device:D";
  if (/crystal/.test(type)) return "Device:Crystal";
  if (/connector|header/.test(type) && pinCount > 0 && pinCount <= 40) return `Connector_Generic:Conn_01x${String(pinCount).padStart(2, "0")}`;
  return "";
}

export function footprintFor(type, packageText = "", pinCount = 0) {
  type = String(type).toLowerCase();
  const text = packageText.toLowerCase().replaceAll("-", "").replaceAll("_", "");
  const metric = text.match(/\b(0201|0402|0603|0805|1206|1210)\b/)?.[1];
  const dimensions = { "0201": "0603Metric", "0402": "1005Metric", "0603": "1608Metric", "0805": "2012Metric", "1206": "3216Metric", "1210": "3225Metric" };
  if (metric && /resistor/.test(type)) return `Resistor_SMD:R_${metric}_${dimensions[metric]}`;
  if (metric && /capacitor/.test(type)) return `Capacitor_SMD:C_${metric}_${dimensions[metric]}`;
  if (metric && /inductor|choke/.test(type)) return `Inductor_SMD:L_${metric}_${dimensions[metric]}`;
  if (/\bsma\b/.test(text)) return "Diode_SMD:D_SMA";
  if (/\bsmb\b/.test(text)) return "Diode_SMD:D_SMB";
  if (/soic8|so8/.test(text)) return "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm";
  if (/sot23(?!\d)/.test(text)) return "Package_TO_SOT_SMD:SOT-23";
  if (/connector|header/.test(type) && pinCount > 0) return `Connector_PinHeader_2.54mm:PinHeader_1x${String(pinCount).padStart(2, "0")}_P2.54mm_Vertical`;
  return "";
}

async function findExactSymbol(partNumber, symbolDirectory) {
  if (!partNumber || !symbolDirectory) return "";
  const index = await getSymbolIndex(symbolDirectory);
  for (const key of partNumberKeys(partNumber)) {
    if (index.has(key)) return index.get(key);
  }
  return "";
}

function partNumberKeys(value) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const keys = [normalized];
  for (const suffix of ["TR", "CT", "DKR", "13", "EL"]) if (normalized.endsWith(suffix)) keys.push(normalized.slice(0, -suffix.length));
  return [...new Set(keys.filter((key) => key.length >= 3))];
}

async function getSymbolIndex(directory) {
  if (!symbolIndexPromises.has(directory)) symbolIndexPromises.set(directory, buildSymbolIndex(directory).catch(() => new Map()));
  return symbolIndexPromises.get(directory);
}

async function buildSymbolIndex(directory) {
  const index = new Map();
  const files = (await readdir(directory)).filter((name) => name.endsWith(".kicad_sym"));
  await Promise.all(files.map(async (file) => {
    const content = await readFile(join(directory, file), "utf8");
    const library = basename(file, ".kicad_sym");
    const matches = [...content.matchAll(/^\t\(symbol\s+"([^"/]+)"/gm)];
    for (let indexPosition = 0; indexPosition < matches.length; indexPosition += 1) {
      const match = matches[indexPosition];
      const name = match[1];
      const block = content.slice(match.index, matches[indexPosition + 1]?.index ?? content.length);
      const footprintId = block.match(/^\t\t\(property\s+"Footprint"\s+"([^"]*)"/m)?.[1] || "";
      index.set(name.toUpperCase().replace(/[^A-Z0-9]/g, ""), { symbolId: `${library}:${name}`, footprintId });
    }
  }));
  return index;
}
