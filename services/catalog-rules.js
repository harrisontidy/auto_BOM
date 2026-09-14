// Rules use named catalog attributes, never a number found anywhere in a description.
const rules = {
  inductor: { type:'Inductor', category:/\b(?:Power|RF|Chip) Inductors\b/i, query:'inductor', note:'Choose a current rating, saturation rating and footprint suitable for the circuit.' },
  led: { type:'LED', category:/LED Indication - Discrete/i, query:'LED', note:'Check forward voltage, brightness and drive current before choosing the series resistor.' },
  schottky: { type:'Diode', category:/Schottky Diodes/i, query:'Schottky', note:'Rectified current and reverse voltage are checked separately; verify thermal conditions and forward voltage.' },
  mosfet: { type:'MOSFET', category:/\bMOSFETs\b/i, query:'MOSFET', note:'Gate threshold is not a full-on drive voltage. Check RDS(on) at your actual gate voltage and the thermal current limit.' },
  bjt: { type:'Transistor', category:/Bipolar \(BJT\)/i, query:'transistor', note:'Check collector current, voltage, gain and pinout for your circuit.' },
  crystal: { type:'Crystal', category:/\bCrystals\b/i, query:'Crystals', note:'These are passive crystals, not powered oscillators. Check load capacitance, ESR and footprint.' },
  header: { type:'Connector', category:/\bPin Headers\b/i, query:'pin header', note:'Check pin count, row count, orientation and mating height.' },
  usb: { type:'Connector', category:/\bUSB Connectors\b/i, query:'USB Type-C', note:'Check contact count and USB data/PD needs. A 6-contact power connector does not provide USB data pins.' },
  tactile: { type:'Switch', category:/\bTactile Switches\b/i, query:'Tactile', note:'Check actuator height, footprint, force and contact rating.' },
  ptc: { type:'Fuse', category:/\bResettable Fuses\b/i, query:'Resettable Fuses', note:'Hold current is distinct from trip current. Check voltage rating, trip time and temperature derating.' },
  opto: { type:'Optocoupler', category:/Transistor, Photovoltaic Output Optoisolators/i, query:'Optoisolators', note:'Showing transistor-output optoisolators. Check CTR, LED current, speed and isolation requirements.' },
  temperature: { type:'Temperature sensor', category:/\bTemperature Sensors\b/i, query:'Temperature Sensors', note:'Choose the required interface, supply voltage, accuracy and measurement range.' },
  hall: { type:'Hall sensor', category:/\bHall Switches\b/i, query:'Hall', note:'Showing Hall switches, not linear analog field sensors. Check polarity, latching behavior, output and supply.' },
  rs485: { type:'RS485 transceiver', category:/RS-485 \/ RS-422 ICs/i, query:'RS485 transceiver', note:'Driver-only and receiver-only parts are excluded. Check supply, duplex mode, speed and protection.' },
  ldo: { type:'Voltage regulator', category:/Voltage Regulators - Linear|LDO.*Regulators/i, query:'LDO', note:'Fixed output voltage is checked. Check input range, dropout, capacitor requirements and heat dissipation.' },
  buck: { type:'Voltage regulator', category:/DC-DC Converters/i, query:'DC-DC Converters', note:'Showing fixed-output buck regulators. Check input voltage, thermal current capability and required external components.' },
};

export function scalar(value, unit) {
  let normalized = String(value ?? '').trim().replace(/[µμ]/g, 'u');
  if(unit==='mm') return /^\d+(?:\.\d+)?\s*mm$/i.test(normalized) ? Number.parseFloat(normalized) : null;
  if(unit==='Hz') normalized=normalized.replace(/mhz$/i,'MHz').replace(/khz$/i,'kHz');
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)\s*([pnumkMGT]?)\s*([A-Za-zΩ]+)$/);
  if (!match || match[3].toLowerCase() !== unit.toLowerCase()) return null;
  return Number(match[1]) * ({p:1e-12,n:1e-9,u:1e-6,m:1e-3,k:1e3,M:1e6,G:1e9,T:1e12,'':1}[match[2]]);
}
function near(a,b) { return a !== null && b !== null && Math.abs(a-b) <= Math.max(Math.abs(b)*1e-6,1e-15); }
function pack(text, size) { return !size || new RegExp(`(?:^|[^A-Za-z0-9])${size.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^A-Za-z0-9-])`, 'i').test(text || ''); }

