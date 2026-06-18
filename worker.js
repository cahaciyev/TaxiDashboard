// Cloudflare Worker — Geekbro GPS Proxy + SmsRadar Cərimə & Həbs Proxy
const GB_USER     = 'cavidhaciyevE';
const GB_PASS     = 'cavid!E24';
const GB_LOGIN    = 'https://app.geekbro.ai/be-service/api/auth/login';
const GB_UPSTREAM = 'https://app.geekbro.ai/be-service/drivers';
const SMSRADAR_BASE   = 'https://smsradar.az/apixxx';
const SMSRADAR_COOKIE = 'lang=az; ut=f7qava2163vfO1fehasecdD9Y3Gap290O2pd08DdBd1729n8t9_76a3d52ae6d6f37a00022c779f79e83ace8d7f12; st=Y0j3264f0dp2Ha6aSdw7EandecxaWa_6E9o6x8bfj74Za3I1_76a3d52ae6d6f37a00022c779f79e83ace8d7f12; token_user=5f82f93ec913e79e7c126d32';
const ORIGIN = 'https://cahaciyev.github.io';

let cachedToken = null;
let tokenExpiry  = 0;

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiry > now + 60) return cachedToken;
  const r = await fetch(GB_LOGIN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://app.geekbro.ai',
      'Referer': 'https://app.geekbro.ai/login',
    },
    body: JSON.stringify({ userName: GB_USER, password: GB_PASS }),
  });
  if (!r.ok) throw new Error(`Login ${r.status}`);
  const data = await r.json();
  const token = data.token || data.accessToken || data.access_token;
  if (!token) throw new Error('No token in login response');
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    tokenExpiry = payload.exp || (now + 3600);
  } catch { tokenExpiry = now + 3600; }
  cachedToken = token;
  return token;
}

function smsHeaders() {
  return {
    'Cookie': SMSRADAR_COOKIE,
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://smsradar.az/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

// GET /fines?car=77UD140
async function handleFines(car_number) {
  const url = `${SMSRADAR_BASE}/protocols/list?lang=az&app_id=12&car_number=${encodeURIComponent(car_number)}`;
  const r = await fetch(url, { headers: smsHeaders() });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

// GET /carsstatus — bütün maşınların həbs/sığorta/baxış statusu
async function handleCarStatus() {
  const url = `${SMSRADAR_BASE}/cars/list?lang=az&app_id=12&limit=50`;
  const r = await fetch(url, { headers: smsHeaders() });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }

    // ── Cərimə proxy: GET /fines?car=77UD140 ──
    if (request.method === 'GET' && url.pathname === '/fines') {
      const car = url.searchParams.get('car') || '';
      if (!car) return new Response(JSON.stringify({ error: 'car param required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...cors() },
      });
      try { return await handleFines(car); }
      catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...cors() },
        });
      }
    }

    // ── Həbs/status proxy: GET /carsstatus ──
    if (request.method === 'GET' && url.pathname === '/carsstatus') {
      try { return await handleCarStatus(); }
      catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...cors() },
        });
      }
    }

    // ── GPS proxy: POST / ──
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const inUrl  = new URL(request.url);
    const outUrl = new URL(GB_UPSTREAM);
    inUrl.searchParams.forEach((v, k) => outUrl.searchParams.set(k, v));
    const body = await request.text();

    let token;
    try { token = await getToken(); }
    catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors() },
      });
    }

    const doReq = (tok) => fetch(outUrl.toString(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body,
    });

    let resp = await doReq(token);
    if (resp.status === 401) {
      cachedToken = null; tokenExpiry = 0;
      try {
        token = await getToken();
        resp = await doReq(token);
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Auth failed: ' + e.message }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...cors() },
        });
      }
    }

    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json', ...cors() },
    });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
