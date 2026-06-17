// Cloudflare Worker - Geekbro GPS Proxy with auto-login
const GB_USER     = 'cavidhaciyevE';
const GB_PASS     = 'cavid!E24';
const GB_LOGIN    = 'https://app.geekbro.ai/be-service/api/auth/login';
const GB_UPSTREAM = 'https://app.geekbro.ai/be-service/drivers';
const ORIGIN      = 'https://cahaciyev.github.io';

let cachedToken = null;
let tokenExpiry = 0;

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

  if (!r.ok) {
    throw new Error(`Login ${r.status}`);
  }

  const data = await r.json();
  const token = data.token || data.accessToken || data.access_token;
  if (!token) throw new Error('No token in login response');

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    tokenExpiry = payload.exp || (now + 3600);
  } catch {
    tokenExpiry = now + 3600;
  }

  cachedToken = token;
  return token;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const inUrl  = new URL(request.url);
    const outUrl = new URL(GB_UPSTREAM);
    inUrl.searchParams.forEach((v, k) => outUrl.searchParams.set(k, v));

    const body = await request.text();

    let token;
    try {
      token = await getToken();
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...cors() },
      });
    }

    const resp = await fetch(outUrl.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    // Token rejected — clear cache and retry once
    if (resp.status === 401) {
      cachedToken = null;
      tokenExpiry = 0;
      try {
        token = await getToken();
        const resp2 = await fetch(outUrl.toString(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body,
        });
        const text2 = await resp2.text();
        return new Response(text2, {
          status: resp2.status,
          headers: { 'Content-Type': 'application/json', ...cors() },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Auth failed: ' + e.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...cors() },
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
