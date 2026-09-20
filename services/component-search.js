import { interpretComponentRequest, reviewCandidates } from './ai.js';
import { searchSupplier, candidatePartNumber } from './sourcing.js';
import { resolveKiCadAssets } from './kicad-assets.js';
import { interpretSimpleRequest, relayRequirements } from './component-request.js';
import { discoveryIntent } from './search-intent.js';
import { assessSpecifications, assessSchematicPins } from './specification-checks.js';
import { inferComponentType } from '../parser.js';
import { typicalApplication } from './application-circuits.js';

export function createComponentSearch(dependencies = {}) {
  const interpret = dependencies.interpret || interpretComponentRequest;
  const search = dependencies.search || searchSupplier;
  const assets = dependencies.assets || resolveKiCadAssets;
  const review = dependencies.review || reviewCandidates;
  const broaden = dependencies.broaden || interpretComponentRequest;
  const retryPlans = new Map();
  const cachedAssets = dependencies.cachedAssets || (dependencies.assets ? async () => null
    : (component, candidate, env) => resolveKiCadAssets(component, candidate, { ...env, EASYEDA_CACHE_ONLY: 'true' }));
  const interpretations = new Map();
  return async ({ query, quantity = 1, supplier, preferBasic = true, bomContext }, environment = process.env, options = {}) => {
    const started = performance.now();
    const timings = {};
    const env = { ...environment, SOURCING_SUPPLIER: supplier, PREFER_BASIC: String(preferBasic), SEARCH_SIGNAL: options.signal };
    const checkCancelled = () => options.signal?.throwIfAborted();
    checkCancelled();
    let interpreted = options.interpreted || interpretSimpleRequest(query, supplier);
    if (!interpreted) {
      // Only cache language interpretation, never stock, price or final recommendations.
      const key = JSON.stringify([query.trim(), quantity, supplier, env.OPENAI_MODEL]);
      let entry = interpretations.get(key);
      if (!entry || entry.expires < Date.now()) {
        entry = { expires: Date.now() + 600_000, promise: interpret(query, quantity, env) };
        interpretations.set(key, entry);
        if (interpretations.size > 100) interpretations.delete(interpretations.keys().next().value);
        entry.promise.catch(() => { if (interpretations.get(key) === entry) interpretations.delete(key); });
      }
      try { interpreted = await entry.promise; }
      catch (error) {
        const intent = supplier === 'lcsc' && discoveryIntent({ originalQuery: query });
        if (!intent) throw error;
        interpreted = { summary: query, componentType: 'Component', value: '', package: '',
          searchTerms: intent.queries[0], requirements: [query], assumptions: [], pinCount: 0,
          interpretationFallback: true };
      }
    }
    timings.interpretMs = Math.round(performance.now() - started);
    checkCancelled();
    const component = { ...interpreted, originalQuery: query, supplier, preferBasic, bomContext,
      componentType:interpreted.componentType==='Component' && bomContext?.length
        ? inferComponentType([bomContext[0].reference],bomContext[0].footprint) : interpreted.componentType,
      normalizedValue: interpreted.value, footprint: interpreted.package,
      aiSearchTerms: interpreted.searchTerms, quantity: Number(quantity) || 1 };
    const searchStart = performance.now();
    let result = await search(component, env);
    if (!result.candidates.length && !component.supplierPartNumber && (env.OPENAI_API_KEY || dependencies.broaden)) {
      const key=JSON.stringify([query,supplier,env.OPENAI_MODEL]);
      try {
        let entry=retryPlans.get(key);
        if(!entry || entry.expires<Date.now()) {
          entry={expires:Date.now()+600_000,promise:broaden(`The supplier search for this original request returned no stocked matches: ${query}. Previous keywords: ${result.query || component.searchTerms}. Try different supplier vocabulary or a reasonably related functional alternative. Preserve explicit original requirements, identify any proposed technology or part-family change as an assumption, and never replace a physical device with its driver chip or with tools. Return new searchQueries rather than repeating the failed keywords.`,quantity,env)};
          retryPlans.set(key,entry);
          if(retryPlans.size>100)retryPlans.delete(retryPlans.keys().next().value);
          entry.promise.catch(()=>retryPlans.delete(key));
        }
        const alternative=await entry.promise;
        const retryComponent={...component,...alternative,componentType:component.componentType,originalQuery:query,supplier,preferBasic,quantity:component.quantity,
          requirements:[...new Set([query,...(component.requirements||[]),...(alternative.requirements||[])])],
          normalizedValue:alternative.value,footprint:alternative.package,aiSearchTerms:alternative.searchTerms,
          fastPath:undefined,supplierCategoryId:undefined,manufacturerFamily:undefined,catalogKey:undefined,catalogConstraints:undefined,
          discoveryRetry:true};
        const retry=await search(retryComponent,env);
        if(retry.candidates.length){
          for(const candidate of retry.candidates)candidate.discoveryNote ||= `Broader related search result for "${query}". Check against the original requirements before choosing.`;
          Object.assign(component,retryComponent);result=retry;
        }
        else result.searchNotes=[...(result.searchNotes||[]),'Alternate names and a broader related search also returned no stocked matches.'];
      } catch { result.searchNotes=[...(result.searchNotes||[]),'The related search could not be completed. Try a supplier part number or category name.']; }
    }
    timings.catalogMs = Math.round(performance.now() - searchStart);
    const audited=result.candidates.map(candidate=>({...candidate,verification:assessSpecifications(component,candidate)}));
    result.candidates = audited.filter(candidate=>!candidate.verification.mismatches.length && !candidate.verification.requiredEvidenceMissing?.length);
    if(audited.length && !result.candidates.length)result.searchNotes=[
      'The returned candidates conflict with the original requirements.',...audited.flatMap(candidate=>[...candidate.verification.mismatches,...(candidate.verification.requiredEvidenceMissing || []).map(s=>`Required evidence missing: ${s}`)]).slice(0,4)];
    checkCancelled();
    const prepared = new Map();
    let currentReview = { pending: true };
    const publish = (stage, pool = result.candidates.slice(0, 3)) => {
      checkCancelled();
      options.onProgress?.({component, supplier, query:result.query, checkedAt:result.checkedAt,
        candidates:pool.map(candidate => ({...candidate, reviewPending:Boolean(currentReview.pending),
          kicadAssets:prepared.get(candidatePartNumber(candidate)) || {pending:true,placeable:false}})),
        review:currentReview, stage, pending:true, timings:{...timings,totalMs:Math.round(performance.now()-started)}});
    };
    publish('found');
    // Download the shortlist automatically, instead of converting eight libraries before showing anything.
    const available = new Map();
    const cacheStart = performance.now();
    await Promise.all(result.candidates.map(async candidate => {
      const cached = await cachedAssets(component, candidate, env);
      if (cached?.placeable) available.set(candidatePartNumber(candidate), cached);
    }));
    const ranked = [...result.candidates].sort((a,b) =>
      (preferBasic ? Number(b.libraryType === 'Basic') - Number(a.libraryType === 'Basic') : 0)
      || Number(available.has(candidatePartNumber(b))) - Number(available.has(candidatePartNumber(a))));
    // Ready matching options need no speculative downloads for unselected alternatives.
    const shortlist = available.size ? ranked.filter(c => available.has(candidatePartNumber(c))).slice(0, 3)
      : ranked.slice(0, component.fastPath ? 1 : 3);
    timings.cachedAssetsMs = Math.round(performance.now() - cacheStart);
    const workStart = performance.now();
    for (const [id, value] of available) prepared.set(id, value);
    publish('preparing', shortlist);
    let [candidates, recommendation] = await Promise.all([
      Promise.all(shortlist.map(async candidate => {
        checkCancelled();
        const kicadAssets = available.get(candidatePartNumber(candidate)) || await assets(component, candidate, env);
        const pins=assessSchematicPins(bomContext,kicadAssets);
        kicadAssets.validation={checked:[...(kicadAssets.validation?.checked||[]),...pins.checked],unknown:[...(kicadAssets.validation?.unknown||[]),...pins.unknown]};
        if(pins.mismatches.length){kicadAssets.placeable=false;kicadAssets.importError=pins.mismatches.join(' ');}
        prepared.set(candidatePartNumber(candidate), kicadAssets);
        publish('preparing', shortlist);
        return {...candidate,kicadAssets};
      })),
      (async () => {
        if (!shortlist.length) return {};
        checkCancelled();
        if (component.fastPath) return directReview(component, shortlist[0]);
        try {
          const answer = await (options.review || review)(component, shortlist, env);
          if (answer.selectedSupplierPartNumber !== '' && !shortlist.some(c => candidatePartNumber(c) === answer.selectedSupplierPartNumber)) throw new Error('AI selected a part outside the shortlist.');
          return answer;
        } catch {
          return { ...directReview(component, shortlist[0]), confidence: 0,
            reasoning: 'Stock is verified, but AI could not check the full request. Compare the listed specifications before choosing.',
            concerns: ['The complete requirements have not been verified.'], fallback: true };
        }
      })().then(answer => {currentReview=answer;publish('reviewed',shortlist);return answer;}),
    ]);
    // An unavailable first page of CAD should not hide a usable lower-priced-list alternative.
    if (candidates.length && !candidates.some(c => c.kicadAssets?.placeable)) {
      for (const candidate of ranked.slice(shortlist.length, 6)) {
        checkCancelled();
        if (performance.now() - workStart > 15_000) break;
        if (candidates.some(c => /temporarily refused/i.test(c.kicadAssets?.importError || ''))) break;
        const alternative = { ...candidate, kicadAssets: await assets(component, candidate, env) };
        const pinAudit=assessSchematicPins(bomContext,alternative.kicadAssets);
        alternative.kicadAssets.validation={checked:[...(alternative.kicadAssets.validation?.checked||[]),...pinAudit.checked],unknown:[...(alternative.kicadAssets.validation?.unknown||[]),...pinAudit.unknown]};
        if(pinAudit.mismatches.length){alternative.kicadAssets.placeable=false;alternative.kicadAssets.importError=pinAudit.mismatches.join(' ');}
        candidates.push(alternative);
        if (alternative.kicadAssets?.placeable) break;
      }
      if (!component.fastPath && candidates.length > shortlist.length) {
        try {
          const answer = await (options.review || review)(component, candidates, env);
          if (answer.selectedSupplierPartNumber !== '' && !candidates.some(c => candidatePartNumber(c) === answer.selectedSupplierPartNumber)) throw new Error('Unknown candidate');
          recommendation = answer;
        } catch { /* Keep the initial review; new alternatives are not silently endorsed. */ }
      }
    }
    // Only deterministic matches can be substituted without another requirements review.
    if (component.fastPath && candidates.length) {
      const ready = candidates.find(c => c.kicadAssets?.placeable);
      if (ready) recommendation = directReview(component, ready);
      else recommendation = { ...recommendation, concerns: [...recommendation.concerns,
        'No verified symbol and footprint are currently available for these results.'] };
    }
    const selected = candidates.find(c => candidatePartNumber(c) === recommendation.selectedSupplierPartNumber);
    if (selected?.discoveryNote) recommendation = { ...recommendation,
      confidence: Math.min(recommendation.confidence ?? 0, 0.7),
      concerns: [...new Set([...(recommendation.concerns || []), selected.discoveryNote])] };
    if (!candidates.length && result.searchNotes?.length) recommendation = { reasoning: result.searchNotes.join(' '), concerns: result.searchNotes };
    timings.assetsAndReviewMs = Math.round(performance.now() - workStart);
    timings.totalMs = Math.round(performance.now() - started);
    checkCancelled();
    candidates = candidates.map(candidate => ({...candidate, typicalApplication:typicalApplication(candidate)}));
    return { component, supplier, query: result.query, candidates, review: recommendation, timings,
      checkedAt: result.checkedAt, totalCandidates: result.candidates.length };
  };
}

