import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { readAd, searchDuunitori, UserError } from './lib/sources.js';
import { analyzeAd, defaultModel, translateTitles } from './lib/analyze.js';
import { findContact } from './lib/contact.js';
import { computeEconomics } from './public/economics.js';
import * as store from './lib/store.js';

try {
  process.loadEnvFile(join(import.meta.dirname, '.env'));
} catch {
  // No .env: the app still runs, analysis explains what is missing.
}

const PUBLIC = join(import.meta.dirname, 'public');
const SAMPLES = join(import.meta.dirname, 'samples');
const PORT = Number(process.env.PORT) || 3100;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const routes = {
  async 'POST /api/analyze'(req) {
    const input = await readBody(req);
    // Settings can pick any OpenRouter model id; empty means the .env default.
    const model = input.model || undefined;
    if (model && !/^[\w.:/-]{1,100}$/.test(model)) throw new UserError('That model id does not look right. Check it in Settings.');
    let ad;
    if (input.sample) {
      ad = { text: await readFile(join(SAMPLES, 'sample-ad.txt'), 'utf8'), company: 'Pohjolan Teräsosa Oy (fictional)', title: 'Tilauskoordinaattori', location: 'Lahti', source: 'sample' };
      if (!process.env.OPENROUTER_API_KEY) return sampleFallback();
    } else {
      ad = await readAd(input);
    }
    const result = await analyzeAd(ad, { lang: input.lang, tone: input.tone, model });
    const { analysis, ms, usage } = result;
    const assumptions = { monthlySalary: analysis.salary?.monthly_eur || 3500 };
    const run = await store.saveRun({
      createdAt: new Date().toISOString(),
      options: { lang: input.lang || 'en', tone: input.tone || 'friendly' },
      ad,
      analysis,
      assumptions,
      percentAtCreation: computeEconomics(analysis.lines, assumptions).percent,
      verdict: null,
      model: result.model,
      ms,
      usage,
    });
    return run;
  },

  async 'GET /api/config'() {
    return { model: defaultModel() };
  },

  async 'GET /api/radar'(req, url) {
    const result = await searchDuunitori(url.searchParams.get('q') || '');
    const english = await translateTitles(result.jobs.map((j) => j.title));
    result.jobs.forEach((j, i) => (j.titleEn = english[i] && english[i] !== j.title ? english[i] : null));
    return result;
  },

  async 'GET /api/runs'() {
    const runs = await store.listRuns();
    return runs.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      company: r.analysis?.company || r.ad?.company,
      role: r.analysis?.role || r.ad?.title,
      percent: computeEconomics(r.analysis?.lines, r.assumptions).percent,
      signal: r.analysis?.signal,
      verdict: r.verdict,
    }));
  },
};

async function handleApi(req, res, url) {
  const run = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
  const contact = url.pathname.match(/^\/api\/runs\/([\w-]+)\/contact$/);
  try {
    let data;
    if (run && req.method === 'GET') data = await store.getRun(run[1]);
    else if (run && req.method === 'PATCH') data = await store.updateRun(run[1], await readBody(req));
    else if (contact && req.method === 'POST') data = await findRunContact(contact[1]);
    else {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: 'Not found' });
      data = await handler(req, url);
    }
    if (data === null) return send(res, 404, { error: 'Not found' });
    send(res, 200, data);
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    send(res, e instanceof UserError ? 400 : 500, { error: e instanceof UserError ? e.message : 'Something broke on the server. Check the terminal.' });
  }
}

async function serveStatic(res, pathname) {
  // Share links (/r/<id>) are the same single-page app.
  const file = pathname === '/' || pathname.startsWith('/r/') ? '/index.html' : pathname;
  const path = normalize(join(PUBLIC, file));
  if (!path.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}

// Who to email: a web search, saved with the run so it only costs once per ad.
async function findRunContact(id) {
  const run = await store.getRun(id);
  if (!run) return null;
  const contact = await findContact(run);
  // Re-read: a verdict or an assumption may have been saved while the search ran.
  return store.saveRun({ ...(await store.getRun(id)), contact });
}

async function sampleFallback() {
  try {
    return JSON.parse(await readFile(join(SAMPLES, 'sample-run.json'), 'utf8'));
  } catch {
    throw new UserError('No OPENROUTER_API_KEY in .env, and no saved sample result yet.');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new UserError('Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const isText = typeof data === 'string';
  res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' });
  res.end(isText ? data : JSON.stringify(data));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    serveStatic(res, decodeURIComponent(url.pathname));
  })
  .listen(PORT, () => {
    console.log(`Red Pen running at http://localhost:${PORT}`);
    if (!process.env.OPENROUTER_API_KEY) console.log('No OPENROUTER_API_KEY set: only the saved sample will work.');
  });
