// Чёткий коллективный МАИ (метод анализа иерархий Саати).
//
// Стадии:
//  1. Каждый эксперт отвечает только на независимые пары (i < j): a_ij по шкале Саати 1/9 … 9.
//     Диагональ a_ii = 1, обратные элементы a_ji = 1 / a_ij достраиваются.
//  2. Индивидуальные матрицы проверяются на согласованность: λmax, CI = (λmax − n) / (n − 1), CR = CI / RI.
//  3. Коллективная матрица равноправных экспертов — поэлементное геометрическое среднее (сохраняет обратную симметрию).
//  4. Приоритеты — главный собственный вектор матрицы, нормированный к сумме 1 (степенной метод).
//  5. Глобальный приоритет альтернативы = Σ_j w_j · p_ij (дистрибутивный синтез).

import { RANDOM_INDEX, SAATY_LABELS } from './config.mjs';

const ALLOWED = SAATY_LABELS.map((s) => s.value);

export function parseSaaty(raw, where = 'значение') {
  const text = String(raw ?? '').trim().replace(',', '.');
  const byLabel = SAATY_LABELS.find((s) => s.label === text || s.text === text);
  let value;
  if (byLabel) value = byLabel.value;
  else if (/^1\/[1-9]$/.test(text)) value = 1 / Number(text.slice(2));
  else if (/^[1-9]$/.test(text)) value = Number(text);
  else throw new Error(`${where}: «${raw}» не является значением шкалы Саати (1–9 или 1/2–1/9)`);
  if (!ALLOWED.some((a) => Math.abs(a - value) < 1e-12)) throw new Error(`${where}: «${raw}» вне шкалы Саати`);
  return value;
}

export function saatyText(value) {
  if (value >= 1) return String(Math.round(value));
  return `1/${Math.round(1 / value)}`;
}

/** pairs: Map/object "i|j" -> a_ij для i < j по порядку items. */
export function buildMatrix(items, pairs) {
  const n = items.length;
  const A = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = `${items[i]}|${items[j]}`;
      const v = pairs[key];
      if (!(v > 0)) throw new Error(`Нет сравнения ${items[i]} — ${items[j]}`);
      A[i][j] = v;
      A[j][i] = 1 / v;
    }
  }
  return A;
}

export function assertReciprocal(A, tol = 1e-9) {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    if (Math.abs(A[i][i] - 1) > tol) throw new Error(`Диагональ a${i + 1}${i + 1} ≠ 1`);
    for (let j = 0; j < n; j++) {
      if (!(A[i][j] > 0)) throw new Error(`Элемент a${i + 1}${j + 1} не положителен`);
      if (Math.abs(A[i][j] * A[j][i] - 1) > tol) throw new Error(`Нарушена обратная симметрия a${i + 1}${j + 1}`);
    }
  }
}

export function principalEigenvector(A, { tol = 1e-13, maxIter = 10000 } = {}) {
  const n = A.length;
  let w = Array(n).fill(1 / n);
  for (let it = 0; it < maxIter; it++) {
    const next = A.map((row) => row.reduce((s, a, j) => s + a * w[j], 0));
    const sum = next.reduce((s, x) => s + x, 0);
    const normed = next.map((x) => x / sum);
    const delta = Math.max(...normed.map((x, i) => Math.abs(x - w[i])));
    w = normed;
    if (delta < tol) break;
  }
  const Aw = A.map((row) => row.reduce((s, a, j) => s + a * w[j], 0));
  const lambdas = Aw.map((x, i) => x / w[i]);
  const lambdaMax = lambdas.reduce((s, x) => s + x, 0) / n;
  return { weights: w, lambdaMax, lambdas };
}

export function consistency(A) {
  assertReciprocal(A);
  const n = A.length;
  const { weights, lambdaMax, lambdas } = principalEigenvector(A);
  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = RANDOM_INDEX[n];
  const cr = ri > 0 ? ci / ri : 0;
  // Для идеально согласованной матрицы погрешность вычислений может дать −1e−16; такие значения считаются нулём.
  const clean = (x) => (Math.abs(x) < 1e-12 ? 0 : x);
  return { weights, lambdaMax, lambdas, ci: clean(ci), ri, cr: clean(cr) };
}

export function geometricMeanMatrix(matrices) {
  const n = matrices[0].length;
  const k = matrices.length;
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    Math.exp(matrices.reduce((s, M) => s + Math.log(M[i][j]), 0) / k)));
}

/**
 * Пары, сильнее всего противоречащие итоговым весам матрицы:
 * отклонение = |ln(a_ij · w_j / w_i)|, рядом — согласованное с весами отношение w_i / w_j.
 */
export function inconsistentPairs(A, weights, items, top = 3) {
  const list = [];
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 1; j < A.length; j++) {
      const implied = weights[i] / weights[j];
      list.push({ left: items[i], right: items[j], given: A[i][j], implied, deviation: Math.abs(Math.log(A[i][j] / implied)) });
    }
  }
  return list.sort((a, b) => b.deviation - a.deviation).slice(0, top);
}

/**
 * @param {object} p
 * @param {string[]} p.experts
 * @param {{id: string, items: string[]}[]} p.groups первая группа — критерии, далее альтернативы по каждому критерию
 * @param {Record<string, Record<string, Record<string, number>>>} p.answers answers[expert][groupId]["i|j"] = a_ij
 */
export function collectiveAhp({ experts, groups, answers, criteriaGroupId = 'criteria' }) {
  const individual = {};
  const collective = {};
  for (const g of groups) {
    individual[g.id] = {};
    const mats = [];
    for (const e of experts) {
      const A = buildMatrix(g.items, answers?.[e]?.[g.id] ?? {});
      individual[g.id][e] = { matrix: A, ...consistency(A) };
      mats.push(A);
    }
    const G = geometricMeanMatrix(mats);
    collective[g.id] = { matrix: G, ...consistency(G) };
  }

  const critGroup = groups.find((g) => g.id === criteriaGroupId);
  const altGroups = groups.filter((g) => g.id !== criteriaGroupId);
  const alternatives = altGroups[0].items;
  const synthesize = (critWeights, localOf) => alternatives.map((a, ai) =>
    critGroup.items.reduce((s, c, ci) => s + critWeights[ci] * localOf(c)[ai], 0));

  const critWeights = collective[criteriaGroupId].weights;
  const global = synthesize(critWeights, (c) => collective[c].weights);

  // Диагностика: какой итог получился бы у каждого эксперта по его собственным матрицам.
  const perExpertGlobal = {};
  for (const e of experts) {
    perExpertGlobal[e] = synthesize(individual[criteriaGroupId][e].weights, (c) => individual[c][e].weights);
  }

  return { individual, collective, criteria: critGroup.items, alternatives, critWeights, global, perExpertGlobal };
}
