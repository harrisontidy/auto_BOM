// Fast paths only accept fully understood requests. Extra constraints go to AI.
import { interpretCatalogRequest, categoryQueries } from './catalog-rules.js';
import { interpretCategoryRequest } from './supplier-categories.js';
export function interpretSimpleRequest(query, supplier = 'lcsc') {
  const text = query.trim();
  const base = { summary: text, componentType: 'Component', value: '', package: '',
    searchTerms: text, requirements: [], assumptions: [], pinCount: 0 };
  const passiveRequest = simplePassiveRequest(text);
  if (passiveRequest) return {...base, ...passiveRequest};
  if (supplier === 'lcsc' && /^C\d+$/i.test(text)) return {
    ...base, summary: text.toUpperCase(), supplierPartNumber: text.toUpperCase(), fastPath: 'exact',
  };
  if(supplier==='lcsc') {
    const catalog=interpretCatalogRequest(text);
    if(catalog) return catalog;
  }
  const clean = text.toLowerCase().replace(/^(?:please\s+)?(?:find|search for|get|i need|i want)\s+(?:me\s+)?(?:a\s+|an\s+)?/, '').replace(/\s+please$/, '');
  const passive = clean.match(/^(\d+(?:\.\d+)?\s*(?:k(?:ohm)?|mohm|ohms?|ω|[pnuµμ]f))\s+(0201|0402|0603|0805|1206|1210)\s+(resistor|capacitor)$/i);
  if (passive && ((passive[3] === 'resistor' && !/f$/i.test(passive[1])) || (passive[3] === 'capacitor' && /f$/i.test(passive[1])))) {
    // Keep the original case: m and M have different meanings in electronics.
    const value = text.match(/\d+(?:\.\d+)?\s*(?:k(?:ohm)?|mohm|ohms?|ω|[pnuµμ]f)/i)?.[0];
    return { ...base, componentType: passive[3] === 'resistor' ? 'Resistor' : 'Capacitor',
      value, package: passive[2], searchTerms: `${value} ${passive[2]} ${passive[3]}`, fastPath: 'passive' };
  }
  if (supplier === 'lcsc' && /\brelays?\b/.test(clean)) {
    const residue = clean.replace(/\b\d+(?:\.\d+)?\s*a\b/g, '').replace(/\b\d+(?:\.\d+)?\s*v\s*(?:dc\s*)?coil\b/g, '')
      .replace(/\b(?:power|relays?|with|a|an|rated|at|for|contact|current|spdt|spst)\b/g, '').replace(/[\s,.-]/g, '');
    const currents = [...clean.matchAll(/\b(\d+(?:\.\d+)?)\s*a\b/g)];
    const volts = [...clean.matchAll(/\b(\d+(?:\.\d+)?)\s*v\b/g)];
    if (!residue && currents.length === 1 && volts.length <= 1 && Number(currents[0][1]) > 0) {
      return { ...base, componentType: 'Relay', value: `${currents[0][1]}A`, fastPath: 'relay',
        requirements: [`Contact current at least ${currents[0][1]} A`, ...(volts.length ? [`Coil voltage ${volts[0][1]} V`] : [])],
        summary: `${currents[0][1]} A power relay${volts.length ? `, ${volts[0][1]} V coil` : ''}` };
    }
  }
  return supplier === 'lcsc' ? interpretCategoryRequest(query) : null;
}

