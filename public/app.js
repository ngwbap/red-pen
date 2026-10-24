import { computeEconomics, fillTemplate } from '/economics.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Duunitori is Finnish, so the search runs on the Finnish word.
const RADAR_CHIPS = [
  ['laskuttaja', 'Invoicing clerk'],
  ['tilauskäsittelijä', 'Order handler'],
  ['reskontranhoitaja', 'Accounts receivable'],
  ['palkanlaskija', 'Payroll'],
  ['kirjanpitäjä', 'Bookkeeper'],
  ['myynnin tuki', 'Sales support'],
  ['asiakaspalvelu', 'Customer service'],
  ['logistiikka', 'Logistics'],
  ['ostaja', 'Purchaser'],
  ['toimistosihteeri', 'Office assistant'],
];

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `Server answered ${res.status}` }));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- settings ----------
// Kept in this browser. Model, language and tone go with each mark-up request;
// the name fills the sign-off of the draft email.
const settingsForm = $('#settings');
const settings = { name: '', model: '', lang: 'en', tone: 'friendly' };
const stored = readJson('redpen.settings');
for (const k of Object.keys(settings)) {
  if (typeof stored[k] === 'string') settings[k] = stored[k];
  settingsForm.elements[k].value = settings[k];
}
let onSettingsChange = () => {};
settingsForm.addEventListener('input', () => {
  for (const k of Object.keys(settings)) settings[k] = settingsForm.elements[k].value.trim();
  writePref('redpen.settings', JSON.stringify(settings));
  onSettingsChange();
});
settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  settingsForm.hidePopover();
});
api('/api/config')
  .then((c) => (settingsForm.elements.model.placeholder = `${c.model} (default)`))
  .catch(() => {});

const signed = (body) => (settings.name ? body.replace(/\[your name\]/gi, settings.name) : body);

// ---------- tabs ----------
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((s) => (s.hidden = s.id !== `tab-${name}`));
  if (name === 'history') renderHistory();
}
$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (tab) showTab(tab);
});

// ---------- mark up ----------
const form = $('#ad-form');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = form.url.value.trim();
  const text = form.text.value.trim();
  if (!url && !text) return showError('Paste a job ad link, or open "paste the ad text".');
  analyze(text ? { text, meta: url ? { url } : {} } : { url });
});
$('#sample-btn').addEventListener('click', () => analyze({ sample: true }));

