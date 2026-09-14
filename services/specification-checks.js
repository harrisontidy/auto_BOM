// These checks use named supplier attributes; a number in marketing text is not evidence.
import {normalizeValue, inferComponentType} from '../parser.js';
export function assessSpecifications(component, candidate) {
  const sources=component.bomContext?.length?component.bomContext:[null];
  const reports=sources.map(source=>assessOne({...component,bomContext:source?[source]:undefined},candidate));
  return Object.fromEntries(['checked','unknown','mismatches','limitations'].map(key=>[key,[...new Set(reports.flatMap(report=>report[key]))]]));
}

function assessOne(component, candidate) {
  const checked=[], unknown=[], mismatches=[];
  const parameters=candidate.parameters||{};
  const source=component.bomContext?.[0];
  const text=[component.originalQuery, source?.value, ...(component.requirements||[])].filter(Boolean).join(' ');
  const sourceType=source?inferComponentType([source.reference],source.footprint):'';
  const type=String(sourceType||component.componentType||'').toLowerCase();
  const attribute=(...names)=>names.map(name=>parameters[name]).find(value=>value!=null && value!=='');
  if (component.passiveMounting) {
    const mountingText = [attribute('Mounting Type','Mounting Style'),candidate.packageType,candidate.description].filter(Boolean).join(' ');
    const throughHole = /through.?hole|\bTHT\b|\bDIP\b|axial|radial/i.test(mountingText);
    const smt = /surface.?mount|\bSMD\b|\bSMT\b|\b(?:0201|0402|0603|0805|1206|1210)\b/i.test(mountingText);
    if (!throughHole && !smt) unknown.push('Mounting: supplier mounting evidence missing.');
    else if (component.passiveMounting === 'smt' ? !smt || throughHole : !throughHole || smt)
      mismatches.push(`Mounting: ${component.passiveMounting} requested; catalog ${mountingText}.`);
    else checked.push(`Mounting: ${component.passiveMounting} confirmed by catalog.`);
  }
  if (component.capacitorTechnology === 'ceramic') {
    const technology = [candidate.description, ...Object.values(parameters)].filter(Boolean).join(' ');
    if (/electroly|tantal|polymer|film capacitor/i.test(technology)) mismatches.push('Capacitor technology: ceramic requested; catalog indicates another technology.');
    else if (/ceramic|MLCC|\b(?:X[578][RST]|C0G|NP0|Y5V|Z5U)\b/i.test(technology)) checked.push('Capacitor technology: ceramic catalog evidence.');
    else unknown.push('Capacitor technology: ceramic requested; catalog evidence missing.');
  }
  const verify=(name,requested,actual,accept)=>{
    if(requested==null)return;
    if(actual==null)unknown.push(`${name}: requested ${requested}; supplier attribute missing or unreadable.`);
    else (accept(actual)?checked:mismatches).push(`${name}: requested ${requested}; catalog ${actual}.`);
  };
  if(source && /^(resistor|capacitor|inductor)$/.test(type)) {
    const key={resistor:'Resistance',capacitor:'Capacitance',inductor:'Inductance'}[type];
    const raw=String(source.value||'').replace(/\s+/g,'');
    const value=type==='resistor'?raw.match(/^(?:\d+[RrKkM]\d+|\d+(?:\.\d+)?(?:[kKM]?(?:Ω|ohms?)|[RrKkM]))/i)?.[0] || (/^\d+(?:\.\d+)?$/.test(raw)?raw:null)
      :raw.match(type==='capacitor'?/^\d+(?:\.\d+)?[pnuµμm]?F/i:/^\d+(?:\.\d+)?[pnuµμm]?H/i)?.[0];
    const expected=value?normalizeValue(value,sourceType):null;
    if(expected)verify(key,expected,attribute(key),actual=>normalizeValue(String(actual).replace(/\s+/g,''),sourceType)===expected);
    else unknown.push(`${key}: schematic value is incomplete.`);
  }
  const numeric=value=>{
    const match=String(value??'').trim().match(/^[±+]?\s*(\d+(?:\.\d+)?)\s*(m|k)?\s*(?:[VW%])?$/i);
    return match?Number(match[1])*(match[2]==='m'?0.001:match[2]?.toLowerCase()==='k'?1000:1):null;
  };
  const tolerance=text.match(/(?:±\s*)?(\d+(?:\.\d+)?)\s*%/);
  if(tolerance && /resistor|capacitor|inductor/.test(type)) {
    const required=Number(tolerance[1]);
    verify('Tolerance',`${required}% maximum`,numeric(attribute('Tolerance','Resistance Tolerance','Capacitance Tolerance')),actual=>actual<=required);
  }
  const power=text.match(/\b(\d+(?:\.\d+)?)\s*(m?W)\b/i);
  const fraction=text.match(/\b(\d+)\s*\/\s*(\d+)\s*W\b/i);
  if((power||fraction)&&/resistor/.test(type)) {
    const required=fraction?Number(fraction[1])/Number(fraction[2]):Number(power[1])*(power[2].toLowerCase()==='mw'?0.001:1);
    const raw=attribute('Power(Watts)','Power','Power Rating','Rated Power');
    const ratio=String(raw??'').match(/^(\d+)\/(\d+)W$/);
    const actual=ratio?Number(ratio[1])/Number(ratio[2]):numeric(raw);
    verify('Power',`${required}W minimum`,actual,value=>value>=required);
  }
  const voltages=[...text.matchAll(/\b(\d+(?:\.\d+)?)\s*V\b/gi)];
  if(voltages.length && /capacitor|resistor|fuse/.test(type)) {
    const required=Math.max(...voltages.map(match=>Number(match[1])));
    verify('Voltage rating',`${required}V minimum`,numeric(attribute('Voltage - Rated','Rated Voltage','Voltage Rating','Operating Voltage','Voltage')),value=>value>=required);
  }
  const temperature=text.match(/(-?\d+)\s*(?:°?\s*C)?\s*(?:to|through|~|…)\s*\+?(\d+)\s*°?\s*C\b/i);
  if(temperature) {
    const raw=String(attribute('Operating Temperature','Operating Temperature Range')??'').replaceAll('℃','C');
    const range=raw.match(/(-?\d+)\s*°?C?\s*(?:~|to|\.\.|-)\s*\+?(-?\d+)\s*°?C?/);
    const low=Number(temperature[1]),high=Number(temperature[2]);
    verify('Temperature',`${low} to ${high} C`,range?`${range[1]} to ${range[2]} C`:null,
      ()=>Number(range[1])<=low && Number(range[2])>=high);
  }
  const interfaces=[...new Set([...text.matchAll(/\b(?:I2C|I²C|SPI|UART|I2S)\b/gi)]
    .filter(match=>!/(?:not|without|no)\s*$/i.test(text.slice(0,match.index))).map(match=>match[0].toUpperCase()))];
  const alternativeInterfaces=interfaces.length>1 && /\bor\b/i.test(text);
  if(alternativeInterfaces)unknown.push('Interface alternatives need review against the complete request.');
  for(const requested of interfaces) {
    if(alternativeInterfaces)break;
    const raw=attribute('Interface','Interface Type','Communication Interface');
    verify('Interface',requested,raw==null?null:String(raw),actual=>new RegExp(`\\b${requested.replace('²','2')}\\b`,'i').test(actual.replace('²','2')));
  }
  const size=String(source?.footprint||component.footprint||component.package||'').match(/(?:^|[^0-9])(0201|0402|0603|0805|1206|1210)(?:[^0-9]|$)/)?.[1]
    || text.match(/\b(0201|0402|0603|0805|1206|1210)\b/)?.[1];
  if(size)verify('Package',size,attribute('Package / Case')||candidate.packageType,
    actual=>new RegExp(`(?:^|[^0-9])${size}(?:[^0-9]|$)`).test(actual));
  const quantity=Number(component.quantity)||1;
  if(Number.isFinite(candidate.quantityAvailable))verify('Stock',`${quantity} minimum`,candidate.quantityAvailable,value=>value>=quantity);
  return {checked,unknown,mismatches,
    limitations:['Catalog checks do not verify pin functions, application suitability, or every datasheet condition.']};
}