function simplePassiveRequest(text) {
  const kind = text.match(/\b(resistor|capacitor)s?\b/i)?.[1]?.toLowerCase();
  if (!kind) return null;
  const packages = [...text.matchAll(/\b(0201|0402|0603|0805|1206|1210)\b/g)];
  if (packages.length !== 1) return null;
  let residue = text.replace(packages[0][0], ' ').replace(/\b(resistor|capacitor)s?\b/gi, ' ')
    .replace(/\b(?:please|find|search|for|get|me|a|an|i|need|want|in|package|size|smd|of|value)\b/gi, ' ')
    .replace(/[,=:]/g, ' ').trim();
  const resistance = /^(?:\d+(?:\.\d+)?\s*(?:[kKMm]?(?:ohms?|Ω)|[kKMRr])|\d+[RrKkM]\d+)$/;
  const capacitance = /^\d+(?:\.\d+)?\s*[pnuµμm]F$/i;
  if (!(kind === 'resistor' ? resistance : capacitance).test(residue)) return null;
  const value = residue.replace(/\s+/g, '').replace(/ohms?/gi, 'ohm');
  return {componentType:kind === 'resistor' ? 'Resistor' : 'Capacitor', value,
    package:packages[0][1], searchTerms:`${value} ${packages[0][1]} ${kind}`, fastPath:'passive'};
}

export function relayRequirements(component) {
  const text = component.originalQuery || component.value || '';
  const load = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*V\s*(AC|DC)\b/gi)]
    .find(match => !/^\s*coil\b/i.test(text.slice(match.index + match[0].length))
      && !/coil\s*(?:voltage)?\s*(?:of|=|:)?\s*$/i.test(text.slice(0, match.index)));
  return {
    current: Number(text.match(/\b(\d+(?:\.\d+)?)\s*A\b/i)?.[1]) || null,
    coil: Number(text.match(/\b(\d+(?:\.\d+)?)\s*V\s*(?:DC\s*)?coil\b/i)?.[1]
      || text.match(/coil\s*(?:voltage)?\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*V\b/i)?.[1]) || null,
    form: text.match(/\b(SPDT|SPST)\b/i)?.[1]?.toUpperCase() || '',
    load: load ? { voltage: Number(load[1]), kind: load[2].toUpperCase() } : null,
  };
}

export function matchesRelayRequirements(component, candidate) {
  if (!/\brelay\b/i.test(component.componentType || '')) return true;
  if (/solid.state|reed|thermal/i.test(component.originalQuery || '')) return true;
  // Catalog keywords can match MPNs and unrelated product categories.
  if (!/\bpower relays?\b/i.test(candidate.description || '')) return false;
  const p = candidate.parameters || {};
  const required = relayRequirements(component);
  const amps = Number(String(p['Switching Current(Max)'] || '').match(/^(\d+(?:\.\d+)?)\s*A$/i)?.[1]);
  const volts = Number(String(p['Coil Voltage'] || '').match(/^(\d+(?:\.\d+)?)\s*V$/i)?.[1]);
  if (required.current && (!amps || amps < required.current)) return false;
  if (required.coil && volts !== required.coil) return false;
  if (required.form && !String(p['Contact Form'] || '').toUpperCase().includes(required.form)) return false;
  if (required.load) {
    const ratings = [...String(p['Contact Rating'] || '').matchAll(/(\d+(?:\.\d+)?)\s*A\s*@\s*(\d+(?:\.\d+)?)\s*V\s*(AC|DC)/gi)];
    if (!ratings.some(r => Number(r[1]) >= (required.current || 0)
      && Number(r[2]) >= required.load.voltage && r[3].toUpperCase() === required.load.kind)) return false;
  }
  return true;
}

export function catalogQueries(component, fallback) {
  const normalize = text => String(text).replace(/(\d)\s+(mA|A|V|kV|uF|nF|pF|kOhm|ohm)\b/gi, '$1$2').trim();
  if (/\brelay\b/i.test(component.componentType || '') && !/solid.state|reed|thermal/i.test(component.originalQuery || '')) {
    const { current, coil, form } = relayRequirements(component);
    return [...new Set([
      [current && `${current}A`, coil && `${coil}V`, form, 'Power Relays'].filter(Boolean).join(' '),
      [current && `${current}A`, 'Relays'].filter(Boolean).join(' '),
      ...fallback.map(normalize),
    ])];
  }
  return [...new Set(categoryQueries(component, fallback).map(normalize))];
}