async function analyze(payload) {
  showError('');
  setBusy(true);
  const stop = startProgress();
  try {
    const run = await api('/api/analyze', { method: 'POST', body: { ...payload, lang: settings.lang, tone: settings.tone, model: settings.model || undefined } });
    stop(true);
    history.pushState({}, '', `/?run=${run.id}`);
    renderResult(run, { fresh: true });
    refreshPill();
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    stop(false);
    showError(err.message);
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  $$('#ad-form button, .job-actions button').forEach((b) => (b.disabled = busy));
}

function showError(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = !msg;
}

// The model call is one request, so the steps are paced to its usual ~30 s.
function startProgress() {
  const box = $('#progress');
  const steps = $$('li', box);
  const at = [0, 2500, 14000, 22000, 27000];
  box.hidden = false;
  $('#result').innerHTML = '';
  steps.forEach((li) => li.classList.remove('active', 'done'));
  const timers = at.map((ms, i) =>
    setTimeout(() => {
      steps.forEach((li, j) => {
        li.classList.toggle('done', j < i);
        li.classList.toggle('active', j === i);
      });
    }, ms),
  );
  return () => {
    timers.forEach(clearTimeout);
    box.hidden = true;
  };
}

// ---------- result ----------
// fresh: just marked up, so the email search starts straight away.
function renderResult(run, { share = false, fresh = false } = {}) {
  const a = run.analysis;
  const ad = run.ad || {};
  const assumptions = { ...run.assumptions };
  const company = a.company || ad.company || 'Unknown company';
  const role = a.role || ad.title || 'Job ad';
  const bold = run.options?.tone === 'bold';
  const foreign = a.ad_language && a.ad_language !== 'en';
  const checked = a.lines.filter((l) => l.kind !== 'context').length;
  const verified = a.lines.filter((l) => l.kind !== 'context' && l.verified).length;
  let to = run.contact?.contacts[0]?.email || null;

  $('#result').innerHTML = `
    <div class="result-meta">
      <div>
        <div class="eyebrow">${esc(company)}</div>
        <h2>${esc(role)}</h2>
        <div class="meta-line">${metaLine(ad, a)}</div>
      </div>
      <div class="actions">
        ${share ? '' : '<button class="btn" id="share-btn">Copy share link</button>'}
        <button class="btn" id="print-btn">Save as PDF</button>
      </div>
    </div>
    <div id="banners"></div>
    <div class="result-grid">
      <div>
        <div class="paper-tools">
          <div class="legend">
            <span><span class="k-strike">struck</span> automatic</span>
            <span><span class="k-wavy">wavy</span> AI-assisted</span>
            <span><span class="k-tick">✓</span> human</span>
          </div>
          ${foreign ? `<div class="seg" id="mode" role="group" aria-label="Language of the ad">
            <button type="button" data-mode="en">English</button>
            <button type="button" data-mode="orig">Original (${esc(langName(a.ad_language))})</button>
          </div>` : ''}
        </div>
        <article class="paper" id="paper">
          <div class="stamp"><b id="stamp-n"></b><span>${bold ? 'automatable' : 'repetitive work'}</span></div>
          <header class="paper-head">
            <div class="paper-company">${esc(company)}</div>
            <div class="paper-role">${esc(role)}</div>
          </header>
          <ol class="lines" id="lines"></ol>
          <div class="signoff" id="signoff"></div>
          <footer class="paper-foot">Marked up by Red Pen from the public job ad${ad.url ? ` (${esc(new URL(ad.url).hostname)})` : ''}. Figures are estimates.</footer>
        </article>
      </div>
      <aside class="side">
        <section class="card numbers">
          <div class="big"><b id="n-percent"></b><span>of this role's week is repetitive work</span></div>
          <div class="mix" id="mix"></div>
          <dl class="stats">
            <div><dt>Hours freed per year</dt><dd id="n-hours"></dd></div>
            <div><dt>Value of that time per year</dt><dd id="n-eur"></dd></div>
            <div><dt>More time on the real job</dt><dd id="n-mult"></dd></div>
          </dl>
          <details class="assumptions">
            <summary>How we got these numbers</summary>
            <ol class="math">
              <li>Every task in the ad gets a verdict and a share of the week (click a line to see it).</li>
              <li>Time freed: <input data-k="rateAutomate" type="number" min="0" max="100" step="5">% of an automatic task, <input data-k="rateAssist" type="number" min="0" max="100" step="5">% of an AI-assisted one, nothing of a human one.</li>
              <li>Hours = time freed × <input data-k="hoursPerYear" type="number" min="100" step="50"> working hours a year.</li>
              <li>Value = time freed × yearly cost: <input data-k="monthlySalary" type="number" min="0" step="100"> €/month
                <span class="source-tag ${a.salary?.source === 'ad' ? 'ad' : ''}" title="${esc(a.salary?.basis || '')}">${a.salary?.source === 'ad' ? 'from the ad' : 'estimate'}</span>
                × 12.5 months × (1 + <input data-k="sideCosts" type="number" min="0" max="60" step="1">% employer costs).</li>
              <li>"More time on the real job" = 1 ÷ (1 − time freed), when the freed hours go back into the human parts of the role.</li>
            </ol>
          </details>
        </section>
        <section class="card">
          <h3>Send to</h3>
          <p class="recipient" title="${esc(a.recipient?.why || '')}">${esc(a.recipient?.role || 'Head of the team')}</p>
          ${share ? '' : '<div id="contacts"></div>'}
        </section>
        ${share ? '' : `
        <section class="card email">
          <div class="card-head"><h3>Draft note</h3><button class="btn small" id="copy-email">Copy</button></div>
          <div class="subject" id="email-to-row" hidden>To: <a id="email-to" title="Open this note in your mail app"></a></div>
          <div class="subject">Subject: <span id="email-subject"></span></div>
          <pre id="email-body"></pre>
        </section>
        <section class="card verdict">
          <h3>Would you send this?</h3>
          <div class="verdict-buttons">
            <button class="btn" data-v="send">Yes, send it</button>
            <button class="btn" data-v="skip">No, skip</button>
          </div>
          <input id="verdict-note" placeholder="Why?">
          <p class="form-error small" id="verdict-status" style="margin:8px 0 0" hidden></p>
        </section>`}
        <p class="under-hood">${verified}/${checked} quotes verified · ${esc(run.model || '')}${run.ms ? ` · ${Math.round(run.ms / 1000)} s` : ''}${run.usage?.cost ? ` · $${run.usage.cost.toFixed(3)}` : ''}</p>
      </aside>
    </div>`;

  // Assumption inputs <-> numbers
  const toInputs = {
    rateAutomate: () => Math.round((assumptions.rates?.automate ?? 0.8) * 100),
    rateAssist: () => Math.round((assumptions.rates?.assist ?? 0.4) * 100),
    hoursPerYear: () => assumptions.hoursPerYear ?? 1600,
    monthlySalary: () => assumptions.monthlySalary ?? 3500,
    sideCosts: () => Math.round((assumptions.sideCosts ?? 0.22) * 100),
  };
  $$('.math input').forEach((input) => {
    input.value = toInputs[input.dataset.k]();
    input.disabled = share;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      const k = input.dataset.k;
      if (k === 'rateAutomate') assumptions.rates = { ...assumptions.rates, automate: v / 100 };
      else if (k === 'rateAssist') assumptions.rates = { ...assumptions.rates, assist: v / 100 };
      else if (k === 'sideCosts') assumptions.sideCosts = v / 100;
      else assumptions[k] = v;
      update();
      saveAssumptions();
    });
  });
  let saveTimer;
  const saveAssumptions = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api(`/api/runs/${run.id}`, { method: 'PATCH', body: { assumptions } }).catch(() => {}), 600);
  };

  function update() {
    const e = computeEconomics(a.lines, assumptions);
    $('#stamp-n').textContent = e.display.percent;
    $('#n-percent').textContent = e.display.percent;
    $('#n-hours').textContent = e.display.hours;
    $('#n-eur').textContent = e.display.eur;
    $('#n-mult').textContent = e.display.multiplier;
    const mixLabel = { automate: 'automatic', assist: 'AI-assisted', human: 'human' };
    $('#mix').innerHTML = ['automate', 'assist', 'human'].map((k) => `<span class="m-${k}" style="width:${(e.mix[k] * 100).toFixed(1)}%" title="${plural(e.counts[k], 'task')} ${mixLabel[k]}"></span>`).join('');
    $('#signoff').innerHTML = `${esc(a.headline || '')}<small>≈ ${esc(e.display.hours.replace(' h', ' hours'))} a year of hand-work. That's ${esc(e.display.multiplier)} more time for the work that matters.</small>`;
    if (!share) {
      const subject = a.email?.subject || '';
      const body = signed(fillTemplate(a.email?.body || '', e, run.options?.lang));
      $('#email-subject').textContent = subject;
      $('#email-body').textContent = body;
      $('#email-to-row').hidden = !to;
      $('#email-to').textContent = to || '';
      $('#email-to').href = to ? `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : '';
    }
    renderBanners(a, e);
  }
  update();
  onSettingsChange = update;

  // Line interactions
  $('#paper').addEventListener('click', (e) => {
    const li = e.target.closest('.line');
    if (li && (li.querySelector('.how, .week-share, .alt') || li.classList.contains('k-context'))) li.classList.toggle('open');
  });
  // English readers see the translation with the red pen on it; "Original" is
  // the version to send to the company. Clicking a line shows the other language.
  const renderLines = (mode) => {
    const english = foreign && mode === 'en';
    $('#lines').innerHTML = a.lines.map((l) => lineHtml(l, english)).join('');
    $$('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  };
  renderLines(foreign ? readPref('redpen.mode', 'en') : 'orig');
  $('#mode')?.addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode;
    if (!mode) return;
    writePref('redpen.mode', mode);
    renderLines(mode);
  });
  $('#print-btn').addEventListener('click', () => window.print());

  if (share) return;

  $('#share-btn').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(`${location.origin}/r/${run.id}`);
    flash(e.target, 'Link copied');
  });
  $('#copy-email').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(`${to ? `To: ${to}\n` : ''}Subject: ${$('#email-subject').textContent}\n\n${$('#email-body').textContent}`);
    flash(e.target, 'Copied');
  });

  // Who to email: a web search that starts right after a markup (older ads get a button),
  // saved with the run.
  const contactBox = $('#contacts');
  const renderContacts = ({ busy = false, error = '' } = {}) => {
    const c = run.contact;
    const people = c?.contacts || [];
    const label = busy ? 'Searching the web…' : c ? 'Search again' : 'Find their email';
    contactBox.innerHTML = `
      ${people.length ? `<ul class="contacts">${people.map((p) => contactHtml(p, people.length > 1, p.email === to)).join('')}</ul>` : ''}
      ${c && (c.note || !people.length) ? `<p class="small muted">${esc(c.note || 'No email found.')}</p>` : ''}
      ${people.length ? '' : `<button class="btn small" id="find-contact"${busy ? ' disabled' : ''}>${label}</button>`}
      ${error ? `<p class="form-error small">${esc(error)}</p>` : ''}`;
  };
  const searchContact = async () => {
    renderContacts({ busy: true });
    try {
      run.contact = (await api(`/api/runs/${run.id}/contact`, { method: 'POST' })).contact;
      to = run.contact.contacts[0]?.email || null;
      if (!contactBox.isConnected) return;
      renderContacts();
      update();
    } catch (err) {
      if (contactBox.isConnected) renderContacts({ error: err.message });
    }
  };
  renderContacts();
  if (fresh && !run.contact) searchContact();
  contactBox.addEventListener('click', (e) => {
    if (e.target.closest('#find-contact')) searchContact();
  });
  contactBox.addEventListener('change', (e) => {
    if (e.target.name !== 'to') return;
    to = e.target.value;
    update();
  });

  // Verdict
  const note = $('#verdict-note');
  const status = $('#verdict-status');
  const paint = (v) => $$('.verdict-buttons button').forEach((b) => b.classList.toggle('on', b.dataset.v === v?.value));
  note.value = run.verdict?.note || '';
  paint(run.verdict);
  $$('.verdict-buttons button').forEach((b) =>
    b.addEventListener('click', async () => {
      run.verdict = { value: b.dataset.v, note: note.value.trim(), at: new Date().toISOString() };
      paint(run.verdict);
      status.hidden = true;
      await api(`/api/runs/${run.id}`, { method: 'PATCH', body: { verdict: run.verdict } }).catch((err) => {
        status.textContent = err.message;
        status.hidden = false;
      });
      refreshPill();
    }),
  );
}

// The source line says how much to trust the address: seen on a page, or built from the company's format.
function contactHtml(p, pick, checked) {
  const host = p.source_url ? new URL(p.source_url).hostname.replace(/^www\./, '') : '';
  const on = host ? ` on <a href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(host)}</a>` : '';
  const source = p.verified
    ? `✓ ${p.inAd ? 'in the ad' : `found${on}`}`
    : p.basis === 'pattern'
      ? `guessed from the address format${on}`
      : `not confirmed${on}, check before sending`;
  return `<li title="${esc(p.why)}"><label>
    ${pick ? `<input type="radio" name="to" value="${esc(p.email)}"${checked ? ' checked' : ''}>` : ''}
    <span><b>${esc(p.name || p.email)}</b>${p.title ? ` · ${esc(p.title)}` : ''}
      ${p.name ? `<span class="contact-email">${esc(p.email)}</span>` : ''}
      <span class="contact-src${p.verified ? ' ok' : ''}">${source}</span></span>
  </label></li>`;
}

function renderBanners(a, e) {
  const out = [];
  if (e.signal !== 'strong' || a.signal === 'none') {
    out.push(`<div class="banner warn" title="${esc(a.signal_reason || 'Too little repetitive work in this ad to make a credible case.')}"><b>Not worth sending</b></div>`);
  }
  $('#banners').innerHTML = out.join('');
}

function lineHtml(l, english) {
  const translated = english && l.en;
  const cls = ['line', `k-${l.kind}`, l.verdict && `v-${l.verdict}`, l.signal && 'signal'].filter(Boolean).join(' ');
  const tick = l.verdict === 'human' ? '<span class="tick" aria-hidden="true">✓</span>' : '';
  const flag = l.verified === false ? '<span class="flag" title="Not found word-for-word in the ad">not a verbatim quote</span>' : '';
  const other = translated ? l.text : l.en;
  const en = other && l.kind !== 'heading' ? `<div class="alt"><b>${translated ? 'Original' : 'English'}:</b> ${esc(other)}</div>` : '';
  const how = l.how ? `<div class="how"><b>How:</b> ${esc(l.how)}</div>` : '';
  const share = l.kind === 'task' && l.time_share ? `<span class="week-share">≈ ${esc(l.time_share)}% of the week</span>` : '';
  const note = l.note && (l.kind === 'task' || l.signal) ? `${l.verdict === 'human' ? '' : '→ '}${esc(l.note)}` : '';
  return `<li class="${cls}"><div class="txt">${tick}<span class="t">${esc(translated ? l.en : l.text)}</span>${flag}${en}${how}${share}</div><div class="margin">${note}</div></li>`;
}

function langName(code) {
  return { fi: 'Finnish', sv: 'Swedish', de: 'German', et: 'Estonian' }[code] || code?.toUpperCase() || 'original';
}

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the toggle still works for this page.
  }
}

function readJson(key) {
  try {
    return JSON.parse(readPref(key, '{}')) || {};
  } catch {
    return {};
  }
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function metaLine(ad, a) {
  const parts = [];
  const loc = ad.location || a.location;
  if (loc) parts.push(esc(loc));
  if (ad.datePosted) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(ad.datePosted)) / 86400000));
    const fresh = days <= 14;
    parts.push(`<span class="badge ${fresh ? '' : 'old'}">${fresh ? `Posted ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}: still hiring` : `Posted ${days} days ago: may be filled`}</span>`);
  }
  if (ad.validThrough) parts.push(`Applications close ${formatDate(ad.validThrough)}`);
  if (ad.url) parts.push(`<a href="${esc(ad.url)}" target="_blank" rel="noopener">Original ad ↗</a>`);
  else if (ad.source) parts.push(esc(ad.source === 'sample' ? 'Sample ad (fictional company)' : 'Pasted text'));
  return parts.join('<span class="muted">·</span>');
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1400);
}

// ---------- radar ----------
const radarForm = $('#radar-form');
$('#radar-chips').innerHTML = RADAR_CHIPS.map(([fi, en]) => `<button type="button" class="chip" data-q="${esc(fi)}" title="${esc(fi)}">${esc(en)}</button>`).join('');
$('#radar-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  radarForm.q.value = chip.dataset.q;
  radarForm.requestSubmit();
});
let radarJobs = [];
radarForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = radarForm.q.value.trim();
  const out = $('#radar-results');
  out.innerHTML = '<p class="radar-meta">Searching Duunitori…</p>';
  try {
    const { count, jobs } = await api(`/api/radar?q=${encodeURIComponent(q)}`);
    radarJobs = jobs;
    out.innerHTML = jobs.length
      ? `<p class="radar-meta">${plural(count, 'live ad')} · most hand-work first</p>
         <ul class="radar-list">${jobs.map(jobHtml).join('')}</ul>`
      : `<p class="empty">No live ads match "${esc(q)}". Try a job title in Finnish, like "laskuttaja".</p>`;
  } catch (err) {
    out.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
});
$('#radar-results').addEventListener('click', (e) => {
  const i = e.target.closest('[data-job]')?.dataset.job;
  if (i === undefined) return;
  const job = radarJobs[Number(i)];
  showTab('markup');
  form.url.value = job.url;
  form.text.value = '';
  analyze({ text: job.text, meta: { title: job.title, company: job.company, location: job.location, datePosted: job.datePosted, url: job.url, source: 'duunitori' } });
});

function jobHtml(job, i) {
  const days = Math.floor((Date.now() - new Date(job.datePosted)) / 86400000);
  return `<li class="card job">
    <div>
      <div class="eyebrow">${esc(job.company)}</div>
      <div class="job-title">${esc(job.titleEn || job.title)}</div>
      ${job.titleEn ? `<div class="muted small">${esc(job.title)}</div>` : ''}
      <div class="meta-line">${esc(job.location || '')}<span class="muted">·</span>${days <= 0 ? 'today' : `${plural(days, 'day')} ago`}</div>
      ${job.signals.length ? `<div class="chips">${job.signals.map((s) => `<span class="chip red">${esc(s)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="job-actions">
      <a href="${esc(job.url)}" target="_blank" rel="noopener">Open ad ↗</a>
      <button class="btn primary small" data-job="${i}">Mark up →</button>
    </div>
  </li>`;
}

// ---------- history ----------
async function renderHistory() {
  const out = $('#history');
  const runs = await api('/api/runs').catch(() => []);
  if (!runs.length) {
    out.innerHTML = '<p class="empty">Nothing marked up yet.</p>';
    return;
  }
  const send = runs.filter((r) => r.verdict?.value === 'send').length;
  const skip = runs.filter((r) => r.verdict?.value === 'skip').length;
  out.innerHTML = `
    <div class="hit">
      <div><b>${runs.length}</b><span>ads marked up</span></div>
      <div><b>${send}</b><span>would send</span></div>
      <div><b>${skip}</b><span>skipped</span></div>
      <div><b>${send + skip ? Math.round((send / (send + skip)) * 100) + '%' : '–'}</b><span>hit rate</span></div>
    </div>
    <table>
      <thead><tr><th>Company</th><th>Role</th><th>Repetitive</th><th>Your call</th><th>Date</th></tr></thead>
      <tbody>${runs
        .map(
          (r) => `<tr data-id="${esc(r.id)}">
            <td>${esc(r.company)}</td><td>${esc(r.role)}</td><td>${r.percent}%</td>
            <td class="${r.verdict ? `v-${r.verdict.value}` : 'muted'}">${r.verdict ? (r.verdict.value === 'send' ? 'Would send' : 'Skip') : '–'}</td>
            <td class="muted">${formatDate(r.createdAt)}</td></tr>`,
        )
        .join('')}</tbody>
    </table>`;
}
$('#history').addEventListener('click', async (e) => {
  const id = e.target.closest('tr[data-id]')?.dataset.id;
  if (!id) return;
  showTab('markup');
  await loadRun(id);
  history.pushState({}, '', `/?run=${id}`);
});

async function refreshPill() {
  const runs = await api('/api/runs').catch(() => []);
  $('#stats-pill').textContent = runs.length ? `(${runs.length})` : '';
}

async function loadRun(id, opts) {
  try {
    renderResult(await api(`/api/runs/${encodeURIComponent(id)}`), opts);
  } catch (err) {
    showError(`Could not load that ad: ${err.message}`);
  }
}

// ---------- start ----------
const shareId = location.pathname.match(/^\/r\/([\w-]+)/)?.[1];
if (shareId) {
  document.body.classList.add('share');
  loadRun(shareId, { share: true });
} else {
  refreshPill();
  const runId = new URLSearchParams(location.search).get('run');
  if (runId) loadRun(runId);
}
