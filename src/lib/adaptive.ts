// ─── BrainBolt Adaptive Engine ──────────────────────────────────────────────
// Implements hysteresis-based difficulty adjustment, score calculation,
// and question selection per LLD §6-7.

import { createHash } from 'crypto';
import {
  type UserState,
  type AnswerResponse,
  type AnswerLog,
  type ProcessAnswerResult,
  getOrCreateUser,
  pushRecentResult,
  markQuestionAnswered,
  clearAnsweredIds,
  updateUser,
  toPublicUserState,
  processAnswerAtomic,
  saveUser,
} from "./store";

import { getQuestionById, type Question, getAllQuestions } from "./questions";
import { nanoid } from "nanoid";

// ─── Rolling Accuracy ───────────────────────────────────────────────────────

/**
 * Compute accuracy from the rolling recentResults window.
 * Returns at minimum 0.1 to prevent zero-score on correct answers.
 */
function rollingAccuracy(user: UserState): number {
  const results = user.recentResults;
  if (results.length === 0) return 1.0;

  const correct = results.filter(Boolean).length;
  const accuracy = correct / results.length;
  return Math.max(0.1, accuracy);
}

// ─── Score Calculation ──────────────────────────────────────────────────────

/**
 * Compute score delta for a correct answer.
 *   scoreDelta = base * multiplier * accuracy
 *   base       = difficulty * 10
 *   multiplier = min(4.0, 1.0 + streak * 0.25)  (capped at 4×)
 *   accuracy   = rollingAccuracy(last 10)
 */
function calculateScore(user: UserState): number {
  const base = user.difficulty * 10;
  const multiplier = Math.min(4.0, 1.0 + user.streak * 0.25);
  const accuracy = rollingAccuracy(user);
  return base * multiplier * accuracy;
}

// ─── Process Answer ─────────────────────────────────────────────────────────

/**
 * Core adaptive algorithm: process a user's answer.
 *
 * The scoring/hysteresis logic is a *pure* function of the locked UserState — it
 * mutates the state and builds the response + answer log, but does no I/O. The
 * store runs it inside a single Postgres transaction (score, answer_log, and the
 * idempotency key commit together), so the returned result may be a normal `ok`,
 * an idempotent `replay`, or a `conflict` (optimistic-lock mismatch → 409).
 */
export async function processAnswer(
  userId: string,
  questionId: string,
  selectedIndex: number,
  idempotencyKey: string,
  expectedVersion: number | undefined
): Promise<ProcessAnswerResult> {
  const question = getQuestionById(questionId);
  if (!question) {
    throw new Error(`Question not found: ${questionId}`);
  }

  if (selectedIndex < 0 || selectedIndex >= question.choices.length) {
    throw new Error(`Invalid selectedIndex: ${selectedIndex}`);
  }

  return processAnswerAtomic(userId, idempotencyKey, expectedVersion, (user) => {
    // Verify answer using hash
    const expectedHash = createHash('sha256')
      .update(String(selectedIndex))
      .digest('hex')
      .substring(0, 16);
    const correct = expectedHash === question.correctAnswerHash;

    let scoreDelta = 0;

    if (correct) {
      // ── Streak ──
      user.streak += 1;
      user.maxStreak = Math.max(user.maxStreak, user.streak);

      // ── Hysteresis: raise difficulty only with sustained performance ──
      user.confidence = Math.min(10, user.confidence + 1);
      if (user.confidence >= 7) {
        user.difficulty = Math.min(10, user.difficulty + 1);
        user.confidence = 5; // reset after level change
      }

      // ── Push result BEFORE calculating score so it's included in accuracy ──
      pushRecentResult(user, true);

      // ── Score: difficulty × streak multiplier × rolling accuracy (LLD §7) ──
      scoreDelta = calculateScore(user);
      user.totalScore += scoreDelta;
    } else {
      // ── Streak hard reset ──
      user.streak = 0;

      // ── Hysteresis: lower difficulty (drops faster: -2) ──
      user.confidence = Math.max(0, user.confidence - 2);
      if (user.confidence <= 3) {
        user.difficulty = Math.max(1, user.difficulty - 1);
        user.confidence = 5; // reset after level change
      }

      pushRecentResult(user, false);
      scoreDelta = 0;
    }

    // Mark question as answered
    markQuestionAnswered(user, questionId);

    // Increment state version for optimistic locking
    user.stateVersion += 1;

    // Update lastAnswerAt timestamp
    user.lastAnswerAt = Date.now();

    const log: AnswerLog = {
      id: nanoid(),
      userId: user.userId,
      questionId,
      difficulty: question.difficulty,
      answer: selectedIndex,
      correct,
      scoreDelta,
      streakAtAnswer: user.streak,
      answeredAt: Date.now(),
    };

    const response: AnswerResponse = {
      correct,
      correctIndex: question.correctIndex,
      scoreDelta,
      userState: toPublicUserState(user),
      stateVersion: user.stateVersion,
    };

    return { response, log };
  });
}

