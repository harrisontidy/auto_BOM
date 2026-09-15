import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const active = new Map();
const unavailable = new Map();
let queue = Promise.resolve();
let nextDownloadAt = 0;
let cooldownUntil = 0;

// A strict, small S-expression reader for validating generated library data, not executing it.
export function parseSexpr(text) {
  const root = [], stack = [root];
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) { index++; continue; }
    if (text[index] === '(') { const list = []; stack.at(-1).push(list); stack.push(list); index++; continue; }
    if (text[index] === ')') { if (stack.length === 1) throw new Error('Unbalanced library data'); stack.pop(); index++; continue; }
    if (text[index] === '"') {
      let token = '', closed = false; index++;
      while (index < text.length) {
        const c = text[index++];
        if (c === '"') { closed = true; break; }
        if (c === '\\') { if (index >= text.length) break; token += text[index++]; }
        else token += c;
      }
      if (!closed) throw new Error('Unterminated library string');
      stack.at(-1).push(token); continue;
    }
    const start = index;
    while (index < text.length && !/[\s()"]/.test(text[index])) index++;
    stack.at(-1).push(text.slice(start, index));
  }
  if (stack.length !== 1 || root.length !== 1) throw new Error('Invalid library structure');
  return root[0];
}
const children = (node, tag) => node.filter(x => Array.isArray(x) && x[0] === tag);
function descendants(node, tag) {
  return node.flatMap(x => Array.isArray(x) ? [...(x[0] === tag ? [x] : []), ...descendants(x, tag)] : []);
}
const identifier = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function validateConvertedAssets(symbolText, footprintText, candidate, libraryName) {
  const library = parseSexpr(symbolText), footprint = parseSexpr(footprintText);
  if (library[0] !== 'kicad_symbol_lib' || !['footprint', 'module'].includes(footprint[0])) throw new Error('Unsupported converted library format');
  const symbols = children(library, 'symbol');
  if (symbols.length !== 1) throw new Error('Expected one EasyEDA symbol');
  const symbol = symbols[0], properties = Object.fromEntries(children(symbol, 'property').map(x => [x[1], x[2]]));
  if (properties['LCSC Part'] !== candidate.lcscPartNumber) throw new Error('EasyEDA returned a different LCSC part');
  if (identifier(properties.MPN) !== identifier(candidate.manufacturerPartNumber)) throw new Error('EasyEDA manufacturer part number does not match the catalog');
  const footprintName = String(footprint[1]).split(':').at(-1);
  const footprintId = `${libraryName}:${footprintName}`;
  if (properties.Footprint !== footprintId) throw new Error('Downloaded symbol and footprint are not linked');
  if (![symbol[1], footprintName].every(x => typeof x === 'string' && x.length && !/[\\/:\x00-\x1f]/.test(x))) throw new Error('Invalid library item name');
  const pins = new Set(descendants(symbol, 'pin').map(x => children(x, 'number')[0]?.[1]).filter(Boolean));
  const pads = new Set(children(footprint, 'pad').map(x => x[1]).filter(Boolean));
  if (!pins.size || !pads.size || [...pins].some(x => !pads.has(x)) || [...pads].some(x => !pins.has(x))) throw new Error('Downloaded symbol pin numbers do not match footprint pads');
  const checked=['Catalog identity and linked symbol/footprint','Symbol pin numbers match electrical footprint pads'];
  const unknown=['Pin functions and datasheet pin mapping require review.'];
  const locations=new Map();
  for(const pad of children(footprint,'pad')) {
    const size=children(pad,'size')[0],at=children(pad,'at')[0];
    if(!size || !at)throw new Error('Footprint pad geometry is missing');
    if(![size[1],size[2],at[1],at[2]].every(value=>value!==undefined&&Number.isFinite(Number(value)))
      || Number(size[1])<=0 || Number(size[2])<=0)throw new Error('Invalid footprint pad geometry');
    const key=`${Number(at[1])},${Number(at[2])}`;
    if(pad[1] && locations.has(key) && locations.get(key)!==pad[1])throw new Error('Different electrical pads occupy the same position');
    if(pad[1])locations.set(key,pad[1]);
  }
  checked.push('Pad coordinates and positive pad dimensions');
  const pinAttribute=candidate.parameters?.['Number of Pins']||candidate.parameters?.['Pin Count'];
  const expected=String(pinAttribute||'').match(/^(\d+)\s*(?:P|pins?)?$/i);
  if(expected) {
    if(pins.size!==Number(expected[1]))throw new Error('Downloaded pin count does not match the supplier pin-count attribute');
    checked.push(`Supplier pin count: ${pins.size}`);
  } else unknown.push('Supplier pin count not available for independent comparison.');
  const body=String(candidate.packageType||candidate.parameters?.['Package / Case']||'').match(/\((\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\)/i);
  const points=[];
  for(const shape of footprint.filter(node=>Array.isArray(node)&&['fp_rect','fp_line'].includes(node[0]))) {
    if(children(shape,'layer')[0]?.[1]!=='F.Fab')continue;
    for(const tag of ['start','end']) {
      const point=children(shape,tag)[0];
      if(point && [point[1],point[2]].every(value=>Number.isFinite(Number(value))))points.push([Number(point[1]),Number(point[2])]);
    }
    if(shape[0]==='fp_rect' && points.length>=2) {
      const [start,end]=points.slice(-2);points.push([start[0],end[1]],[end[0],start[1]]);
    }
  }
  if(body && points.length>=4) {
    const actual=[0,1].map(axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]))).sort((a,b)=>a-b);
    const expectedSize=[Number(body[1]),Number(body[2])].sort((a,b)=>a-b);
    if(actual.some((value,i)=>Math.abs(value-expectedSize[i])>Math.max(0.35,expectedSize[i]*0.15)))
      throw new Error('Footprint fabrication outline disagrees with the catalog package dimensions');
    checked.push('Fabrication outline agrees with catalog body dimensions within 15% or 0.35 mm');
  } else unknown.push('Mechanical body dimensions need datasheet review.');
  return { symbolId: `${libraryName}:${symbol[1]}`, footprintId, pinCount: pins.size, padCount: pads.size,
    pinMap:Object.fromEntries(descendants(symbol,'pin').map(pin=>[children(pin,'number')[0]?.[1],children(pin,'name')[0]?.[1]||'']).filter(([number])=>number)),
    validation:{checked,unknown} };
}

