// Getting job ads in: a link (any page with schema.org JobPosting data, which most
// job boards and applicant-tracking systems publish), pasted text, or the
// Duunitori search API for the radar.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const DUUNITORI_API = 'https://duunitori.fi/api/v1/jobentries';

export class UserError extends Error {}

export async function readAd({ url, text, meta = {} }) {
  if (text && text.trim()) {
    const clean = tidy(text);
    if (clean.length < 200) throw new UserError('That ad is too short to say anything useful. Paste the full text.');
    return { ...meta, text: clean, source: meta.source || 'pasted' };
  }
  if (!url) throw new UserError('Give me a link to a job ad, or paste its text.');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new UserError('That link does not look like a web address.');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new UserError('Only http(s) links work.');

  const html = await fetchText(parsed.href);
  const posting = findJobPosting(html);
  const ad = posting
    ? {
        title: posting.title,
        company: posting.hiringOrganization?.name,
        location: placeName(posting.jobLocation),
        datePosted: posting.datePosted,
        validThrough: posting.validThrough,
        text: tidy(htmlToText(posting.description || '')),
      }
    : { title: pageTitle(html), text: tidy(htmlToText(html)) };

  if (!ad.text || ad.text.length < 200) {
    throw new UserError('Could not read the ad on that page (it may need a login). Paste the ad text instead.');
  }
  return { ...ad, text: ad.text.slice(0, 15000), url: parsed.href, source: new URL(parsed.href).hostname };
}

// Words that give away hand-work in Finnish and English ads.
const MANUAL_SIGNALS = [
  [/excel/i, 'Excel'],
  [/tiedonsyöt|syöttä|data entry/i, 'data entry'],
  [/manuaal|manual/i, 'manual'],
  [/laskut|invoic/i, 'invoicing'],
  [/reskontr|ledger/i, 'ledger'],
  [/täsmäy|reconcil/i, 'reconciliation'],
  [/raportoin|reporting/i, 'reporting'],
  [/tilaust(en)? ?käsittel|tilauskäsittel|order (handling|processing)/i, 'order handling'],
  [/arkistoin|archiv/i, 'archiving'],
  [/palkanlask|payroll/i, 'payroll'],
  [/ostolask|accounts payable|purchase invoice/i, 'purchase invoices'],
  [/kirjaa|kirjaukset|bookkeep/i, 'bookkeeping'],
  [/ajanvara|scheduling|booking/i, 'scheduling'],
];

export async function searchDuunitori(q) {
  if (!q || !q.trim()) throw new UserError('Type a job title, keyword or company name.');
  const pages = await Promise.all(
    [1, 2].map((page) =>
      fetchJson(`${DUUNITORI_API}?search=${encodeURIComponent(q.trim())}&page=${page}`).catch(() => null),
    ),
  );
  const seen = new Set();
  const jobs = [];
  for (const res of pages) {
    for (const r of res?.results || []) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      const descr = r.descr || '';
      jobs.push({
        title: r.heading,
        company: r.company_name,
        location: r.municipality_name,
        datePosted: r.date_posted,
        url: `https://duunitori.fi/tyopaikat/tyo/${r.slug}`,
        text: descr,
        signals: MANUAL_SIGNALS.filter(([re]) => re.test(`${r.heading} ${descr}`)).map(([, label]) => label),
      });
    }
  }
  jobs.sort((a, b) => b.signals.length - a.signals.length || new Date(b.datePosted) - new Date(a.datePosted));
  return { count: pages[0]?.count ?? jobs.length, jobs };
}

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fi,en;q=0.8' }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new UserError('Could not reach that page. Check the link or paste the ad text.');
  }
  if (!res.ok) throw new UserError(`The page answered ${res.status}. Paste the ad text instead.`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function findJobPosting(html) {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) stack.push(...node);
      else {
        const type = [].concat(node['@type'] || []);
        if (type.includes('JobPosting')) return node;
        if (node['@graph']) stack.push(node['@graph']);
      }
    }
  }
  return null;
}

function placeName(loc) {
  const first = [].concat(loc || [])[0];
  return first?.address?.addressLocality || first?.name || undefined;
}

function pageTitle(html) {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim() || undefined;
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', euro: '€', auml: 'ä', ouml: 'ö', aring: 'å', Auml: 'Ä', Ouml: 'Ö', Aring: 'Å' };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n] ?? m);
}

function tidy(s) {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