function directReview(component, candidate) {
  const concerns = [];
  let reasoning = component.fastPath === 'exact' ? 'Exact LCSC part number; current supplier stock verified. No AI needed.'
    : 'Matches the stated value and package. Ranked by Basic preference, then unit price; current supplier stock verified.';
  if(component.fastPath==='category') {
    reasoning=`Matches the supplier's ${component.supplierCategory} category; current stock verified.`;
    concerns.push('This is a category search. Check electrical ratings and package before choosing a part.');
  }
  if(component.fastPath==='exact-mpn') reasoning='Exact manufacturer part number; current supplier stock verified. No AI needed.';
  if(component.fastPath==='family') {
    reasoning=`Manufacturer lookup: ${candidate.manufacturerPartNumber}. Current supplier stock verified; development boards and modules excluded.`;
    if(candidate.manufacturerPartNumber.toUpperCase()!==component.manufacturerFamily.toUpperCase()) concerns.push('This is a family variant. Check the full part number, package and grade before choosing.');
  }
  if(component.fastPath==='catalog') {
    reasoning='Matches the requested catalog category and the supported specifications in your search. Current supplier stock verified.';
    if(component.selectionNote) concerns.push(component.selectionNote);
  }
  if (component.fastPath === 'relay') {
    const p = candidate.parameters || {};
    reasoning = `Catalog switching current: ${p['Switching Current(Max)']}. Coil: ${p['Coil Voltage'] || 'not listed'}. Contacts: ${p['Contact Form'] || 'not listed'}. Contact rating: ${p['Contact Rating'] || 'not listed'}.`;
    if (!relayRequirements(component).coil) concerns.push('Coil voltage was not specified. Choose the voltage your driver supplies, for example 5 V or 12 V.');
    concerns.push('The switching-current maximum alone does not guarantee this current at every load voltage. Check the contact rating for your AC/DC load.');
  }
  return { selectedSupplierPartNumber: candidatePartNumber(candidate),
    selectedManufacturerPartNumber: candidate.manufacturerPartNumber, reasoning, concerns,
    confidence: concerns.length ? 0.7 : 1, deterministic: true };
}

export const searchComponents = createComponentSearch();
