import test from 'node:test';
import assert from 'node:assert/strict';
import { triangle, vertexDistance, fuzzyTopsis, rank } from '../lib/topsis.mjs';
import {
  parseSaaty, buildMatrix, consistency, geometricMeanMatrix, assertReciprocal, collectiveAhp, inconsistentPairs,
} from '../lib/ahp.mjs';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

// ---------- TOPSIS

test('тройка — минимум, медиана, максимум (не среднее)', () => {
  assert.deepEqual(triangle([1, 9, 2]), [1, 2, 9]);
  assert.deepEqual(triangle([5, 5, 3]), [3, 5, 5]);
  assert.throws(() => triangle([1, 2]));
});

test('вершинное расстояние', () => {
  near(vertexDistance([1, 1, 1], [0, 0, 0]), 1);
  near(vertexDistance([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 0);
});

const one = (type) => [{ id: 'K', type }];
const allSame = (v) => ({ E1: v, E2: v, E3: v });

test('ручной пример TOPSIS: CC = 1 и 1/3', () => {
  const res = fuzzyTopsis({
    experts: ['E1', 'E2', 'E3'], criteria: one('benefit'), alternatives: ['A', 'B'],
    importance: allSame({ K: 9 }),
    ratings: allSame({ A: { K: 9 }, B: { K: 3 } }),
  });
  near(res.result[0].cc, 1);
  near(res.result[1].cc, 1 / 3);
  assert.deepEqual(res.result.map((r) => r.rank), [1, 2]);
});

test('критерий затрат: меньшая трудоёмкость лучше, тройка нормируется по возрастанию', () => {
  const res = fuzzyTopsis({
    experts: ['E1', 'E2', 'E3'], criteria: one('cost'), alternatives: ['Лёгкий', 'Трудный'],
    importance: allSame({ K: 9 }),
    ratings: { E1: { Лёгкий: { K: 2 }, Трудный: { K: 7 } }, E2: { Лёгкий: { K: 3 }, Трудный: { K: 9 } }, E3: { Лёгкий: { K: 1 }, Трудный: { K: 8 } } },
  });
  const [l, m, u] = res.normalized['Трудный'].K;
  assert.ok(l <= m && m <= u);
  near(res.normalized['Лёгкий'].K[2], 1); // l⁻ / l = 1/1
  assert.ok(res.result[0].cc > res.result[1].cc);
});

test('одинаковые оценки дают одинаковые CC; CC в [0; 1]; доминирующая альтернатива первая', () => {
  const criteria = [{ id: 'K1', type: 'benefit' }, { id: 'K2', type: 'cost' }];
  const same = fuzzyTopsis({
    experts: ['E1', 'E2', 'E3'], criteria, alternatives: ['A', 'B'],
    importance: allSame({ K1: 5, K2: 7 }), ratings: allSame({ A: { K1: 4, K2: 4 }, B: { K1: 4, K2: 4 } }),
  });
  near(same.result[0].cc, same.result[1].cc);
  const dom = fuzzyTopsis({
    experts: ['E1', 'E2', 'E3'], criteria, alternatives: ['A', 'B'],
    importance: { E1: { K1: 5, K2: 7 }, E2: { K1: 9, K2: 2 }, E3: { K1: 6, K2: 6 } },
    ratings: { E1: { A: { K1: 8, K2: 2 }, B: { K1: 6, K2: 5 } }, E2: { A: { K1: 7, K2: 3 }, B: { K1: 5, K2: 6 } }, E3: { A: { K1: 9, K2: 1 }, B: { K1: 4, K2: 4 } } },
  });
  for (const r of dom.result) assert.ok(r.cc >= 0 && r.cc <= 1);
  assert.equal(dom.result[0].rank, 1);
});

test('некорректные входы TOPSIS отклоняются', () => {
  const base = { experts: ['E1', 'E2', 'E3'], criteria: one('benefit'), alternatives: ['A'], importance: allSame({ K: 5 }) };
  assert.throws(() => fuzzyTopsis({ ...base, ratings: allSame({ A: { K: 0 } }) }), /1–9/);
  assert.throws(() => fuzzyTopsis({ ...base, ratings: allSame({ A: { K: 4.5 } }) }), /целое/);
  assert.throws(() => fuzzyTopsis({ ...base, ratings: { E1: { A: { K: 5 } }, E2: { A: { K: 5 } } } }), /E3/);
  assert.throws(() => fuzzyTopsis({ ...base, experts: ['E1', 'E2'], ratings: allSame({ A: { K: 5 } }) }), /три/);
});

test('ранги с равенством', () => {
  assert.deepEqual(rank([0.5, 0.7, 0.5, 0.1]), [2, 1, 2, 4]);
});

// ---------- МАИ

test('шкала Саати: допустимые и недопустимые значения', () => {
  near(parseSaaty('3'), 3);
  near(parseSaaty('1/7'), 1 / 7);
  near(parseSaaty('правый ×5'), 1 / 5);
  near(parseSaaty('левый ×2'), 2);
  near(parseSaaty('равны'), 1);
  for (const bad of ['0', '10', '1/10', '2.5', '', 'abc', '1/0']) assert.throws(() => parseSaaty(bad));
});

test('классический пример 3×3 (Саати): веса, λmax, CR', () => {
  const A = buildMatrix(['a', 'b', 'c'], { 'a|b': 3, 'a|c': 5, 'b|c': 3 });
  const r = consistency(A);
  near(r.weights[0], 0.6370, 1e-4);
  near(r.weights[1], 0.2583, 1e-4);
  near(r.weights[2], 0.1047, 1e-4);
  near(r.lambdaMax, 3.0385, 1e-4);
  near(r.cr, 0.0332, 1e-4);
});

test('идеально согласованная матрица: w восстанавливается, λmax = n, CR = 0', () => {
  const w = [0.4, 0.3, 0.2, 0.1];
  const items = ['a', 'b', 'c', 'd'];
  const pairs = {};
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs[`${items[i]}|${items[j]}`] = w[i] / w[j];
  const r = consistency(buildMatrix(items, pairs));
  r.weights.forEach((x, i) => near(x, w[i], 1e-10));
  near(r.lambdaMax, 4, 1e-10);
  assert.equal(r.cr, 0);
});

test('геометрическое среднее сохраняет обратную симметрию; веса нормированы', () => {
  const items = ['a', 'b', 'c'];
  const A = buildMatrix(items, { 'a|b': 3, 'a|c': 1 / 5, 'b|c': 7 });
  const B = buildMatrix(items, { 'a|b': 1 / 2, 'a|c': 9, 'b|c': 1 });
  const C = buildMatrix(items, { 'a|b': 4, 'a|c': 1, 'b|c': 1 / 3 });
  const G = geometricMeanMatrix([A, B, C]);
  assertReciprocal(G);
  near(G[0][1], Math.cbrt(3 * 0.5 * 4));
  const r = consistency(G);
  near(r.weights.reduce((s, x) => s + x, 0), 1);
});

test('несогласованная матрица: CR > 0,1 и указана противоречивая пара', () => {
  const items = ['a', 'b', 'c'];
  const A = buildMatrix(items, { 'a|b': 9, 'a|c': 1 / 9, 'b|c': 9 }); // a ≫ b ≫ c, но c ≫ a
  const r = consistency(A);
  assert.ok(r.cr > 0.1);
  const p = inconsistentPairs(A, r.weights, items, 1)[0];
  assert.ok(p.deviation > 1);
});

test('нарушенная обратная симметрия и пропуски отклоняются', () => {
  assert.throws(() => assertReciprocal([[1, 2], [2, 1]]), /обратная/);
  assert.throws(() => buildMatrix(['a', 'b', 'c'], { 'a|b': 2 }), /Нет сравнения/);
});

test('коллективный МАИ: веса критериев и глобальные приоритеты нормированы', () => {
  const crit = ['K1', 'K2'];
  const alts = ['A', 'B', 'C'];
  const groups = [{ id: 'criteria', items: crit }, { id: 'K1', items: alts }, { id: 'K2', items: alts }];
  const ans = (k, a1, a2, a3) => ({ criteria: { 'K1|K2': k }, K1: { 'A|B': a1, 'A|C': a2, 'B|C': a3 }, K2: { 'A|B': 1 / a1, 'A|C': 1 / a2, 'B|C': 1 / a3 } });
  const res = collectiveAhp({ experts: ['E1', 'E2', 'E3'], groups, answers: { E1: ans(3, 2, 4, 2), E2: ans(1, 3, 5, 2), E3: ans(1 / 2, 2, 3, 1) } });
  near(res.critWeights.reduce((s, x) => s + x, 0), 1);
  near(res.global.reduce((s, x) => s + x, 0), 1);
  for (const e of ['E1', 'E2', 'E3']) near(res.perExpertGlobal[e].reduce((s, x) => s + x, 0), 1);
});
