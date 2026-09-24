import { documentedAxialAssets } from './documented-passive-cad.js';
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { importEasyEda, parseSexpr } from "./easyeda.js";
import { importDigiKeyCad } from './digikey-cad.js';
import { assessSchematicPins } from './specification-checks.js';
import { planPinRemap, remapExternalFootprint } from './footprint-remap.js';

const symbolIndexPromises = new Map();

export async function resolveKiCadAssets(component, candidate, environment = process.env) {
  const assets=await resolveAssets(component,candidate,environment);
  const audit=assessSchematicPins(component.bomContext,assets);
  if (!audit.mismatches.length || candidate?.supplier!=='lcsc' || environment.EASYEDA_DOWNLOADS==='false') return assets;
  try {
    const external=assets.imported?assets:await importEasyEda(candidate,environment);
    if (!planPinRemap(component.bomContext,external.pinMap)) return assets;
    return await remapExternalFootprint(component.bomContext,external);
  } catch(error) { return {...assets,importError:`Footprint remapping unavailable: ${error.message}`}; }
}

async function resolveAssets(component, candidate, environment = process.env) {
  let importError = "";
  const componentType = String(component.componentType || "").toLowerCase();
  const packageText = [component.package, component.footprint, candidate?.parameters?.["Package / Case"], candidate?.parameters?.["Supplier Device Package"], candidate?.description].filter(Boolean).join(" ");
  const manufacturerPartNumber = candidate?.manufacturerPartNumber || "";
  const symbolDirectory = environment.KICAD10_SYMBOL_DIR
    || (environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "Programs", "KiCad", "10.0", "share", "kicad", "symbols") : "");
  const footprintDirectory = environment.KICAD10_FOOTPRINT_DIR
    || (environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "Programs", "KiCad", "10.0", "share", "kicad", "footprints") : "");
  // Standard two-terminal passives do not need an index of every installed IC library.
  const standardPassive = /^(resistor|capacitor|inductor)$/.test(componentType)
    && /(?:^|[^0-9])(0201|0402|0603|0805|1206|1210)(?:[^0-9]|$)/.test(packageText)
    && !/array|network|variable|trimmer|polar|electrolytic/i.test(packageText);
  const exactSymbol = standardPassive ? null : await findExactSymbol(manufacturerPartNumber, symbolDirectory, packageText);
  const symbolId = exactSymbol?.symbolId || genericSymbol(componentType, packageText, component.pinCount);
  const footprintId = exactSymbol?.footprintId || dimensionFootprint(componentType,candidate) || footprintFor(componentType, packageText, component.pinCount);
  const modelExpected = await footprintHasModel(footprintId, footprintDirectory);
  const localAssets = {
    symbolId,
    footprintId,
    exactSymbol: Boolean(exactSymbol),
    symbolSource: exactSymbol ? "Exact KiCad library match" : symbolId ? "KiCad generic symbol" : "No safe symbol match",
    footprintSource: exactSymbol?.footprintId ? "Footprint from KiCad symbol library" : footprintId ? "Matched KiCad footprint" : "No safe footprint match",
    modelExpected,
    placeable: Boolean(symbolId && footprintId && (!dimensionFootprint(componentType,candidate) || await installedFootprint(footprintId,footprintDirectory))),
    importError,
    ...((component.bomContext?.length || component.applicationCircuit) ? {pinMap:standardPassive?{'1':'~','2':'~'}:await installedPinMap(symbolId,symbolDirectory)} : {}),
  };
  if (localAssets.placeable) return localAssets;
  if (candidate?.supplier === 'digikey') {
    const documented=await documentedAxialAssets(candidate,symbolDirectory,environment);
    if(documented)return documented;
    try { return await importDigiKeyCad(candidate, environment); }
    catch (error) { localAssets.importError = `DigiKey CAD: ${error.message}`; }
  }
  if (candidate?.supplier === "lcsc" && candidate.lcscPartNumber && environment.EASYEDA_DOWNLOADS !== "false") {
    try { return await importEasyEda(candidate, environment); }
    catch (error) { localAssets.importError = `EasyEDA import unavailable: ${error.message}`; }
  }
  return localAssets;
}

