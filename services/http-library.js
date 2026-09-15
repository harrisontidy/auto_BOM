import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createHttpLibrary(file) {
  let queue = Promise.resolve();
  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  return {
    record(result) {
      const task = queue.then(async () => {
        const saved = new Map((await read()).map(part => [part.id, part]));
        for (const candidate of result.candidates || []) {
          const assets = candidate.kicadAssets;
          // Imported libraries need separate registration in stock KiCad.
          if (!assets?.placeable || assets.imported || !assets.symbolId || !assets.footprintId) continue;
          const number = candidate.supplierPartNumber || candidate.lcscPartNumber || candidate.digiKeyPartNumber;
          if (!number || !['lcsc', 'digikey'].includes(candidate.supplier)) continue;
          const id = `${candidate.supplier}-${number}`;
          const field = value => ({ value: String(value ?? ''), visible: 'false' });
          const part = {
            id, name: candidate.manufacturerPartNumber || number,
            category: candidate.supplier, symbolIdStr: assets.symbolId,
            description: String(candidate.description || ''),
            exclude_from_sim: 'true',
            fields: {
              value: {value: String(result.component?.value || candidate.manufacturerPartNumber || number)},
              footprint: field(assets.footprintId), datasheet: field(candidate.datasheetUrl),
              'Manufacturer Part Number': field(candidate.manufacturerPartNumber),
              Manufacturer: field(candidate.manufacturer),
              [candidate.supplier === 'lcsc' ? 'LCSC Part #' : 'DigiKey Part Number']: field(number),
              'Library type at lookup': field(candidate.libraryType),
              'Stock at lookup': field(candidate.stock),
              'Catalog checked at': field(new Date().toISOString()),
              'CAD source': field(assets.symbolSource),
              'Selection review': field('Search result, not an approved circuit match. Verify ratings and pin mapping.'),
            },
          };
          saved.delete(id);
          saved.set(id, part);
        }
        await mkdir(dirname(file), {recursive: true});
        await writeFile(`${file}.tmp`, JSON.stringify([...saved.values()].slice(-500), null, 2));
        await rename(`${file}.tmp`, file);
      });
      queue = task.catch(() => {});
      return task;
    },
    async get(path) {
      await queue;
      if (path === '/') return {categories: '', parts: ''};
      const parts = await read();
      if (path === '/categories.json') return [...new Set(parts.map(part => part.category))]
        .map(id => ({id, name: id === 'lcsc' ? 'Auto BOM / JLCPCB-LCSC' : 'Auto BOM / DigiKey'}));
      const category = path.match(/^\/parts\/category\/([^/]+)\.json$/);
      if (category) return parts.filter(part => part.category === decodeURIComponent(category[1]))
        .map(({id, name, description}) => ({id, name, description}));
      const item = path.match(/^\/parts\/([^/]+)\.json$/);
      if (item) {
        const part = parts.find(part => part.id === decodeURIComponent(item[1]));
        if (part) { const {category: _, ...detail} = part; return detail; }
      }
      return null;
    },
  };
}