export function interpretCatalogRequest(query) {
  const text=query.trim().replace(/^(?:please\s+)?(?:find|search for|get|i need|i want)\s+(?:me\s+)?(?:a\s+|an\s+)?/i,'').replace(/\s+please$/i,'');
  let m, key, c={};
  const exact=text.match(/^(?:MPN|part number)\s*:\s*([A-Za-z0-9][A-Za-z0-9.+_()/\-]*)$/i);
  if(exact) return {componentType:'Component',value:'',package:'',summary:exact[1],searchTerms:exact[1],supplierPartNumber:exact[1],fastPath:'exact-mpn',requirements:[],assumptions:[],pinCount:0};
  // A bare part-looking identifier is a family lookup; exact matches rank first.
  if (/^[A-Za-z0-9][A-Za-z0-9.+_()/\-]*$/.test(text) && /[A-Za-z].*[A-Za-z]/.test(text) && /\d/.test(text)
      && !/^\d+(?:\.\d+)?(?:[pnumkMGT]?(?:ohms?|[AFHVWΩ]|Hz)|k)$/i.test(text)) {
    return {componentType:'Component',value:'',package:'',summary:text,searchTerms:text,manufacturerFamily:text,fastPath:'family',requirements:[],assumptions:[],pinCount:0};
  }
  if((m=text.match(/^(\d+(?:\.\d+)?\s*[nuµμm]?H)\s+inductor$/i))) { key='inductor';c.value=m[1]; }
  else if((m=text.match(/^(red|green|blue|yellow|white|amber)\s+(0402|0603|0805|1206)\s+LED$/i))) {key='led';c.color=m[1];c.package=m[2];}
  else if((m=text.match(/^(\d+(?:\.\d+)?\s*[mu]?A)\s+(\d+(?:\.\d+)?\s*V)\s+Schottky(?:\s+diode)?$/i))) {key='schottky';c.current=m[1];c.voltage=m[2];}
  else if((m=text.match(/^(\d+(?:\.\d+)?\s*V)\s+([NP])-channel\s+MOSFET(?:\s+(SOT-23|SOIC-8))?$/i))) {key='mosfet';c.voltage=m[1];c.channel=m[2].toUpperCase();c.package=m[3];}
  else if((m=text.match(/^(NPN|PNP)\s+transistor\s+(SOT-23|SOT-323|TO-92)$/i))) {key='bjt';c.polarity=m[1].toUpperCase();c.package=m[2];}
  else if((m=text.match(/^(\d+(?:\.\d+)?\s*[kM]?Hz)\s+crystal$/i))) {key='crystal';c.frequency=m[1];}
  else if((m=text.match(/^(?:(\d+)x(\d+)\s+)?(\d+(?:\.\d+)?)\s*mm\s+pin\s+header$/i))) {key='header';c.rows=m[1]?Number(m[1]):null;c.pins=m[1]?Number(m[1])*Number(m[2]):null;c.pitch=Number(m[3]);}
  else if((m=text.match(/^USB\s+(?:Type[ -]?)?C(?:\s+(\d+)\s*(?:pin|contacts?))?(?:\s+connector)?$/i))) {key='usb';c.pins=m[1]?Number(m[1]):null;}
  else if(/^tactile\s+switch$/i.test(text)) key='tactile';
  else if((m=text.match(/^(?:(\d+(?:\.\d+)?\s*[mu]?A)\s+)?resettable\s+fuse$/i))) {key='ptc';c.current=m[1];}
  else if(/^(?:transistor[ -]output\s+)?optocoupler$/i.test(text)) key='opto';
  else if((m=text.match(/^(?:(I2C|SPI)\s+)?temperature\s+sensor$/i))) {key='temperature';c.interface=m[1];}
  else if(/^Hall\s+(?:sensor|switch)$/i.test(text)) key='hall';
  else if(/^RS[ -]?485\s+transceiver$/i.test(text)) key='rs485';
  else if((m=text.match(/^(\d+(?:\.\d+)?\s*V)\s+(?:(\d+(?:\.\d+)?\s*[mu]?A)\s+)?LDO(?:\s+regulator)?$/i))) {key='ldo';c.voltage=m[1];c.current=m[2];}
  else if((m=text.match(/^(\d+(?:\.\d+)?\s*V)\s+(\d+(?:\.\d+)?\s*A)\s+buck\s+(?:regulator|converter)$/i))) {key='buck';c.voltage=m[1];c.current=m[2];}
  if(!key) return null;
  const rule=rules[key];
  const tokens=[c.value,c.color,c.frequency,c.voltage,c.current,c.channel&&`${c.channel}-channel`,c.polarity,c.interface,c.pins&&`${c.pins}P`,c.pitch&&`${c.pitch}mm`,c.package];
  return {summary:text,componentType:rule.type,value:c.value||'',package:c.package||'',searchTerms:[...tokens.filter(Boolean),rule.query].join(' '),
    catalogKey:key,catalogConstraints:c,fastPath:'catalog',requirements:[],assumptions:[],pinCount:c.pins||0,selectionNote:rule.note};
}

