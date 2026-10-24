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

API: `POST /api/analyze`, `GET /api/radar?q=`, `GET /api/runs`, `GET /api/config`,
`GET|PATCH /api/runs/:id`, `POST /api/runs/:id/contact`. Share view: `/r/:id`.

## Answers to the questions judges will ask

**"Why can't I just paste the ad into ChatGPT?"**
You'd get a paragraph of opinions. Red Pen gives a consistent artifact a CEO can
read in five seconds (the marked-up ad), numbers you can defend because they are
arithmetic on stated assumptions, quotes that are checked against the source, a
Radar that finds the ads for you, and a log that tells you which outputs were
good enough to send.

**"Where does the 69% come from?"**
The model only does what it is good at: reading each task and estimating its share
of the week. The % is computed in `economics.js`: automatic tasks free 80% of their
time, AI-assisted 40%, human 0%. All of it is visible and editable under
"How we got these numbers", and the stamp updates live.

**"And the €?"**
Salary from the ad if it is there (green tag), otherwise an estimate (amber tag)
that you can overwrite. × 12.5 months (holiday pay) × 1.22 employer costs.

**"Isn't this telling a CEO not to hire?"**
No. The framing is "your next hire spends more time on the work you hired them
for". The prompt forbids "replace" and "don't hire", and the multiplier
(1 ÷ (1 − time freed)) puts it in exactly those terms.

**"Who do we send it to? HR posted the ad."**
The budget owner for that team (CFO for finance, Sales Director for sales
support, ...). The model gives a role and a reason, never a person's name.

**"Finnish ads?"**
They are the default. Lines stay in Finnish (that's the point: it's their own
ad), margin notes are in English, "Show English" adds translations, and the
email can be written in Finnish.

**"What about a vague ad, or a recruitment agency?"**
Red Pen says so: a "Not worth sending" banner when there is too little repetitive
work, and "Outside Velho's sweet spot" for agencies, startups and public bodies.
Saying no is part of being credible.

**"The ad is two weeks old, did they already hire?"**
The posting date and closing date are shown, with a "still hiring" or
"may be filled" badge. Radar sorts by hand-work and freshness.

**"Does it actually work?"**
History counts every ad marked up and your "would send / skip" call on each:
that's the hit rate. Fill it up before judging.

## Rules we keep

- Nothing is ever sent. Emails are drafts; the To: link only opens your mail app.
- An address is shown only if it was seen on a page (checked by the server) or built from the
  company's published format, and the UI says which.
- No contacting real companies, no publishing in Velho's name.
- The ad text is treated as untrusted data in the prompt.

## Ideas for next

- Watch Radar every morning and send the best 5 fresh ads to Slack.
- Second "lens": the CEO's own words from the annual report.
- Export the marked-up page as an image for LinkedIn or a postcard.
- Learn from verdicts: feed skipped examples back into the prompt.

## Costs

About 30 s and $0.06 per ad with `anthropic/claude-sonnet-5.5`, so one $20
team credit covers ~300 ads. Pick another model in Settings, or change the default with `OPENROUTER_MODEL`.
The email search after each markup runs on the fast model (`OPENROUTER_FAST_MODEL`, default Haiku):
about 10 s and $0.01–0.04 per ad, saved with the run so it runs once.