export function importEasyEda(candidate, environment = process.env) {
  const id = String(candidate.lcscPartNumber || '').toUpperCase();
  if (!/^C\d{1,12}$/.test(id)) return Promise.reject(new Error('A valid LCSC C-number is required for EasyEDA'));
  const root = resolve(environment.EASYEDA_LIBRARY_DIR || join(environment.LOCALAPPDATA || projectRoot, 'autoBOM', 'easyeda-v1'));
  if (environment.EASYEDA_CACHE_ONLY === 'true') return loadAssets(join(root, id), { ...candidate, lcscPartNumber: id }, `AutoBOM_${id}`);
  const key = `${root}:${id}:${candidate.manufacturerPartNumber}`;
  const failure = unavailable.get(key);
  if (failure?.until > Date.now()) return Promise.reject(new Error(failure.message));
  unavailable.delete(key);
  if (!active.has(key)) {
    const task = queue.then(() => download({ ...candidate, lcscPartNumber: id }, environment, root));
    task.catch(error => {
      if (/no downloadable CAD data/.test(error.message)) {
        unavailable.set(key, { until: Date.now() + 60_000, message: error.message });
        if (unavailable.size > 200) unavailable.delete(unavailable.keys().next().value);
      }
    });
    queue = task.catch(() => {});
    active.set(key, task);
    task.finally(() => active.delete(key)).catch(() => {});
  }
  return active.get(key);
}

async function loadAssets(directory, candidate, libraryName) {
  const symbolLibraryPath = join(directory, `${libraryName}.kicad_sym`);
  const footprintLibraryPath = join(directory, `${libraryName}.pretty`);
  const files = (await readdir(footprintLibraryPath)).filter(x => x.endsWith('.kicad_mod'));
  if (files.length !== 1) throw new Error('Expected one downloaded footprint');
  const [symbolText, footprintText] = await Promise.all([readFile(symbolLibraryPath, 'utf8'), readFile(join(footprintLibraryPath, files[0]), 'utf8')]);
  const result = validateConvertedAssets(symbolText, footprintText, candidate, libraryName);
  if (basename(files[0], '.kicad_mod') !== result.footprintId.split(':')[1]) throw new Error('Footprint filename mismatch');
  return { ...result, libraryName, symbolLibraryPath, footprintLibraryPath, exactSymbol: true,
    symbolSource: 'EasyEDA download', footprintSource: 'EasyEDA download', imported: true,
    modelExpected: false, placeable: true };
}

async function download(candidate, environment, root) {
  const libraryName = `AutoBOM_${candidate.lcscPartNumber}`;
  const directory = join(root, candidate.lcscPartNumber);
  try { return { ...await loadAssets(directory, candidate, libraryName), cached: true }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (Date.now() < cooldownUntil) throw new Error('EasyEDA temporarily refused downloads. Cached libraries remain available; try again in a minute.');
  const python = environment.EASYEDA_PYTHON || join(projectRoot, '.runtime', 'easyeda', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  try { await stat(python); } catch { throw new Error('EasyEDA converter is not installed. Run Setup EasyEDA.ps1 once.'); }
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, `${candidate.lcscPartNumber}-download-`));
  try {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextDownloadAt - Date.now())));
    nextDownloadAt = Date.now() + 3000;
    await execute(python, ['-m', 'easyeda2kicad', '--symbol', '--footprint', '--lcsc_id', candidate.lcscPartNumber, '--output', join(staging, libraryName)],
      { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true, cwd: staging });
    await loadAssets(staging, candidate, libraryName);
    await rename(staging, directory);
    return { ...await loadAssets(directory, candidate, libraryName), cached: false };
  } catch (error) {
    const details = `${error.stderr || ''} ${error.message || ''}`;
    if (/403|429|Forbidden|Too Many Requests/i.test(details)) {
      cooldownUntil = Date.now() + 60_000;
      throw new Error('EasyEDA temporarily refused downloads (403/429). Downloads paused for one minute; cached libraries remain available.');
    }
    if (/Failed to fetch data/i.test(details)) throw new Error(`EasyEDA has no downloadable CAD data for ${candidate.lcscPartNumber} at present.`);
    throw error;
  } finally {
    // staging is a direct, uniquely created child of our dedicated library directory.
    if (dirname(resolve(staging)) !== root) throw new Error('Invalid download staging directory');
    await rm(staging, { recursive: true, force: true });
  }
}
