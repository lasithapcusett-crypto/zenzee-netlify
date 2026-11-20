// Zenzee Music API for Netlify (no dependencies).
//   /api/search?source=youtube|soundcloud&q=...
//   /api/link?url=...      /api/stream?url=...      /api/config
// YouTube client versions below may need a bump if YouTube changes things.

export const config = { path: '/api/*' };

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ALLOWED = ['youtube.com', 'youtu.be', 'soundcloud.com'];

const YT_CLIENTS = [
  {
    id: 28,
    ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    ctx: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3',
      osName: 'Android', osVersion: '12L', androidSdkVersion: 32, hl: 'en', gl: 'US' },
  },
  {
    id: 5,
    ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
    ctx: { clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2',
      osName: 'iPhone', osVersion: '18.1.0.22B83', hl: 'en', gl: 'US' },
  },
];

// ------------------------------------------------------------------ helpers
const err = (status, detail) => Object.assign(new Error(detail), { status });
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

function checkUrl(u) {
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { throw err(400, 'Bad link'); }
  if (!ALLOWED.some(d => host === d || host.endsWith('.' + d))) throw err(400, 'Only YouTube / SoundCloud links are allowed');
  return host;
}
const isSC = host => host === 'soundcloud.com' || host.endsWith('.soundcloud.com');

function ytId(u) {
  const x = new URL(u);
  let id = null;
  if (x.hostname === 'youtu.be') id = x.pathname.slice(1).split('/')[0];
  else if (x.searchParams.get('v')) id = x.searchParams.get('v');
  else {
    const m = x.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (m) id = m[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

function collect(node, key, out = []) {
  if (Array.isArray(node)) node.forEach(n => collect(n, key, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { if (k === key) out.push(v); else collect(v, key, out); }
  }
  return out;
}
const parseDur = s => String(s || '').split(':').reduce((a, b) => a * 60 + (+b || 0), 0);

// ------------------------------------------------------------------ YouTube
async function ytSearch(q) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA_WEB, 'accept-language': 'en-US,en;q=0.9' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
      query: q, params: 'EgIQAQ==',
    }),
  });
  if (!r.ok) throw err(502, 'YouTube search answered ' + r.status);
  const data = await r.json();
  return collect(data, 'videoRenderer')
    .filter(v => v.videoId && v.lengthText)
    .slice(0, 20)
    .map(v => ({
      source: 'youtube',
      url: 'https://www.youtube.com/watch?v=' + v.videoId,
      title: (v.title?.runs || []).map(x => x.text).join('') || 'Unknown',
      artist: v.ownerText?.runs?.[0]?.text || '',
      duration: parseDur(v.lengthText?.simpleText),
    }));
}

async function ytPlayer(id, c) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': c.ua, origin: 'https://www.youtube.com',
      'x-youtube-client-name': String(c.id), 'x-youtube-client-version': c.ctx.clientVersion,
    },
    body: JSON.stringify({ context: { client: c.ctx }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
  });
  if (!r.ok) throw err(502, 'YouTube answered ' + r.status);
  return r.json();
}

function pickAudio(data) {
  const fm = (data.streamingData?.adaptiveFormats || []).filter(f => f.url && /^audio\//.test(f.mimeType || ''));
  const byRate = (a, b) => (b.bitrate || 0) - (a.bitrate || 0);
  return fm.filter(f => /mp4a/.test(f.mimeType)).sort(byRate)[0] || fm.sort(byRate)[0] || null;
}

const ytCache = new Map();
async function ytAudio(id, fresh = false) {
  const hit = ytCache.get(id);
  if (hit && !fresh && hit.exp > Date.now()) return hit;
  let reason = '';
  for (const c of YT_CLIENTS) {
    try {
      const data = await ytPlayer(id, c);
      const f = pickAudio(data);
      if (f) {
        if (ytCache.size > 200) ytCache.clear();
        const out = { url: f.url, ua: c.ua, exp: Date.now() + 20 * 60 * 1000 };
        ytCache.set(id, out);
        return out;
      }
      reason = data.playabilityStatus?.reason || data.playabilityStatus?.status || 'No audio found';
    } catch (e) { reason = e.message; }
  }
  throw err(502, 'YouTube refused: ' + reason);
}

async function ytInfo(id) {
  for (const c of YT_CLIENTS) {
    try {
      const d = (await ytPlayer(id, c)).videoDetails;
      if (d) return { source: 'youtube', url: 'https://www.youtube.com/watch?v=' + id, title: d.title, artist: d.author || '', duration: +d.lengthSeconds || 0 };
    } catch (e) { /* try next */ }
  }
  throw err(502, "Couldn't read that YouTube link");
}

// ------------------------------------------------------------------ SoundCloud
let scId = null, scIdAt = 0;
async function scClientId(force = false) {
  if (scId && !force && Date.now() - scIdAt < 6 * 3600e3) return scId;
  const html = await (await fetch('https://soundcloud.com/', { headers: { 'user-agent': UA_WEB } })).text();
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]).reverse();
  for (const s of scripts) {
    const js = await (await fetch(s, { headers: { 'user-agent': UA_WEB } })).text();
    const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (m) { scId = m[1]; scIdAt = Date.now(); return scId; }
  }
  throw err(502, "Couldn't connect to SoundCloud");
}