function inferredKey(component) {
  if(component.catalogKey) return component.catalogKey;
  const text=[component.componentType,component.originalQuery].filter(Boolean).join(' ');
  if(/schottky/i.test(text)) return 'schottky';
  if(/optocoupler|optoisolator/i.test(text) && !/gate|triac|digital|high.speed/i.test(text)) return 'opto';
  if(/temperature sensor/i.test(text) && !/humidity/i.test(text)) return 'temperature';
  if(/tactile/i.test(text)) return 'tactile';
  if(/RS[ -]?485.*transceiver/i.test(text)) return 'rs485';
  if(/\bcrystal\b/i.test(text) && !/oscillator/i.test(text)) return 'crystal';
  if(/\bbuck\b/i.test(text) && !/boost/i.test(text)) return 'buck';
  return null;
}

export function familyMatches(family, candidate) {
  const requested=family.toUpperCase().replace(/-/g,''), mpn=String(candidate.manufacturerPartNumber||'').toUpperCase().replace(/-/g,'');
  if (/Development Boards|\bKits\b|\bModules\b|Evaluation Boards/i.test(candidate.description||'')) return false;
  return mpn===requested || (mpn.startsWith(requested) && /^[A-Z._(/+-]/.test(mpn.slice(requested.length)));
}

export function matchesCatalogRules(component,candidate) {
  if(component.manufacturerFamily) return familyMatches(component.manufacturerFamily,candidate);
  const key=inferredKey(component); if(!key) return true;
  if(!rules[key].category.test(candidate.description||'')) return false;
  const c=component.catalogConstraints||{}, p=candidate.parameters||{};
  const atLeast=(name,value,unit)=>!value || (scalar(p[name],unit)!==null && scalar(value,unit)!==null && scalar(p[name],unit)>=scalar(value,unit));
  if(!pack(candidate.packageType,c.package)) return false;
  if(key==='inductor' && c.value && !near(scalar(p.Inductance,'H'),scalar(c.value,'H'))) return false;
  if(key==='led' && c.color && String(p['Illumination Color']||'').toLowerCase()!==c.color.toLowerCase()) return false;
  if(key==='schottky' && (!atLeast('Current - Rectified',c.current,'A') || !atLeast('Voltage - DC Reverse(Vr)',c.voltage,'V'))) return false;
  if(key==='mosfet' && (!atLeast('Drain to Source Voltage',c.voltage,'V') || (c.channel && !new RegExp(`^1 ${c.channel}-channel$`,'i').test(p.Number||'')))) return false;
  if(key==='bjt' && c.polarity && !new RegExp(`^1 ${c.polarity}$`,'i').test(p.Number||'')) return false;
  if(key==='crystal' && (/Crystal Oscillators/i.test(candidate.description||'') || (c.frequency && !near(scalar(p.Frequency,'Hz'),scalar(c.frequency,'Hz'))))) return false;
  if(key==='header' && ((c.pitch && !near(scalar(p.Pitch,'mm'),c.pitch)) || (c.rows && Number(p['Number of Rows'])!==c.rows)
    || (c.pins && Number(String(p['Number of Pins']||'').replace(/P$/i,''))!==c.pins))) return false;
  if(key==='usb' && (String(p['Connector Type']||'').toLowerCase()!=='type-c' || (c.pins && Number(String(p['Number of Contacts']||'').replace(/P$/i,''))!==c.pins))) return false;
  if(key==='ptc' && c.current && !near(scalar(p['Hold Current'],'A'),scalar(c.current,'A'))) return false;
  if(key==='temperature' && c.interface && !String(p.Interface||'').toUpperCase().split(/[、,\s]+/).includes(c.interface.toUpperCase())) return false;
  if(key==='rs485' && String(p.Type||'').toLowerCase()!=='transceiver') return false;
  if((key==='ldo'||key==='buck') && ((c.voltage && (p['Output Type']!=='Fixed'||!near(scalar(p['Output Voltage'],'V'),scalar(c.voltage,'V')))) || !atLeast('Output Current',c.current,'A'))) return false;
  if(key==='buck' && String(p.Topology||'').toLowerCase()!=='buck') return false;
  return true;
}

export function categoryQueries(component, fallback) {
  if(component.manufacturerFamily) return [...new Set([component.manufacturerFamily, component.manufacturerFamily.replace(/^([A-Za-z]+)(\d)/,'$1-$2')])];
  const key=inferredKey(component);if(!key) return fallback;
  // Interface is an attribute, not reliably indexed in the keyword search.
  if(component.catalogKey==='temperature') return [rules.temperature.query, component.searchTerms, ...fallback];
  if(component.catalogKey) return [component.searchTerms, ...fallback];
  // Retain requested values while replacing distributor vocabulary, never strip constraints.
  const query=String(component.aiSearchTerms||component.searchTerms||fallback[0]||'')
    .replace(/optocouplers?/gi,'Optoisolators').replace(/temperature sensors?/gi,'Temperature Sensors')
    .replace(/tactile switches?/gi,'Tactile').replace(/buck (?:regulators?|converters?)/gi,'DC-DC Converters');
  return [query,...fallback];
}