// ─── Get Next Question ──────────────────────────────────────────────────────

export interface NextQuestionResult {
  question: {
    id: string;
    text: string;
    choices: string[];
    difficulty: number;
    category: string;
  };
  userState: {
    difficulty: number;
    streak: number;
    totalScore: number;
    maxStreak: number;
  };
  stateVersion: number;
}

/**
 * Pick the next question for a user based on adaptive difficulty.
 *
 * Selection strategy:
 *   1. Filter unanswered questions within ±1 of user.difficulty
 *   2. If empty → try exact difficulty only (fallback per user requirement)
 *   3. If still empty → clear answeredIds, widen to ±2
 *   4. Among candidates, prefer exact match (70%) vs ±1 (30%)
 *
 * Returns null if absolutely no questions can be found.
 */
export async function getNextQuestion(userId: string): Promise<NextQuestionResult | null> {
  const user = await getOrCreateUser(userId);
  
  // ── Inactivity Check: Decay streak after 30 minutes of inactivity ──
  const INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();
  if (user.lastAnswerAt && (now - user.lastAnswerAt) > INACTIVITY_THRESHOLD_MS) {
    if (user.streak > 0) {
      user.streak = Math.floor(user.streak / 2);
      user.confidence = Math.max(0, user.confidence - 1);
      // Log decay event
      console.log(`[StreakDecay] userId=${userId} streak halved to ${user.streak}`);
    }
    user.lastAnswerAt = now;
    await saveUser(user);
  }
  
  const allQuestions = getAllQuestions();

  // Helper: filter unanswered questions within a difficulty band
  const filterCandidates = (band: number): Question[] =>
    allQuestions.filter(
      (q) =>
        Math.abs(q.difficulty - user.difficulty) <= band &&
        !user.answeredIds.has(q.id)
    );

  // Step 1: ±1 band, unanswered only
  let candidates = filterCandidates(1);

  // Step 2: Fallback — exact difficulty only (unanswered)
  if (candidates.length === 0) {
    candidates = allQuestions.filter(
      (q) => q.difficulty === user.difficulty && !user.answeredIds.has(q.id)
    );
  }

  // Step 3: Still empty — clear answered set and widen to ±2
  if (candidates.length === 0) {
    clearAnsweredIds(user);
    candidates = filterCandidates(2);
  }

  // Step 4: Truly exhausted — should not happen with 20 questions
  if (candidates.length === 0) {
    return null;
  }

  // Step 5: Weighted selection — 70% exact match, 30% ±1
  const exactMatch = candidates.filter(
    (q) => q.difficulty === user.difficulty
  );

  let selected: Question;
  if (exactMatch.length > 0 && Math.random() < 0.7) {
    selected = exactMatch[Math.floor(Math.random() * exactMatch.length)];
  } else {
    selected = candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Update last question tracking
  user.lastQuestionId = selected.id;
  await updateUser(user);

  // Return question WITHOUT correctIndex (never sent to client)
  return {
    question: {
      id: selected.id,
      text: selected.text,
      choices: selected.choices,
      difficulty: selected.difficulty,
      category: selected.category,
    },
    userState: {
      difficulty: user.difficulty,
      streak: user.streak,
      totalScore: user.totalScore,
      maxStreak: user.maxStreak,
    },
    stateVersion: user.stateVersion,
  };
}
