// Protocol reference: akiselev/datasheet-cli's SnapEDA integration.
// These are undocumented website endpoints, not the partner API.
import {snapMagicSessionStore} from './snapmagic-session.js';
const BASE = 'https://www.snapeda.com';
const norm = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const mfr = value => norm(value).replace(/(INTERNATIONAL|INTL|INCORPORATED|INC|CORPORATION|CORP|LTD|LIMITED)$/g, '');

export function createSnapMagic({fetchImpl = fetch, store = null} = {}) {
  let session = null;
  const ready = store ? store.load().then(saved => {if(saved?.sessionid && saved?.csrftoken)session=saved;}) : Promise.resolve();
  let queue = Promise.resolve();
  const cookies = response => Object.fromEntries(response.headers.getSetCookie().map(line => line.split(';')[0].split(/=(.*)/s).slice(0, 2)));
  const cookieHeader = jar => Object.entries(jar).filter(([key]) => ['sessionid', 'csrftoken'].includes(key)).map(([key, value]) => `${key}=${value}`).join('; ');
  async function request(path, options = {}) {
    const response = await fetchImpl(`${BASE}${path}`, {redirect: 'manual', signal: AbortSignal.timeout(45000), ...options});
    if (response.status === 403 || response.status === 429) throw new Error(`SnapMagic refused the request (HTTP ${response.status}). Try again later or download the ZIP in your browser.`);
    return response;
  }
  async function json(response) {
    if (!response.ok) throw new Error(`SnapMagic request failed (HTTP ${response.status}).`);
    try { return await response.json(); }
    catch { throw new Error('SnapMagic returned an unexpected response. Sign in again or use a browser download.'); }
  }
  async function login(username, password) {
    await ready;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 320 || password.length > 1000) throw new Error('Enter your SnapMagic username and password.');
    const page = await request('/account/login/');
    if (!page.ok) throw new Error('SnapMagic sign-in is unavailable.');
    const jar = cookies(page);
    if (!jar.csrftoken) throw new Error('SnapMagic sign-in requires browser verification.');
    await page.body?.cancel();
    const response = await request('/account/login/', {method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/account/login/`, Cookie: cookieHeader(jar)
    }, body: new URLSearchParams({username: username.trim(), password, csrfmiddlewaretoken: jar.csrftoken})});
    const received = cookies(response);
    if (![301, 302].includes(response.status) || !received.sessionid) throw new Error('SnapMagic sign-in failed. Check your credentials; accounts using single sign-on may require a password.');
    const next = {...jar, ...received};
    if(store)await store.save(next);
    session = next;
    await response.body?.cancel();
    return {connected: true};
  }
  async function download(candidate) {
    await ready;
    if (!session) throw new Error('Connect SnapMagic at http://localhost:4173/snapmagic to download CAD automatically.');
    const jar = {...session};
    const headers = {Cookie: cookieHeader(jar), Referer: `${BASE}/search/`, 'X-CSRFToken': jar.csrftoken, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded'};
    const found = await json(await request('/api/v1/search_local_internal', {method: 'POST', headers, body: new URLSearchParams({q: candidate.manufacturerPartNumber})}));
    const exact = (found.results || []).filter(part => norm(part.part_number) === norm(candidate.manufacturerPartNumber));
    const matching = exact.filter(part => {
      const a = mfr(part.manufacturer), b = mfr(candidate.manufacturer);
      return a && b && (a === b || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a))));
    });
    const ids = [...new Set(matching.map(p => String(p.unipart_id)))];
    if (ids.length !== 1 || !/^\d+$/.test(ids[0])) throw new Error('SnapMagic has no unambiguous exact part and manufacturer match.');
    const uid = ids[0];
    const info = await json(await request(`/api/get_part_for_unipart/${uid}`));
    if (norm(info.modelname) !== norm(candidate.manufacturerPartNumber) || !/^\d+$/.test(String(info.part_id))) throw new Error('SnapMagic model identity does not match the selected part.');
    const output = await json(await request(`/parts/snapapi/download-component/${info.part_id}/${uid}/kicad_modv6`, {headers: {Cookie: cookieHeader(jar), Referer: `${BASE}/`}}));
    if (!output.url) throw new Error('SnapMagic did not provide a KiCad ZIP. Your login may have expired or this model may be unavailable.');
    const url = new URL(output.url);
    if (url.protocol !== 'https:' || url.hostname !== 'snapeda.s3.amazonaws.com' || url.username || url.password || url.port) throw new Error('SnapMagic returned an unsupported download host.');
    // Never send account cookies to the file host, or follow an unvalidated redirect.
    const file = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(45000)});
    if (!file.ok) throw new Error(`SnapMagic ZIP download failed (HTTP ${file.status}).`);
    const chunks = []; let size = 0;
    for await (const chunk of file.body) {
      size += chunk.length;
      if (size > 10_000_000) throw new Error('SnapMagic ZIP exceeds the size limit.');
      chunks.push(chunk);
    }
    const zip = Buffer.concat(chunks);
    if (zip[0] !== 80 || zip[1] !== 75 || zip[2] !== 3 || zip[3] !== 4) throw new Error('SnapMagic did not return a ZIP archive.');
    return zip;
  }
  return {login, status: async () => {await ready; return {connected: Boolean(session)};}, logout: async () => {await ready; session = null; if(store)await store.clear();},
    download: candidate => {
      const task = queue.then(() => download(candidate));
      queue = task.catch(() => {});
      return task;
    }};
}
export const snapMagic = createSnapMagic({store:snapMagicSessionStore});
