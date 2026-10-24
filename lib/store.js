// Every marked-up ad is saved as a JSON file in data/runs. That gives us a history,
// a share link per ad, a fallback when the wifi dies mid-demo, and an honest hit rate.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const DIR = join(import.meta.dirname, '..', 'data', 'runs');

export async function saveRun(run) {
  await mkdir(DIR, { recursive: true });
  const id = run.id || `${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`;
  const full = { ...run, id };
  await writeFile(join(DIR, `${id}.json`), JSON.stringify(full, null, 2));
  return full;
}

export async function getRun(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export async function listRuns() {
  let files = [];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const runs = await Promise.all(files.map((f) => getRun(f.replace(/\.json$/, ''))));
  return runs.filter(Boolean).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Only these fields can be changed after a run is created.
export async function updateRun(id, patch) {
  const run = await getRun(id);
  if (!run) return null;
  if (patch.verdict !== undefined) run.verdict = patch.verdict;
  if (patch.assumptions !== undefined) run.assumptions = patch.assumptions;
  run.updatedAt = new Date().toISOString();
  return saveRun(run);
}
