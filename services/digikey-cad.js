import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, writeFile, rm, rmdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {homedir, tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseSexpr} from './easyeda.js';
import {snapMagic} from './snapmagic.js';

const execute = promisify(execFile);
const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const children = (node, tag) => node.filter(x => Array.isArray(x) && x[0] === tag);
const descendants = (node, tag) => node.flatMap(x => Array.isArray(x) ? [...(x[0] === tag ? [x] : []), ...descendants(x, tag)] : []);
const active = new Map();

export function prepareDigiKeyCad(entries, candidate, libraryName) {
  const symbols = entries.filter(e => /\.kicad_sym$/i.test(e.name));
  const footprints = entries.filter(e => /\.kicad_mod$/i.test(e.name));
  if (symbols.length !== 1 || footprints.length !== 1) throw new Error('Expected one KiCad symbol library and footprint');
  const library = parseSexpr(symbols[0].text), footprint = parseSexpr(footprints[0].text);
  const definitions = children(library, 'symbol');
  if (library[0] !== 'kicad_symbol_lib' || footprint[0] !== 'footprint' || definitions.length !== 1) throw new Error('Unsupported CAD library structure');
  const symbol = definitions[0], properties = children(symbol, 'property');
  const expected = normalize(candidate.manufacturerPartNumber);
  if (!expected || normalize(symbol[1]) !== expected || normalize(properties.find(p => p[1] === 'Value')?.[2]) !== expected)
    throw new Error('Downloaded model does not match the selected manufacturer part number');
  if (children(symbol, 'extends').length) throw new Error('Model requires another symbol library');
  if (![symbol[1], footprint[1]].every(name => typeof name === 'string' && name.length && !/[\\/:\x00-\x1f]/.test(name))) throw new Error('Invalid CAD item name');
  const link = properties.find(p => p[1] === 'Footprint');
  if (!link || String(link[2]).split(':').at(-1) !== footprint[1]) throw new Error('Symbol and footprint are not linked');
  const pins = descendants(symbol, 'pin');
  const pinMap = Object.fromEntries(pins.map(pin => [children(pin, 'number')[0]?.[1], children(pin, 'name')[0]?.[1] || '']));
  if (!pins.length || Object.keys(pinMap).some(n => !n || n === 'undefined')) throw new Error('Missing symbol pin numbers');
  const pads = children(footprint, 'pad');
  const electrical = new Set(pads.filter(p => p[2] !== 'np_thru_hole').map(p => p[1]));
  if (electrical.size !== Object.keys(pinMap).length || [...electrical].some(n => !Object.hasOwn(pinMap, n))) throw new Error('Symbol pins do not match electrical footprint pads');
  const positions = new Map();
  for (const pad of pads) {
    const at = children(pad, 'at')[0], size = children(pad, 'size')[0];
    if (!at || !size || ![at[1], at[2], size[1], size[2]].every(v => v !== undefined && Number.isFinite(Number(v))) || Number(size[1]) <= 0 || Number(size[2]) <= 0) throw new Error('Invalid pad geometry');
    if (pad[2] === 'np_thru_hole') { pad[1] = ''; continue; }
    const position = `${Number(at[1])},${Number(at[2])}`;
    if (positions.has(position) && positions.get(position) !== pad[1]) throw new Error('Different electrical pads overlap');
    positions.set(position, pad[1]);
  }
  const count = String(candidate.parameters?.['Number of Pins'] || candidate.parameters?.['Pin Count'] || '').match(/^(\d+)\s*(?:pins?)?$/i);
  if (count && Number(count[1]) !== electrical.size) throw new Error('CAD pin count disagrees with catalog');
  link[2] = `${libraryName}:${footprint[1]}`;
  // External model paths are not portable. This importer handles symbol/footprint pairs only.
  if (children(footprint, 'model').length) throw new Error('ZIP model references require a separate 3D import');
  const symbolText = symbols[0].text.replace(/(\(property\s+"Footprint"\s+)"(?:\\.|[^"\\])*"/, (_, prefix) => prefix + JSON.stringify(link[2]));
  const footprintText = footprints[0].text.replace(/(\(pad\s+)(?:"(?:\\.|[^"\\])*"|[^\s()]+)(\s+np_thru_hole\b)/g, '$1""$2');
  return {symbolText, footprintText, footprintName: footprint[1],
    symbolId: `${libraryName}:${symbol[1]}`, footprintId: link[2], pinMap,
    pinCount: electrical.size, padCount: electrical.size,
    validation: {checked: ['Manufacturer part number matches selected part', 'Symbol pins match electrical pads', 'Pad geometry checked'], unknown: ['Datasheet pin functions and mechanical dimensions need review.']}};
}

export function importDigiKeyCad(candidate, environment = process.env) {
  const mpn = String(candidate.manufacturerPartNumber || '');
  if (!normalize(mpn)) return Promise.reject(new Error('Manufacturer part number is required'));
  const key = createHash('sha256').update(`${candidate.manufacturer || ''}\0${mpn}`).digest('hex').slice(0, 24);
  const root = resolve(environment.DIGIKEY_CAD_LIBRARY_DIR || join(environment.LOCALAPPDATA || homedir(), 'autoBOM', 'digikey-cad-v1'));
  const taskKey = `${root}:${key}:${environment.SNAPMAGIC_REFRESH === 'true'}`;
  if (!active.has(taskKey)) {
    const task = loadOrImport(candidate, environment, root, key);
    active.set(taskKey, task);
    task.finally(() => active.delete(taskKey)).catch(() => {});
  }
  return active.get(taskKey);
}

async function loadOrImport(candidate, environment, root, key) {
  const directory = join(root, key), libraryName = `AutoBOM_DK_${key}`;
  let entries;
  try { if (environment.SNAPMAGIC_REFRESH !== 'true') entries = JSON.parse(await readFile(join(directory, 'source.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!entries) {
    if (environment.EASYEDA_CACHE_ONLY === 'true') throw new Error('No cached DigiKey CAD');
    const downloads = environment.DIGIKEY_CAD_DOWNLOAD_DIR || join(homedir(), 'Downloads');
    const names = environment.SNAPMAGIC_REFRESH === 'true' ? [] : (await readdir(downloads).catch(error => {if(error.code === 'ENOENT')return []; throw error;})).filter(name => /\.zip$/i.test(name) && normalize(name.replace(/(?: \(\d+\))?\.zip$/i, '')) === normalize(candidate.manufacturerPartNumber));
    for (const name of names.reverse()) {
      try {
        const {stdout} = await execute('powershell.exe', ['-NoProfile', '-File', fileURLToPath(new URL('../scripts/read-cad-zip.ps1', import.meta.url)), '-ArchivePath', join(downloads, name)], {windowsHide: true, timeout: 15000, maxBuffer: 12_000_000});
        const proposed = JSON.parse(stdout);
        prepareDigiKeyCad(proposed, candidate, libraryName);
        entries = proposed; break;
      } catch { /* A stale/wrong ZIP must not prevent a fresh provider download. */ }
    }
    if (!entries) {
      const zip = await snapMagic.download(candidate);
      const staging = await mkdtemp(join(tmpdir(), 'autobom-snapmagic-'));
      const archive = join(staging, 'model.zip');
      try {
        await writeFile(archive, zip);
        const {stdout} = await execute('powershell.exe', ['-NoProfile', '-File', fileURLToPath(new URL('../scripts/read-cad-zip.ps1', import.meta.url)), '-ArchivePath', archive], {windowsHide:true,timeout:15000,maxBuffer:12_000_000});
        entries = JSON.parse(stdout);
        prepareDigiKeyCad(entries, candidate, libraryName);
      } finally {await rm(archive,{force:true}); await rmdir(staging);}
    }
  }
  const prepared = prepareDigiKeyCad(entries, candidate, libraryName);
  const symbolLibraryPath = join(directory, `${libraryName}.kicad_sym`);
  const footprintLibraryPath = join(directory, `${libraryName}.pretty`);
  await mkdir(footprintLibraryPath, {recursive: true});
  await writeFile(symbolLibraryPath, prepared.symbolText);
  await writeFile(join(footprintLibraryPath, `${prepared.footprintName}.kicad_mod`), prepared.footprintText);
  await writeFile(join(directory, 'source.json'), JSON.stringify(entries));
  for (const entry of entries.filter(e => /(^|\/)License\.txt$/i.test(e.name))) await writeFile(join(directory, 'License.txt'), entry.text);
  const {symbolText, footprintText, footprintName, ...assets} = prepared;
  return {...assets, libraryName, symbolLibraryPath, footprintLibraryPath, exactSymbol: true, imported: true, placeable: true,
    modelExpected: false, symbolSource: 'DigiKey / SnapMagic ZIP', footprintSource: 'DigiKey / SnapMagic ZIP'};
}
