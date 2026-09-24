import {candidateReviewInstructions} from './candidate-review.js';
import { searchComponents } from './component-search.js';
import { codexStructuredResponse } from './codex-provider.js';
import {askModels,selectModel} from './ask-models.js';

const string = { type: 'string' };
const strings = { type: 'array', items: string };
export const askSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    answer: string, search: { type: 'boolean' }, query: string,
    componentType: string, value: string, package: string,
    searchTerms: string, searchQueries: strings, requirements: strings, assumptions: strings,
  },
  required: ['answer','search','query','componentType','value','package','searchTerms','searchQueries','requirements','assumptions'],
};
export const askInstructions = `You are a conversational AI assistant inside KiCad. Answer questions naturally, explain concepts, help reason through circuit ideas, and discuss engineering tradeoffs. Users can ask questions and follow-ups without requesting parts. Plan searches of the selected supplier only when useful for a part-selection request. This is requirements-based component selection, not just keyword lookup.
Only user-stated constraints are hard requirements. Do not invent extra filters for preferences the user did not mention. Raise an omitted detail only when it could materially change the choice, prevent basic operation, or create a serious risk; otherwise use a clearly labeled ordinary assumption. Do not turn a list of possible engineering checks into a refusal. Retain ALL explicit requirements from the conversation unless the user changes them. The query must be a complete standalone request containing ONLY user-stated requirements. Do not add demands to verify minimum on-time, thermal capability or circuit component values to the query unless the user explicitly asked for those checks. Keep routine engineering checks out of the main answer. Mention heat, ripple, layout or similar secondary topics only when the user asks or there is a concrete known problem affecting operation; do not add boilerplate about checks being unverified. Separate requirements from preferences and assumptions. Ask one focused question when a decision is necessary. For part requests with enough information, search suitable candidates and briefly explain why they fit. For ordinary questions, answer directly. Never claim live stock, price, CAD availability or verified datasheet capabilities: the supplier tools run AFTER your response. Do not invent citations or say you searched the web. You have no browsing tool in this planning step.
For a request to generate or place a typical application circuit for a recommended part, direct the user to its Generate typical application circuit button. Do not draw ASCII circuit diagrams or invent pin wiring in chat. Explain that circuit support is part-specific and do not claim a circuit was generated or placed by a chat answer. For an MCU with an interface for a display, search for the MCU, not the display. A radio module and a microcontroller are different options; explain proposed substitutions. Distinguish MIPI DSI from CSI, SPI and generic MIPI. GPIO count must account for pins used by requested peripherals; a catalog GPIO total alone does not prove simultaneous usability. Easy to solder is a preference requiring discussion of package/pitch/exposed pads; do not invent a package restriction. When a combination might need separate chips, explain it as an alternative and ask before relaxing single-chip requirements. Do not assume a candidate exists or cannot exist from memory alone.
Set search=false for general questions, explanations, greetings, brainstorming, or necessary clarifications; query can then be empty. Set search=true when the user wants suitable parts and enough information exists for exploration. searchTerms/searchQueries should be concise supplier keywords for the actual requested component. Do not make incompatible products sound like matches. Recommend one part when there is a clear suitable choice; offer two or three only when meaningful tradeoffs remain. Do not pad recommendations with near-duplicates. For part searches, give a short useful explanation of the choice and the main tradeoff, not a long checklist. For design questions, give enough explanation to help. When searchFeedback is present, use the failed result evidence to produce different, more specific supplier keywords without relaxing requirements. Do not invent stock or confirmed part capabilities. Never run commands, inspect files, or change the schematic. Placement and BOM changes remain explicit reviewed actions in KiCad.`;

export function validateAsk(input) {
  if (!input || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 2000)
    throw new Error('Enter a question of 2,000 characters or fewer.');
  if (!['lcsc','digikey'].includes(input.supplier) || typeof input.preferBasic !== 'boolean')
    throw new Error('Choose a supplier and Basic preference.');
  if (!['api','codex'].includes(input.provider)) throw new Error('Choose OpenAI API or Codex account.');
  if (input.model !== undefined && (typeof input.model !== 'string' || !/^[a-z0-9.-]{1,100}$/.test(input.model))) throw new Error('Invalid model selection.');
  if (input.effort !== undefined && !['auto','none','minimal','low','medium','high','xhigh','max'].includes(input.effort)) throw new Error('Invalid reasoning level.');
  const history = input.history || [];
  if (!Array.isArray(history) || history.length > 20 || history.some(m => !m || !['user','assistant'].includes(m.role)
    || typeof m.content !== 'string' || m.content.length > 8000) || JSON.stringify(history).length > 48000)
    throw new Error('This conversation is too long. Start a new conversation with the requirements you want to keep.');
  return { ...input, history };
}

