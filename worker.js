// Cloudflare Worker - Geekbro GPS Proxy
// Deploy: https://workers.cloudflare.com → Create Worker → paste this code → Deploy

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYXZpZGhhY2l5ZXZFIiwiY29tcGFueUlkIjoiZjUwMDRkODYtNWU4NC00ODAwLWFlZjEtYmU3MTA0ODA1NzZhIiwicm9sZSI6Ik9XTkVSIiwiZXhwIjoxNzgxNjg3NDc3fQ.sHpqfk-Jb5Qi7sKHR2mR2BEYEIwoAi5hpHmTR9BE-bc';
const UPSTREAM = 'https://app.geekbro.ai/be-service/drivers';
const ORIGIN   = 'https://cahaciyev.github.io';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const inUrl  = new URL(request.url);
    const outUrl = new URL(UPSTREAM);
    inUrl.searchParams.forEach((v, k) => outUrl.searchParams.set(k, v));

    const body = await request.text();

    const resp = await fetch(outUrl.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body,
    });

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
