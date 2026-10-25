# ✎ Red Pen

**Every job ad is a budget that's already approved.**

Red Pen takes a company's job ad and marks it up like a consultant with a red pen:
it strikes through the work that could run automatically, underlines what AI could
draft, ticks what stays human, and shows the math. Then it drafts a short note to
the person who owns that budget. Built for the Velho challenge at the Prompt
Operations Hackathon (Oct 2026).

## Run it

Needs Node.js 20.12 or newer and nothing else (no `npm install`).

```bash
cp .env.example .env      # then put an OpenRouter key in it
node server.js            # http://localhost:3100
```

`node --watch server.js` restarts on file changes. Without a key, only
"Try the sample ad" works (it loads a saved result). Your name, the model, and the
email's language and tone are under the gear, top right (saved in the browser).

## How it works

```
job ad link / pasted text / Radar result
        │
        ▼
lib/sources.js    reads the ad (schema.org JobPosting on the page, or plain text)
        │
        ▼
lib/analyze.js    ONE model call: quote the ad line by line, mark each task
                  automate / assist / human, estimate its share of the week,
                  suggest who owns the budget, draft an email with {{placeholders}}
        │         then: every quote is checked word-for-word against the ad
        ▼
public/economics.js   plain arithmetic: % of the week, hours, €, multiplier
        │             (same file runs in the browser, so edits recompute live)
        ▼
data/runs/<id>.json   every result is saved: history, share link, hit rate,
                      and a fallback if the wifi dies mid-demo
```

| File | What it does |
|---|---|
| `server.js` | Tiny HTTP server, API routes, static files |
| `lib/sources.js` | Reads ads from links, pasted text and the Duunitori search API |
| `lib/analyze.js` | The prompt and the OpenRouter call, quote verification |
| `lib/contact.js` | Finds who to email (runs after each markup): a web search, each address checked against its page |
| `lib/store.js` | Saves runs as JSON files in `data/runs` |
| `public/economics.js` | The numbers. Shared by server and browser |
| `public/app.js`, `app.css`, `index.html` | The whole UI |
| `samples/` | A fictional sample ad and its saved result |

API: `POST /api/analyze`, `GET /api/radar?q=`, `POST /api/scan`, `GET /api/runs`, `GET /api/config`,
`GET|PATCH /api/runs/:id`, `POST /api/runs/:id/contact`. Share view: `/r/:id`.

**Radar Scan.** After a search, "Scan these ads" sends every listed ad to the fast model
(`OPENROUTER_FAST_MODEL`, Haiku by default), six at a time. It judges only the tasks, by the
same rules as a full markup, and the % comes from the same `economics.js` arithmetic. It's an
estimate (a few points off the full markup), costs about $0.01 for 40 ads and takes
~15 s. When it finishes, the list sorts by % and filters to ≥50% repetitive; the filter
can be changed. Scores are cached in memory by ad URL until the server restarts.