export async function planAsk(input, environment, {signal} = {}) {
  const prompt = JSON.stringify({ supplier: input.supplier, preferBasic: input.preferBasic,
    searchFeedback: input.searchFeedback || undefined,
    conversation: [...input.history, { role: 'user', content: input.query }] });
  const {model,effort}=selectModel(await askModels(input.provider,environment),input.model||'latest',input.effort||'auto');
  const tagged=result=>({...result,modelUsed:model,effortUsed:effort});
  if (input.provider === 'codex') return tagged(await codexStructuredResponse({ prompt, instructions: askInstructions, schema: askSchema, model, effort, signal }, environment));
  if (!environment.OPENAI_API_KEY) throw new Error('OpenAI API key is not configured. Choose Codex account or configure OPENAI_API_KEY.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.any([AbortSignal.timeout(75_000), ...(signal ? [signal] : [])]),
    headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, store: false, reasoning: { effort }, instructions: askInstructions,
      input: prompt, text: { format: { type: 'json_schema', name: 'component_conversation', strict: true, schema: askSchema } } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Ask failed (${response.status}): ${data.error?.message || 'Model unavailable.'}`);
  const output = data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!output) throw new Error('The assistant returned no answer. Try again.');
  return tagged(JSON.parse(output));
}

// Keep retrieval broad; expose a small reviewed selection in the conversation.
export function shortlistAskResult(result) {
  const review = result.review || {};
  const candidates = review.selectedSupplierPartNumber === '' ? [] : [...(result.candidates || [])];
  const selected = candidates.find(c => c.supplierPartNumber === review.selectedSupplierPartNumber);
  if (selected) {
    candidates.splice(candidates.indexOf(selected), 1);
    candidates.unshift(selected);
  }
  const strong = selected && !result.pending && !selected.reviewPending
    && review.confidence >= 0.8 && !review.fallback
    && !(selected.verification?.mismatches || []).length;
  const seen = new Set();
  const unique = candidates.filter(c => {
    const key = c.manufacturerPartNumber ? `${c.manufacturer || ''}:${c.manufacturerPartNumber}` : c.supplierPartNumber;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return {...result, candidates: unique.slice(0, strong ? 1 : 3)};
}

export function createAsk({plan = planAsk, search = searchComponents} = {}) {
  return async (raw, environment = process.env, options = {}) => {
    const input = validateAsk(raw);
    const response = await plan(input, environment, options);
    for (const [key, spec] of Object.entries(askSchema.properties)) {
      if (spec.type === 'array' ? !Array.isArray(response[key]) || response[key].some(v => typeof v !== 'string') : typeof response[key] !== spec.type)
        throw new Error('The assistant returned an invalid search plan. Try again.');
    }
    if (response.query.length > 4000 || (response.search && !response.query.trim())) throw new Error('The assistant returned an invalid search request.');
    const component = {...response, userRequests:[...input.history.filter(m=>m.role==='user').map(m=>m.content),input.query], summary: (response.searchTerms || input.query).slice(0,120), pinCount: 0};
    const assistant = {answer: response.answer, query: response.query, requirements: response.requirements,
      assumptions: response.assumptions, provider: input.provider, model: response.modelUsed || environment.ASK_MODEL || 'gpt-6-astra', effort:response.effortUsed || 'low'};
    const decorate = result => ({...shortlistAskResult(result), assistant});
    if (!response.search) return decorate({component, candidates: [], review: {}, conversationOnly: true});
    options.onProgress?.(decorate({component,candidates:[],review:{},pending:true,stage:'planning'}));
    // A Codex-selected turn must never silently spend API credits for secondary review.
    const env = {...environment,OPENAI_MODEL:assistant.model,OPENAI_REASONING_EFFORT:assistant.effort,
      ...(input.provider==='codex'?{OPENAI_API_KEY:''}:{})};
    const runSearch = interpreted => search({...input, query: response.query}, env, {...options, interpreted,
      ...(input.provider === 'codex' ? {review: (component,candidates) => codexStructuredResponse({
        model: assistant.model, effort:assistant.effort, signal: options.signal,
        instructions: candidateReviewInstructions,
        prompt: JSON.stringify({component,candidates}),
        schema: {type:'object',additionalProperties:false,properties:{selectedSupplierPartNumber:string,reasoning:string,
          confidence:{type:'number',minimum:0,maximum:1},concerns:strings},
          required:['selectedSupplierPartNumber','reasoning','confidence','concerns']},
      },environment)} : {}),
      onProgress: result => options.onProgress?.(decorate(result))});
    let result = await runSearch(component);
    if (!result.availabilityReason && (!shortlistAskResult(result).candidates.length || result.review?.fallback || result.review?.confidence < 0.65)) {
      options.signal?.throwIfAborted();
      options.onProgress?.(decorate({component,candidates:[],review:{},pending:true,stage:'refining'}));
      try {
        const refined = await plan({...input, searchFeedback:{originalRequest:response.query,
          requirements:response.requirements,previousKeywords:response.searchQueries,
          outcome:result.review, instruction:'Try different targeted supplier keywords. Preserve every explicit requirement; no silent technology substitution.'}},environment,options);
        if (refined.search && typeof refined.searchTerms === 'string' && Array.isArray(refined.searchQueries)
            && refined.searchQueries.every(q=>typeof q==='string')
            && JSON.stringify([refined.searchTerms,refined.searchQueries]) !== JSON.stringify([response.searchTerms,response.searchQueries])) {
          result = await runSearch({...component,searchTerms:refined.searchTerms,searchQueries:refined.searchQueries});
        }
      } catch (error) { if (options.signal?.aborted) throw error; }
    }
    result = shortlistAskResult(result);
    if (result.candidates.length) {
      const selected = result.candidates.find(c=>c.supplierPartNumber===result.review?.selectedSupplierPartNumber) || result.candidates[0];
      assistant.answer = result.review?.reasoning
        ? `${selected.manufacturerPartNumber || selected.supplierPartNumber}: ${result.review.reasoning}`
        : `I found ${result.candidates.length === 1 ? 'one option' : `${result.candidates.length} options`} for your request. See the part details below.`;
    }
    if (!result.candidates.length) assistant.answer = result.availabilityReason || `I couldn't verify a match for your requirements in this supplier search. ${result.review?.reasoning || 'I tried refining the search without relaxing your requirements.'} This does not mean the part does not exist.`;
    assistant.context = JSON.stringify({query:response.query,requirements:response.requirements,assumptions:response.assumptions,
      candidates:shortlistAskResult(result).candidates.map(c=>({part:c.manufacturerPartNumber,supplierPart:c.supplierPartNumber,
        verification:c.verification,package:c.packageType})),review:result.review}).slice(0,6000);
    return decorate(result);
  };
}
