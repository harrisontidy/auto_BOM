import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Bourns 78F series drawing: 7.11 mm maximum body length, 2.79 mm
// maximum diameter, 0.51 mm leads. The axial leads are formed to 10.16 mm.
// Source: https://www.bourns.com/docs/Product-Datasheets/78f_series.pdf
export async function documentedAxialAssets(candidate, symbolDirectory, environment) {
  if(!/^78F[0-9R]+[JK](?:-TR)?-RC$/i.test(candidate.manufacturerPartNumber||'') || !/Bourns/i.test(candidate.manufacturer||''))return null;
  if(!/axial/i.test(candidate.parameters?.['Package / Case']||''))return null;
  const key=createHash('sha256').update('documented-78f-v1:'+candidate.manufacturerPartNumber).digest('hex').slice(0,24);
  const libraryName='AutoBOM_DK_'+key;
  const directory=join(environment.LOCALAPPDATA,'autoBOM','documented-cad',key);
  const symbolLibraryPath=join(directory,libraryName+'.kicad_sym'),footprintLibraryPath=join(directory,libraryName+'.pretty');
  const footprintName='L_Axial_L7.11mm_D2.79mm_P10.16mm';
  const text=await readFile(join(symbolDirectory,'Device.kicad_sym'),'utf8');
  const start=text.indexOf('\t(symbol "L"'),end=text.indexOf('\n\t(symbol ',start+1);
  if(start<0||end<0)throw Error('Installed inductor symbol unavailable');
  let symbol=text.slice(start,end).replaceAll('"L"','"'+candidate.manufacturerPartNumber+'"').replaceAll('"L_','"'+candidate.manufacturerPartNumber+'_');
  symbol=symbol.replace(/(\(property\s+"Footprint"\s+)"[^"]*"/, '$1"'+libraryName+':'+footprintName+'"');
  const footprint=`(footprint "${footprintName}" (version 20241229) (generator "autobom") (layer "F.Cu")
    (descr "Bourns 78F datasheet dimensions; form leads to 10.16mm pitch") (attr through_hole)
    (fp_text reference "REF**" (at 5.08 -2.5) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value "${footprintName}" (at 5.08 2.5) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start 1.525 -1.395) (end 8.635 1.395) (stroke (width 0.1) (type default)) (fill none) (layer "F.Fab"))
    (fp_rect (start 1.425 -1.495) (end 8.735 1.495) (stroke (width 0.12) (type default)) (fill none) (layer "F.SilkS"))
    (fp_line (start 0 -0) (end 1.525 0) (stroke (width 0.1) (type default)) (layer "F.Fab"))
    (fp_line (start 8.635 0) (end 10.16 0) (stroke (width 0.1) (type default)) (layer "F.Fab"))
    (fp_rect (start -1.1 -1.7) (end 11.26 1.7) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 0.9) (layers "*.Cu" "*.Mask"))
    (pad "2" thru_hole circle (at 10.16 0) (size 1.7 1.7) (drill 0.9) (layers "*.Cu" "*.Mask")))`;
  await mkdir(footprintLibraryPath,{recursive:true});
  await writeFile(symbolLibraryPath,`(kicad_symbol_lib (version 20241209) (generator "autobom") ${symbol})`);
  await writeFile(join(footprintLibraryPath,footprintName+'.kicad_mod'),footprint);
  return {libraryName,symbolLibraryPath,footprintLibraryPath,symbolId:libraryName+':'+candidate.manufacturerPartNumber,
    footprintId:libraryName+':'+footprintName,imported:true,placeable:true,exactSymbol:false,pinMap:{1:'~',2:'~'},pinCount:2,padCount:2,
    symbolSource:'KiCad standard inductor',footprintSource:'Bourns 78F datasheet dimensions; leads formed to 10.16 mm',modelExpected:false,
    validation:{checked:['Bourns 78F body and lead dimensions','Two electrical pads match the standard inductor pins'],unknown:['Form axial leads to the 10.16 mm board pitch.']}};
}
