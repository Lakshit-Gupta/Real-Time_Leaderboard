// ─── BrainBolt Question Bank (loader) ───────────────────────────────────────
// The durable dataset lives as rich JSON shards in src/data/questions/, one per
// subject level, in an interview-prep schema (question/options/correctAnswer +
// explanation/source/tags/company/…). This module maps each rich row down to the
// engine's frozen `Question` shape and exposes the accessors the adaptive engine,
// answer route, and store consume. Nothing downstream knows about the rich schema.
//
// Why a mapping layer: the engine's numeric `difficulty` is baked to INTEGER 1–10
// across the DB (answer_log, user_state CHECK), the metrics histogram, and the CSS
// level ramp. The rich schema's `level` (1–20 subject) and Easy/Med/Hard label are
// orthogonal to that skill band — so we derive a 1–10 difficulty here (see
// engineDifficulty) and leave the engine untouched.

import { createHash } from 'crypto';
import { rawQuestions } from '../data/questions';

// ─── Engine-facing type (consumed by adaptive.ts, store.ts, answer route) ─────

export interface Question {
  id: string;
  text: string;
  choices: string[];
  correctIndex: number;
  difficulty: number; // 1–10 skill band (derived; NOT the subject level)
  category: string;
  correctAnswerHash: string;
}

// ─── Authoring type (shape of every row in the JSON shards) ───────────────────

export type DifficultyLabel = 'Easy' | 'Medium' | 'Hard';

export interface RawQuestion {
  id: string;
  level: string;          // e.g. "Level 1"
  category: string;       // e.g. "Operating Systems"
  topic: string;          // e.g. "Deadlock"
  difficulty: DifficultyLabel;
  question: string;
  options: string[];      // exactly 4
  correctAnswer: number;  // 0–3
  explanation: string;
  source: string;
  tags: string[];
  company: string[];
  estimatedTime: number;
}

// ─── Hash helper (must match the verify path in adaptive.ts) ──────────────────

function hashCorrectIndex(index: number): string {
  return createHash('sha256').update(String(index)).digest('hex').substring(0, 16);
}

// ─── Difficulty mapping: Easy/Med/Hard label → integer 1–10 skill band ────────
// Deterministic per-id spread so every band fills as the bank grows (the engine
// picks unanswered questions within ±1 of the user's band — empty bands starve it).
// ponytail: hash-spread over a stable id; validator prints the 1-10 histogram to
// confirm no band is starved. Upgrade path: store an explicit engine difficulty
// per row if we ever want hand-tuned placement.

const BANDS: Record<DifficultyLabel, [number, number]> = {
  Easy: [1, 4],
  Medium: [5, 7],
  Hard: [8, 10],
};

function hashInt(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function engineDifficulty(label: DifficultyLabel, id: string): number {
  const [lo, hi] = BANDS[label];
  return lo + (hashInt(id) % (hi - lo + 1));
}

// ─── Map + load ───────────────────────────────────────────────────────────────

function mapToEngine(r: RawQuestion): Question {
  return {
    id: r.id,
    text: r.question,
    choices: r.options,
    correctIndex: r.correctAnswer,
    difficulty: engineDifficulty(r.difficulty, r.id),
    category: r.category,
    correctAnswerHash: hashCorrectIndex(r.correctAnswer),
  };
}

const allQuestions: Question[] = rawQuestions.map(mapToEngine);
validateBank(allQuestions);

// ─── Load-time self-check (a bad row fails `npm run build`) ────────────────────

export function validateBank(bank: Question[]): void {
  const ids = new Set<string>();
  for (const q of bank) {
    if (ids.has(q.id)) throw new Error(`[questions] duplicate id ${q.id}`);
    ids.add(q.id);
    if (q.choices.length !== 4) throw new Error(`[questions] ${q.id} must have 4 choices`);
    if (new Set(q.choices).size !== 4) throw new Error(`[questions] ${q.id} has duplicate choices`);
    if (!(q.correctIndex >= 0 && q.correctIndex < 4)) throw new Error(`[questions] ${q.id} bad correctIndex`);
    if (!(Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 10))
      throw new Error(`[questions] ${q.id} difficulty must be integer 1–10`);
    if (q.correctAnswerHash !== hashCorrectIndex(q.correctIndex))
      throw new Error(`[questions] ${q.id} hash mismatch`);
  }
}

// ─── Accessors (unchanged contract) ───────────────────────────────────────────

/** Return all questions (immutable reference). */
export function getAllQuestions(): readonly Question[] {
  return allQuestions;
}

/** Look up a single question by id. Returns undefined if not found. */
export function getQuestionById(id: string): Question | undefined {
  return allQuestions.find((q) => q.id === id);
}

/** Return questions within ±band of the target difficulty (adaptive selection). */
export function getQuestionsByDifficulty(target: number, band: number = 1): Question[] {
  return allQuestions.filter((q) => Math.abs(q.difficulty - target) <= band);
}
