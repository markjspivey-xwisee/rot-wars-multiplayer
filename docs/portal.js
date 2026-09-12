export const PORTAL_URL = 'https://markjspivey-xwisee.github.io/rot-wars-multiplayer/';
export const DIRECTORY_BASE = 'https://raw.githubusercontent.com/markjspivey-xwisee/rot-wars-multiplayer/world-directory/worlds/';
export const CONTENTS_BASE = 'https://api.github.com/repos/markjspivey-xwisee/rot-wars-multiplayer/contents/worlds/';
export const API_COOLDOWN_MS = 120000;
export const DOWNLOAD_URL = 'https://github.com/markjspivey-xwisee/rot-wars-multiplayer/releases/latest/download/Rot-Wars-Multiplayer-Windows.zip';
const TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
const PROVIDER_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:lhr\.life|trycloudflare\.com|localhost\.run)$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export const createLookupState = () => ({ lastApiAttempt: -Infinity, records: new Map() });

export function tokenFromHash(hash) {
  if (!hash || hash === '#') return null;
  const match = /^#token=([A-Za-z0-9_-]{16,256})$/.exec(hash);
  if (!match) throw new Error('Invalid invitation.');
  return match[1];
}

export function validateOrigin(value) {
  if (typeof value !== 'string') throw new Error('Invalid world address.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid world address.'); }
  if (url.protocol !== 'https:' || url.port || !PROVIDER_HOST.test(url.hostname) || value !== url.origin)
    throw new Error('Invalid world address.');
  return url.origin;
}

export function validateRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.active !== 'boolean' ||
      typeof value.updatedAt !== 'string' || !ISO_TIME.test(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt)))
    throw new Error('Invalid world listing.');
  const origin = value.origin == null && !value.active ? null : validateOrigin(value.origin);
  const roomId = value.roomId;
  if (value.active && (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(roomId)))
    throw new Error('Invalid world identity.');
  return { active: value.active, origin, roomId, updatedAt: value.updatedAt };
}