export function assessSchematicPins(context, assets) {
  const checked=[],unknown=[],mismatches=[];
  const pins=(context||[]).flatMap(symbol=>symbol.pins||[]);
  if(!pins.length)return {checked,unknown,mismatches};
  if(!assets.pinMap) return {checked,unknown:['Candidate pin functions are unavailable; compare against the existing schematic.'],mismatches};
  for(const pin of pins) {
    if(!(pin.number in assets.pinMap)){mismatches.push(`Schematic pin ${pin.number} is absent from the candidate symbol.`);continue;}
    const actual=assets.pinMap[pin.number];
    if(!actual || actual==='~' || !pin.name || pin.name==='~')continue;
    if(actual.toUpperCase()!==pin.name.toUpperCase()) {
      const moved=pins.some(other=>other.number!==pin.number && other.name?.toUpperCase()===actual.toUpperCase());
      (moved?mismatches:unknown).push(`Pin ${pin.number}: schematic ${pin.name}; candidate ${actual}. ${moved?'A named function is assigned to a different pin.':'Verify function and polarity before accepting.'}`);
    }
  }
  if(!mismatches.length)checked.push('Existing schematic pin numbers are present in the candidate symbol.');
  if(!mismatches.length && !unknown.length)checked.push('Available named pins agree with the existing schematic; datasheet verification is still required.');
  return {checked,unknown,mismatches};
}
