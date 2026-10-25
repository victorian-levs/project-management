// Нечёткий коллективный TOPSIS с треугольными числами (вариант Chen, 2000).
//
// Стадии:
//  1. Три оценки одной величины сортируются: l = минимум, m = медиана (средняя по порядку), u = максимум.
//  2. Нечёткие веса: (l, m, u) важности, делённые на максимум шкалы (9), — значения в (0; 1].
//  3. Нормирование оценок альтернатив:
//       выгода: r = (l / u*, m / u*, u / u*), где u* — максимальная u по критерию;
//       затраты: r = (l⁻ / u, l⁻ / m, l⁻ / l), где l⁻ — минимальная l по критерию.
//     Оценки шкалы ≥ 1, поэтому деления на ноль нет; это дополнительно проверяется.
//  4. Взвешенная матрица: v = r ⊗ w (покомпонентное произведение).
//  5. Идеальное решение A+ = (1, 1, 1), антиидеальное A− = (0, 0, 0) по каждому критерию.
//  6. Расстояние между треугольными числами — вершинное: d(a, b) = √(((a1−b1)² + (a2−b2)² + (a3−b3)²) / 3).
//  7. d+ и d− — суммы расстояний по критериям; коэффициент близости CC = d− / (d+ + d−).

import { TOPSIS_SCALE } from './config.mjs';

export function triangle(values) {
  if (values.length !== 3) throw new Error(`Нужно ровно три оценки, получено ${values.length}`);
  const [l, m, u] = [...values].sort((a, b) => a - b);
  return [l, m, u];
}

export function vertexDistance(a, b) {
  return Math.sqrt(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / 3);
}

export function validateScore(value, where, scale = TOPSIS_SCALE) {
  if (!Number.isInteger(value) || value < scale.min || value > scale.max) {
    throw new Error(`${where}: ожидается целое число ${scale.min}–${scale.max}, получено «${value}»`);
  }
}

export function rank(values, higherIsBetter = true) {
  const eps = 1e-12;
  return values.map((v) => 1 + values.filter((o) => (higherIsBetter ? o - v > eps : v - o > eps)).length);
}

/**
 * @param {object} p
 * @param {string[]} p.experts
 * @param {{id: string, type: 'benefit'|'cost'}[]} p.criteria
 * @param {string[]} p.alternatives
 * @param {Record<string, Record<string, number>>} p.importance importance[expert][criterion]
 * @param {Record<string, Record<string, Record<string, number>>>} p.ratings ratings[expert][alternative][criterion]
 */
export function fuzzyTopsis({ experts, criteria, alternatives, importance, ratings, scale = TOPSIS_SCALE }) {
  if (experts.length !== 3) throw new Error('Метод задания использует ровно три оценки на величину (три эксперта)');
  for (const e of experts) {
    for (const c of criteria) {
      validateScore(importance?.[e]?.[c.id], `Важность ${c.id}, эксперт ${e}`, scale);
      for (const a of alternatives) validateScore(ratings?.[e]?.[a]?.[c.id], `Оценка ${a} по ${c.id}, эксперт ${e}`, scale);
    }
  }

  const weightTriangles = {};
  const weights = {};
  for (const c of criteria) {
    weightTriangles[c.id] = triangle(experts.map((e) => importance[e][c.id]));
    weights[c.id] = weightTriangles[c.id].map((x) => x / scale.max);
  }

  const fuzzy = {};
  for (const a of alternatives) {
    fuzzy[a] = {};
    for (const c of criteria) fuzzy[a][c.id] = triangle(experts.map((e) => ratings[e][a][c.id]));
  }

  const normBase = {};
  const normalized = {};
  for (const a of alternatives) normalized[a] = {};
  for (const c of criteria) {
    if (c.type === 'benefit') {
      const uStar = Math.max(...alternatives.map((a) => fuzzy[a][c.id][2]));
      if (!(uStar > 0)) throw new Error(`${c.id}: максимум u должен быть положительным`);
      normBase[c.id] = { kind: 'u*', value: uStar };
      for (const a of alternatives) normalized[a][c.id] = fuzzy[a][c.id].map((x) => x / uStar);
    } else if (c.type === 'cost') {
      const lMinus = Math.min(...alternatives.map((a) => fuzzy[a][c.id][0]));
      if (!(lMinus > 0)) throw new Error(`${c.id}: для критерия затрат все оценки должны быть положительными`);
      normBase[c.id] = { kind: 'l⁻', value: lMinus };
      for (const a of alternatives) {
        const [l, m, u] = fuzzy[a][c.id];
        normalized[a][c.id] = [lMinus / u, lMinus / m, lMinus / l];
      }
    } else {
      throw new Error(`${c.id}: неизвестный тип критерия ${c.type}`);
    }
  }

  const weighted = {};
  const distances = {};
  const result = [];
  const ideal = [1, 1, 1];
  const antiIdeal = [0, 0, 0];
  for (const a of alternatives) {
    weighted[a] = {};
    distances[a] = {};
    let dPlus = 0;
    let dMinus = 0;
    for (const c of criteria) {
      const v = normalized[a][c.id].map((x, k) => x * weights[c.id][k]);
      weighted[a][c.id] = v;
      const dp = vertexDistance(v, ideal);
      const dm = vertexDistance(v, antiIdeal);
      distances[a][c.id] = { plus: dp, minus: dm };
      dPlus += dp;
      dMinus += dm;
    }
    result.push({ alternative: a, dPlus, dMinus, cc: dMinus / (dPlus + dMinus) });
  }
  const ranks = rank(result.map((r) => r.cc));
  result.forEach((r, i) => { r.rank = ranks[i]; });

  return { weightTriangles, weights, fuzzy, normBase, normalized, weighted, distances, ideal, antiIdeal, result };
}