export function decodeContentsRecord(value) {
  if (!value || value.type !== 'file' || value.encoding !== 'base64' || !Number.isInteger(value.size) ||
      value.size < 0 || value.size > 16384 || typeof value.content !== 'string' || value.content.length > 32768)
    throw new Error('Invalid world listing.');
  const encoded = value.content.replace(/[\r\n]/g, '');
  if (encoded.length > 21848 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error('Invalid world listing.');
  const binary = atob(encoded);
  if (binary.length !== value.size) throw new Error('Invalid world listing.');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return validateRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

export function stableInvitation(token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new Error('Invalid invitation.');
  return `${PORTAL_URL}#token=${token}`;
}

export async function directoryAddress(token, cryptoApi = globalThis.crypto, now = Date.now()) {
  stableInvitation(token);
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const key = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return `${DIRECTORY_BASE}${key}.json?t=${Math.floor(now)}`;
}

export function localAppAddress(origin, token) {
  const address = new URL('http://127.0.0.1:8787/multiplayer.html');
  address.searchParams.set('server', `${validateOrigin(origin).replace('https:', 'wss:')}/room`);
  address.searchParams.set('token', token);
  address.searchParams.set('invite', stableInvitation(token));
  return address.href;
}

async function fetchWithDeadline(fetchImpl, url, signal, timeoutMs) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit',
      redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
    return { ok: response.ok, status: response.status, data: response.ok ? await response.json() : null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function checkAborted(signal) {
  if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
}

async function checkWorld(record, fetchImpl, signal) {
  checkAborted(signal);
  if (!record.active) return record;
  try {
    const health = await fetchWithDeadline(fetchImpl, `${record.origin}/health`, signal, 5000);
    if (!health.ok) throw new Error('The world did not answer.');
    const identity = health.data;
    if (identity?.app !== 'rot-wars-room' || identity.roomId !== record.roomId) throw new Error('The world identity changed.');
  } catch {
    checkAborted(signal);
    const error = new Error('The shared world is temporarily unreachable.');
    error.code = 'WORLD_UNREACHABLE';
    throw error;
  }
  return record;
}

export async function lookupWorld(token, { fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto, now = Date.now(), signal,
  lookupState = createLookupState() } = {}) {
  const address = await directoryAddress(token, cryptoApi, now);
  const filename = new URL(address).pathname.split('/').at(-1);
  const cached = lookupState.records.get(filename);
  let rawError, rawRecord;
  const failedOrigins = new Set();
  const checked = async record => {
    try { return await checkWorld(record, fetchImpl, signal); }
    catch (error) { failedOrigins.add(record.origin); throw error; }
  };
  try {
    const response = await fetchWithDeadline(fetchImpl, address, signal, 12000);
    checkAborted(signal);
    if (!response.ok) {
      const error = new Error('The world listing is unavailable.');
      error.code = response.status === 404 ? 'NOT_FOUND' : 'DIRECTORY_UNAVAILABLE';
      throw error;
    }
    rawRecord = validateRecord(response.data);
    // A known newer API record must not regress to an older CDN snapshot.
    if (cached && Date.parse(cached.updatedAt) > Date.parse(rawRecord.updatedAt)) return await checked(cached);
    return await checked(rawRecord);
  } catch (error) { checkAborted(signal); rawError = error; }

  if (cached?.active && !failedOrigins.has(cached.origin)) {
    try { return await checked(cached); } catch (error) { checkAborted(signal); rawError = error; }
  }
  const cachedClosed = cached && !cached.active && (!rawRecord || Date.parse(cached.updatedAt) >= Date.parse(rawRecord.updatedAt));
  if (now - lookupState.lastApiAttempt < API_COOLDOWN_MS) {
    if (cachedClosed) return cached;
    throw rawError;
  }
  // This shared per-page timestamp also throttles failures and invitation changes.
  lookupState.lastApiAttempt = now;
  const apiAddress = `${CONTENTS_BASE}${filename}?ref=world-directory&t=${Math.floor(now)}`;
  try {
    const response = await fetchWithDeadline(fetchImpl, apiAddress, signal, 12000);
    checkAborted(signal);
    if (!response.ok) throw new Error('The fresh world listing is unavailable.');
    let fresh = decodeContentsRecord(response.data);
    if (cached && Date.parse(cached.updatedAt) > Date.parse(fresh.updatedAt)) fresh = cached;
    lookupState.records.set(filename, fresh);
    return await checked(fresh);
  } catch (error) {
    checkAborted(signal);
    if (cachedClosed) return cached;
    throw error.code === 'WORLD_UNREACHABLE' ? error : rawError;
  }
}

export function createPortal({ document: doc = globalThis.document, window: win = globalThis.window,
  fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto, clipboard = globalThis.navigator?.clipboard, now = Date.now } = {}) {
  const $ = id => doc.getElementById(id);
  const lookupState = createLookupState();
  let token = null, generation = 0, pending = null, destroyed = false;
  function clearAppLink() {
    $('open-app').removeAttribute('href');
    $('open-app').setAttribute('aria-disabled', 'true');
    $('open-app').setAttribute('tabindex', '-1');
    $('open-app').classList.add('disabled');
    $('open-app-note').textContent = token ? 'Waiting for the current world to respond.' : 'An invitation and an available host are needed.';
  }
  function status(title, detail, state = '') {
    $('status-title').textContent = title;
    $('status-detail').textContent = detail;
    $('status-dot').className = `status-dot ${state}`;
  }
  async function refresh() {
    if (!token || destroyed || doc.hidden || pending) return;
    const current = ++generation, requestedToken = token;
    pending = new AbortController();
    clearAppLink(); $('refresh').disabled = true;
    status('Finding your world…', 'Checking the host’s latest address and whether this world responds.');
    try {
      const record = await lookupWorld(requestedToken, { fetchImpl, cryptoApi, now: now(), signal: pending.signal, lookupState });
      if (current !== generation || destroyed) return;
      if (!record.active) {
        status('The world is closed', 'Your host has closed this world. Ask them to start it again or send a new invitation. The setup kit is still available.', 'unavailable');
        return;
      }
      $('open-app').href = localAppAddress(record.origin, requestedToken);
      $('open-app').setAttribute('aria-disabled', 'false');
      $('open-app').removeAttribute('tabindex');
      $('open-app').classList.remove('disabled');
      $('open-app-note').textContent = 'Run Start Multiplayer.cmd first, then open this invitation in your local app.';
      status('Your world is available', 'The shared world responded. Open your local app below to connect your fly. This page checks for address changes while it is open.', 'ready');
    } catch (error) {
      if (current !== generation || destroyed) return;
      clearAppLink();
      if (error.code === 'NOT_FOUND') status('Waiting for the host', 'There is no current address for this invitation yet. Keep this page open, or ask your host to open the world.', 'unavailable');
      else if (error.code === 'WORLD_UNREACHABLE') status('World temporarily unreachable', 'The host’s internet connection may be changing. Keep this page open or check again shortly. You can still download the kit.', 'unavailable');
      else status('Could not refresh the world', 'The current address could not be checked. Try again shortly. The setup-kit download remains available.', 'unavailable');
    } finally {
      if (current === generation) { pending = null; $('refresh').disabled = false; }
    }
  }
  function readInvitation() {
    generation++; pending?.abort(); pending = null;
    token = null; $('share').hidden = true; $('refresh').hidden = true;
    $('copy-status').textContent = ''; $('invitation').value = ''; clearAppLink();
    try { token = tokenFromHash(win.location.hash); }
    catch { status('This invitation could not be read', 'Ask your host for the complete invitation link. You can download and set up the app meanwhile.', 'unavailable'); return; }
    if (!token) {
      status('An invitation brings you into a world', 'Download and set up the app now. Open the invitation your host sends when you are ready to join.'); return;
    }
    $('share').hidden = false; $('refresh').hidden = false;
    $('invitation').value = stableInvitation(token);
    return refresh();
  }
  async function copy() {
    if (!token) return;
    try { await clipboard.writeText(stableInvitation(token)); $('copy-status').textContent = 'Invitation copied. This link keeps finding your host’s current world address.'; }
    catch { $('invitation').focus(); $('invitation').select(); $('copy-status').textContent = 'Select and copy the invitation above.'; }
  }
  const visibleRefresh = () => { if (!doc.hidden) return refresh(); };
  $('refresh').addEventListener('click', refresh);
  $('copy').addEventListener('click', copy);
  win.addEventListener('hashchange', readInvitation);
  win.addEventListener('focus', visibleRefresh);
  doc.addEventListener('visibilitychange', visibleRefresh);
  const timer = win.setInterval(visibleRefresh, 20000);
  readInvitation();
  return { refresh, readInvitation, destroy() {
    destroyed = true; generation++; pending?.abort(); win.clearInterval(timer);
    $('refresh').removeEventListener('click', refresh); $('copy').removeEventListener('click', copy);
    win.removeEventListener('hashchange', readInvitation); win.removeEventListener('focus', visibleRefresh);
    doc.removeEventListener('visibilitychange', visibleRefresh);
  } };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') createPortal();
