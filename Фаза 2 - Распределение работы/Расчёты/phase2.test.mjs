import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../../lib/md.mjs';
import { buildProblem, solveGlpk, bruteForce, evaluate, aggregateComplexity, lpText } from './phase2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = readJson(path.join(here, '..', 'Данные', 'задачи и оценки.json'));

test('сложность — медиана второго тура Дельфи', () => {
  const c = aggregateComplexity(data);
  assert.equal(c.length, data.tasks.length);
  assert.equal(c[1], 6); // 6, 6, 7 → 6
});

test('GLPK находит оптимум, подтверждённый полным перебором; ограничения выполнены', async () => {
  const P = buildProblem(data);
  const sol = await solveGlpk(P);
  const brute = bruteForce(P);
  assert.ok(Math.abs(sol.objective - brute.objective) < 1e-9);
  const ev = evaluate(P, sol.assign);
  assert.ok(ev.ok);
  assert.equal(ev.load.reduce((s, x) => s + x, 0), P.total);
});

test('при недостижимом балансе решения нет', async () => {
  const strict = structuredClone(data);
  strict.model.balanceTolerance = 0; // C = 46 не делится на 3 поровну
  const P = buildProblem(strict);
  assert.equal(bruteForce(P).objective, undefined);
  await assert.rejects(() => solveGlpk(P));
});

test('LP-модель содержит все переменные и ограничения', () => {
  const lp = lpText(buildProblem(data));
  assert.match(lp, /^Maximize/m);
  assert.equal((lp.match(/^ assign_/gm) || []).length, data.tasks.length);
  assert.match(lp, /x_3_12/);
});