const pinLibraries=new Map();
async function installedPinMap(symbolId,directory) {
  const [library,name]=String(symbolId||'').split(':');
  if(!library || !name || !directory)return null;
  const file=join(directory,`${library}.kicad_sym`);
  if(!pinLibraries.has(file))pinLibraries.set(file,readFile(file,'utf8').then(text=>{
    const tree=parseSexpr(text);return new Map(tree.filter(node=>Array.isArray(node)&&node[0]==='symbol').map(node=>[node[1],node]));
  }).catch(()=>null));
  const definitions=await pinLibraries.get(file);
  if(!definitions)return null;
  const children=(node,tag)=>node.filter(item=>Array.isArray(item)&&item[0]===tag);
  const collect=(node)=>node.flatMap(item=>Array.isArray(item)?[...(item[0]==='pin'?[item]:[]),...collect(item)]:[]);
  const seen=new Set();
  function resolve(name) {
    if(seen.has(name))return {};seen.add(name);
    const node=definitions.get(name);if(!node)return {};
    const parent=children(node,'extends')[0]?.[1];
    return {...(parent?resolve(parent):{}),...Object.fromEntries(collect(node).map(pin=>[children(pin,'number')[0]?.[1],children(pin,'name')[0]?.[1]||'']).filter(([number])=>number))};
  }
  const pins=resolve(name);return Object.keys(pins).length?pins:null;
}

async function installedFootprint(id,directory) {
  const [library,name]=String(id).split(':');
  try { await readFile(join(directory,library+'.pretty',name+'.kicad_mod'));return true; } catch { return false; }
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
  if (isSafeGenericPinHeader(type, packageText, pinCount)) return `Connector_Generic:Conn_01x${String(pinCount).padStart(2, "0")}`;
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
  if (/16soic|soic16/.test(text) && /3[.]9|0[.]154/.test(text)) return "Package_SO:SOIC-16_3.9x9.9mm_P1.27mm";
  if (/sot235|sot753/.test(text)) return "Package_TO_SOT_SMD:SOT-23-5";
  if (/8soic|soic8|so8/.test(text)) return "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm";
  if (/sot23(?!\d)/.test(text)) return "Package_TO_SOT_SMD:SOT-23";
  if (isSafeGenericPinHeader(type, packageText, pinCount)) return `Connector_PinHeader_2.54mm:PinHeader_1x${String(pinCount).padStart(2, "0")}_P2.54mm_Vertical`;
  return "";
}

async function findExactSymbol(partNumber, symbolDirectory, packageText = "") {
  if (!partNumber || !symbolDirectory) return "";
  const index = await getSymbolIndex(symbolDirectory);
  for (const key of [...partNumberKeys(partNumber),...packageSymbolKeys(partNumber,packageText)]) {
    if (index.has(key)) return index.get(key);
  }
  return "";
}

// Package-qualified aliases cover library naming conventions, never a fuzzy IC prefix.
export function packageSymbolKeys(partNumber,packageText) {
  const n=partNumber.toUpperCase(),p=packageText.toUpperCase().replaceAll('-','');
  if(/^MCP\d+T?-[IE]\/(SN|SO|ST|MS|MC|P)$/.test(n))return [n.replace(/T?-[IE]\//,'X').replace(/[^A-Z0-9]/g,'')];
  if(/^LM317T$/.test(n)&&/TO220/.test(p))return ['LM317TO220'];
  if(/^LMV321IDBVR?$/.test(n)&&/SOT235|SOT753/.test(p))return ['LMV321'];
  if(/^SN74HC595DR?$/.test(n)&&/(?:16SOIC|SOIC16)/.test(p))return ['74HC595'];
  if(/^MAX3485ESA\+?$/.test(n)&&/(?:8SOIC|SOIC8)/.test(p))return ['MAX3485'];
  return [];
}

export function dimensionFootprint(type,candidate) {
  const p=candidate?.parameters||{};
  if(/capacitor/i.test(type)&&/radial/i.test(p['Package / Case']||'')) {
    const diameter=String(p['Size / Dimension']||'').match(/\((\d+(?:\.\d+)?)mm\)/)?.[1];
    const pitch=String(p['Lead Spacing']||'').match(/\((\d+(?:\.\d+)?)mm\)/)?.[1];
    if(diameter&&pitch)return `Capacitor_THT:CP_Radial_D${Number(diameter).toFixed(1)}mm_P${Number(pitch).toFixed(2)}mm`;
  }
  return '';
}

function partNumberKeys(value) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const keys = [normalized];
  for (const suffix of ["TRPBF", "PBF", "DKR", "TR", "CT", "13", "EL", "R"])
    if (normalized.endsWith(suffix)) keys.push(normalized.slice(0, -suffix.length));
  return [...new Set(keys.filter((key) => key.length >= 3))];
}

function isSafeGenericPinHeader(type, packageText, pinCount) {
  const text = String(packageText || "").toLowerCase();
  return /connector|header/.test(String(type).toLowerCase())
    && pinCount > 0 && pinCount <= 40
    && /(?:pin\s*header|header)/.test(text)
    && /(?:2[.]54\s*mm|p2[.]54|[.]1\s*(?:in|inch|\"))/.test(text)
    && !/(?:right[ -]?angle|horizontal)/.test(text);
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