async function scGet(path) {
  for (const force of [false, true]) {
    const id = await scClientId(force);
    const r = await fetch('https://api-v2.sndcdn.com' + path + (path.includes('?') ? '&' : '?') + 'client_id=' + id,
      { headers: { 'user-agent': UA_WEB } });
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw err(502, 'SoundCloud answered ' + r.status);
    return r.json();
  }
  throw err(502, 'SoundCloud refused the request');
}

const scTrack = t => ({
  source: 'soundcloud', url: t.permalink_url, title: t.title || 'Unknown',
  artist: t.user?.username || '', duration: Math.round((t.duration || 0) / 1000),
});

async function scSearch(q) {
  const d = await scGet('/search/tracks?limit=20&q=' + encodeURIComponent(q));
  return (d.collection || []).filter(t => t.permalink_url && t.policy !== 'BLOCK').map(scTrack);
}

async function scStreamUrl(trackUrl) {
  const t = await scGet('/resolve?url=' + encodeURIComponent(trackUrl));
  const tc = (t.media?.transcodings || []).find(x => x.format?.protocol === 'progressive');
  if (!tc) throw err(502, 'This SoundCloud track has no direct audio stream');
  const sep = tc.url.includes('?') ? '&' : '?';
  const auth = t.track_authorization ? '&track_authorization=' + t.track_authorization : '';
  const id = await scClientId();
  const r = await fetch(tc.url + sep + 'client_id=' + id + auth, { headers: { 'user-agent': UA_WEB } });
  if (!r.ok) throw err(502, 'SoundCloud stream answered ' + r.status);
  return (await r.json()).url;
}

// ------------------------------------------------------------------ audio proxy (Range aware, for iOS)
async function proxy(req, upstream, headers) {
  const range = req.headers.get('range');
  const up = await fetch(upstream, { headers: { ...headers, range: range || 'bytes=0-' } });
  if (up.status !== 200 && up.status !== 206) {
    try { await up.body?.cancel(); } catch (e) { /* ignore */ }
    throw err(502, 'Audio source answered ' + up.status);
  }
  const out = new Headers();
  for (const k of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']) {
    if (up.headers.get(k)) out.set(k, up.headers.get(k));
  }
  out.set('accept-ranges', 'bytes');
  out.set('cache-control', 'no-store');
  let status = up.status;
  if (!range && status === 206) { status = 200; out.delete('content-range'); }
  return new Response(up.body, { status, headers: out });
}

// ------------------------------------------------------------------ router
export default async (req) => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  try {
    if (p === 'config') return json({ login_required: false, signed_in: true });
    if (p === 'health') return json({ ok: true });

    if (p === 'search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
      if (!q) return json([]);
      return json(url.searchParams.get('source') === 'soundcloud' ? await scSearch(q) : await ytSearch(q));
    }

    if (p === 'link') {
      const target = url.searchParams.get('url') || '';
      const host = checkUrl(target);
      if (isSC(host)) {
        const t = await scGet('/resolve?url=' + encodeURIComponent(target));
        if (t.kind === 'playlist') return json((t.tracks || []).filter(x => x.title).map(scTrack));
        return json([scTrack(t)]);
      }
      const id = ytId(target);
      if (!id) throw err(400, 'Playlists are not supported yet, paste a single video link');
      return json([await ytInfo(id)]);
    }

    if (p === 'stream') {
      const target = url.searchParams.get('url') || '';
      const host = checkUrl(target);
      if (isSC(host)) return await proxy(req, await scStreamUrl(target), { 'user-agent': UA_WEB });
      const id = ytId(target);
      if (!id) throw err(400, 'Bad YouTube link');
      let a = await ytAudio(id);
      try { return await proxy(req, a.url, { 'user-agent': a.ua }); }
      catch (e) {
        ytCache.delete(id);
        a = await ytAudio(id, true);
        return await proxy(req, a.url, { 'user-agent': a.ua });
      }
    }
  } catch (e) {
    return json({ detail: String(e.message || e).slice(0, 200) }, e.status || 502);
  }
  return json({ detail: 'Not found' }, 404);
};
