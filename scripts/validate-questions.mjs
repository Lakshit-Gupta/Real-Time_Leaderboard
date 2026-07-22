// Validate + dedupe the rich MCQ dataset (src/data/questions/*.json).
// Run each batch: `npm run questions:validate`.
// Hard failures (schema / duplicate id) exit non-zero so CI can gate on it.
// Near-duplicate pairs are reported as warnings for manual differentiation.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'questions');
const REQUIRED = ['id', 'level', 'category', 'topic', 'difficulty', 'question', 'options', 'correctAnswer', 'explanation', 'source', 'tags', 'company', 'estimatedTime'];
const LABELS = ['Easy', 'Medium', 'Hard'];
const BANDS = { Easy: [1, 4], Medium: [5, 7], Hard: [8, 10] };

function hashInt(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
function engineDifficulty(label, id) {
  const [lo, hi] = BANDS[label];
  return lo + (hashInt(id) % (hi - lo + 1));
}
function trigrams(s) {
  const t = s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const g = new Set();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
}
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

const errors = [];
const all = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`);
    continue;
  }
  if (!Array.isArray(rows)) { errors.push(`${file}: top level must be an array`); continue; }
  rows.forEach((q, i) => {
    const where = `${file}[${i}] (${q?.id ?? '?'})`;
    for (const k of REQUIRED) if (!(k in q)) errors.push(`${where}: missing field "${k}"`);
    if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`${where}: options must have exactly 4 entries`);
    else if (new Set(q.options).size !== 4) errors.push(`${where}: options must be 4 distinct strings`);
    if (!Number.isInteger(q.correctAnswer) || q.correctAnswer < 0 || q.correctAnswer > 3) errors.push(`${where}: correctAnswer must be 0–3`);
    if (!LABELS.includes(q.difficulty)) errors.push(`${where}: difficulty must be Easy|Medium|Hard`);
    if (!Number.isFinite(q.estimatedTime) || q.estimatedTime <= 0) errors.push(`${where}: estimatedTime must be > 0`);
    if (typeof q.question !== 'string' || q.question.length < 10) errors.push(`${where}: question text too short`);
    if (typeof q.explanation !== 'string' || q.explanation.length < 10) errors.push(`${where}: explanation too short`);
    all.push({ ...q, _file: file });
  });
}

// Duplicate ids (hard failure)
const seen = new Map();
for (const q of all) {
  if (seen.has(q.id)) errors.push(`duplicate id "${q.id}" in ${q._file} and ${seen.get(q.id)}`);
  else seen.set(q.id, q._file);
}

// Near-duplicate detection (warning)
const grams = all.map((q) => ({ id: q.id, g: trigrams(q.question) }));
const dupPairs = [];
for (let i = 0; i < grams.length; i++)
  for (let j = i + 1; j < grams.length; j++) {
    const sim = jaccard(grams[i].g, grams[j].g);
    if (sim > 0.8) dupPairs.push(`${grams[i].id} ~ ${grams[j].id} (${sim.toFixed(2)})`);
  }

// Stats
const byLevel = {}, byCategory = {}, byTopic = {}, byLabel = { Easy: 0, Medium: 0, Hard: 0 };
const band = Object.fromEntries(Array.from({ length: 10 }, (_, k) => [k + 1, 0]));
for (const q of all) {
  byLevel[q.level] = (byLevel[q.level] || 0) + 1;
  byCategory[q.category] = (byCategory[q.category] || 0) + 1;
  byTopic[q.topic] = (byTopic[q.topic] || 0) + 1;
  if (LABELS.includes(q.difficulty)) byLabel[q.difficulty]++;
  band[engineDifficulty(q.difficulty, q.id)]++;
}

console.log(`\n=== BrainBolt question dataset ===`);
console.log(`Total questions: ${all.length}`);
console.log(`\nBy category:`);
for (const [k, v] of Object.entries(byCategory).sort()) console.log(`  ${k}: ${v}`);
console.log(`\nDifficulty label split: Easy ${byLabel.Easy}  Medium ${byLabel.Medium}  Hard ${byLabel.Hard}`);
console.log(`Engine band spread (1–10): ${Object.entries(band).map(([k, v]) => `${k}:${v}`).join('  ')}`);
const emptyBands = Object.entries(band).filter(([, v]) => v === 0).map(([k]) => k);
if (emptyBands.length) console.log(`  ⚠ empty engine bands: ${emptyBands.join(', ')} (adaptive engine will widen/recycle until filled)`);

if (dupPairs.length) {
  console.log(`\n⚠ ${dupPairs.length} near-duplicate pair(s) > 0.80 similarity (review):`);
  dupPairs.slice(0, 40).forEach((p) => console.log(`  ${p}`));
}

if (errors.length) {
  console.error(`\n✘ ${errors.length} hard error(s):`);
  errors.slice(0, 60).forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}
console.log(`\n✔ schema valid, ${seen.size} unique ids, 0 hard errors\n`);
