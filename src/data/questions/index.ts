// ─── Question dataset barrel ────────────────────────────────────────────────
// Concatenates every level shard into one raw array consumed by src/lib/questions.ts.
// Add one import + spread line per new level shard as batches land.

import type { RawQuestion } from '../../lib/questions';
import level01 from './level-01-cs-fundamentals.json';
import level02 from './level-02-languages.json';
import level03 from './level-03-dsa.json';
import level04 from './level-04-system-design.json';
import level05 from './level-05-cloud-devops.json';
import level06 from './level-06-backend.json';
import level07 from './level-07-frontend.json';
import level08 from './level-08-ai-ml.json';
import level09 from './level-09-git.json';
import level10 from './level-10-linux.json';
import level11 from './level-11-sql.json';
import level12 from './level-12-aptitude.json';
import level13 from './level-13-hr.json';
import level14 from './level-14-behavioral.json';
import level15 from './level-15-company-specific.json';
import level16 from './level-16-resume-screening.json';
import level17 from './level-17-debugging.json';
import level18 from './level-18-predict-output.json';
import level19 from './level-19-code-review.json';
import level20 from './level-20-security.json';

export const rawQuestions: RawQuestion[] = [
  ...(level01 as unknown as RawQuestion[]),
  ...(level02 as unknown as RawQuestion[]),
  ...(level03 as unknown as RawQuestion[]),
  ...(level04 as unknown as RawQuestion[]),
  ...(level05 as unknown as RawQuestion[]),
  ...(level06 as unknown as RawQuestion[]),
  ...(level07 as unknown as RawQuestion[]),
  ...(level08 as unknown as RawQuestion[]),
  ...(level09 as unknown as RawQuestion[]),
  ...(level10 as unknown as RawQuestion[]),
  ...(level11 as unknown as RawQuestion[]),
  ...(level12 as unknown as RawQuestion[]),
  ...(level13 as unknown as RawQuestion[]),
  ...(level14 as unknown as RawQuestion[]),
  ...(level15 as unknown as RawQuestion[]),
  ...(level16 as unknown as RawQuestion[]),
  ...(level17 as unknown as RawQuestion[]),
  ...(level18 as unknown as RawQuestion[]),
  ...(level19 as unknown as RawQuestion[]),
  ...(level20 as unknown as RawQuestion[]),
];
