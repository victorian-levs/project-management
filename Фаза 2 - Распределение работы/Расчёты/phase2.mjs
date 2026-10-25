// Фаза 2: распределение задач фазы 3 между участниками как задача целочисленного линейного программирования.
//
// Переменные: x_ij = 1, если задача j назначена участнику i.
// Цель: максимизировать Σ_i Σ_j p_ij · c_j · x_ij — «часы работы, которую участник хочет делать»
//       (p_ij — предпочтение 1–5, c_j — согласованная сложность задачи в часах).
// Ограничения:
//   1) каждая задача назначена ровно одному: Σ_i x_ij = 1;
//   2) баланс нагрузки: (1 − δ)·C/n ≤ Σ_j c_j x_ij ≤ (1 + δ)·C/n, C = Σ c_j;
//   3) связанные задачи одного метода выполняет один человек: x_ia = x_ib;
//   4) COSMIC и UCP считают разные люди (независимость оценок): x_ia + x_ib ≤ 1;
//   5) каждый описывает хотя бы один блок Use Cases: Σ_{j ∈ UC} x_ij ≥ 1.
// Решение: GLPK (glpk.js) и контрольный полный перебор всех n^m назначений.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import GLPKFactory from 'glpk.js';
import { table, num, readJson, GENERATED_NOTE, median } from '../../lib/md.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const phaseDir = path.resolve(here, '..');

export function aggregateComplexity(data) {
  const r2 = data.complexity.rounds['2'];
  return data.tasks.map((_, j) => median(data.experts.map((e) => r2[e][j])));
}

export function buildProblem(data) {
  const c = aggregateComplexity(data);
  const experts = data.experts;
  const tasks = data.tasks.map((t) => t.id);
  const p = experts.map((e) => data.preferences[e]);
  const total = c.reduce((s, x) => s + x, 0);
  const avg = total / experts.length;
  const d = data.model.balanceTolerance;
  return { experts, tasks, c, p, total, lo: (1 - d) * avg, hi: (1 + d) * avg, model: data.model, groups: data.tasks.map((t) => t.group) };
}

const v = (i, j) => `x_${i + 1}_${j + 1}`;

export function constraintsOf(P) {
  const { experts, tasks, c, lo, hi, model, groups } = P;
  const idx = (id) => tasks.indexOf(id);
  const cons = [];
  tasks.forEach((t, j) => cons.push({ name: `assign_${t}`, vars: experts.map((_, i) => [v(i, j), 1]), type: 'eq', rhs: 1 }));
  experts.forEach((e, i) => {
    cons.push({ name: `load_min_${e}`, vars: tasks.map((_, j) => [v(i, j), c[j]]), type: 'ge', rhs: lo });
    cons.push({ name: `load_max_${e}`, vars: tasks.map((_, j) => [v(i, j), c[j]]), type: 'le', rhs: hi });
    for (const [a, b] of model.sameAssignee) cons.push({ name: `same_${a}_${b}_${e}`, vars: [[v(i, idx(a)), 1], [v(i, idx(b)), -1]], type: 'eq', rhs: 0 });
    for (const [a, b] of model.differentAssignee) cons.push({ name: `diff_${a}_${b}_${e}`, vars: [[v(i, idx(a)), 1], [v(i, idx(b)), 1]], type: 'le', rhs: 1 });
    const g = tasks.map((_, j) => j).filter((j) => groups[j] === model.atLeastOneOfGroup);
    cons.push({ name: `uc_${e}`, vars: g.map((j) => [v(i, j), 1]), type: 'ge', rhs: 1 });
  });
  return cons;
}

export async function solveGlpk(P) {
  let glpk = GLPKFactory();
  if (glpk instanceof Promise) glpk = await glpk;
  const { experts, tasks, c, p } = P;
  const bnd = (type, rhs) => (type === 'eq' ? { type: glpk.GLP_FX, lb: rhs, ub: rhs }
    : type === 'le' ? { type: glpk.GLP_UP, lb: 0, ub: rhs } : { type: glpk.GLP_LO, lb: rhs, ub: 0 });
  const lp = {
    name: 'phase3_assignment',
    objective: {
      direction: glpk.GLP_MAX, name: 'preference_hours',
      vars: experts.flatMap((_, i) => tasks.map((_, j) => ({ name: v(i, j), coef: p[i][j] * c[j] }))),
    },
    subjectTo: constraintsOf(P).map((k) => ({ name: k.name, vars: k.vars.map(([name, coef]) => ({ name, coef })), bnds: bnd(k.type, k.rhs) })),
    binaries: experts.flatMap((_, i) => tasks.map((_, j) => v(i, j))),
  };
  const res = await glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF });
  if (res.result.status !== glpk.GLP_OPT) throw new Error(`GLPK: решение не оптимально, статус ${res.result.status}`);
  const assign = tasks.map((_, j) => experts.findIndex((_, i) => res.result.vars[v(i, j)] > 0.5));
  return { assign, objective: res.result.z };
}

export function evaluate(P, assign) {
  const { experts, tasks, c, p, lo, hi, model, groups } = P;
  const idx = (id) => tasks.indexOf(id);
  const load = experts.map((_, i) => assign.reduce((s, a, j) => s + (a === i ? c[j] : 0), 0));
  const ok = load.every((l) => l >= lo - 1e-9 && l <= hi + 1e-9)
    && model.sameAssignee.every(([a, b]) => assign[idx(a)] === assign[idx(b)])
    && model.differentAssignee.every(([a, b]) => assign[idx(a)] !== assign[idx(b)])
    && experts.every((_, i) => assign.some((a, j) => a === i && groups[j] === model.atLeastOneOfGroup));
  const objective = assign.reduce((s, a, j) => s + p[a][j] * c[j], 0);
  return { ok, load, objective };
}

/** Полный перебор n^m назначений — контроль оптимальности решения GLPK. */
export function bruteForce(P) {
  const n = P.experts.length; const m = P.tasks.length;
  const assign = Array(m).fill(0);
  let best = null; let feasible = 0; let optimaCount = 0;
  const total = n ** m;
  for (let k = 0; k < total; k++) {
    let x = k;
    for (let j = 0; j < m; j++) { assign[j] = x % n; x = Math.floor(x / n); }
    const ev = evaluate(P, assign);
    if (!ev.ok) continue;
    feasible++;
    if (!best || ev.objective > best.objective + 1e-9) { best = { assign: [...assign], objective: ev.objective }; optimaCount = 1; }
    else if (Math.abs(ev.objective - best.objective) < 1e-9) optimaCount++;
  }
  return { ...best, feasible, total, optimaCount };
}

export function lpText(P) {
  const { experts, tasks, c, p } = P;
  const terms = (vars) => vars.map(([name, coef], k) => `${coef < 0 ? '-' : k ? '+' : ''} ${Math.abs(coef)} ${name}`).join(' ');
  const lines = ['\\ Phase 2: assignment of phase 3 tasks (CPLEX LP format: GLPK, NEOS, OpenSolver)', 'Maximize',
    ` obj: ${terms(experts.flatMap((_, i) => tasks.map((_, j) => [v(i, j), p[i][j] * c[j]])))}`, 'Subject To'];
  for (const k of constraintsOf(P)) lines.push(` ${k.name.replace(/-/g, '')}: ${terms(k.vars)} ${k.type === 'eq' ? '=' : k.type === 'le' ? '<=' : '>='} ${+k.rhs.toFixed(4)}`);
  lines.push('Binary', ...experts.flatMap((_, i) => tasks.map((_, j) => ` ${v(i, j)}`)), 'End');
  return lines.join('\n') + '\n';
}

function report(data, P, sol, brute) {
  const ev = evaluate(P, sol.assign);
  const out = ['# Результаты распределения задач фазы 3', '', GENERATED_NOTE('npm run phase2'), ''];
  out.push('## Оценки сложности (Дельфи)', '');
  const r = data.complexity.rounds;
  out.push(table(['ID', 'Задача', 'Тур 1: E1 / E2 / E3', 'Размах тура 1', 'Тур 2: E1 / E2 / E3', 'Итог (медиана), ч'], data.tasks.map((t, j) => {
    const r1 = data.experts.map((e) => r['1'][e][j]); const r2 = data.experts.map((e) => r['2'][e][j]);
    return [t.id, t.name, r1.join(' / '), Math.max(...r1) - Math.min(...r1), r2.join(' / '), P.c[j]];
  })));
  out.push('', `Суммарная сложность C = ${num(P.total)} ч; средняя нагрузка C/3 = ${num(P.total / 3)} ч; допустимый коридор ±${data.model.balanceTolerance * 100} %: [${num(P.lo)}; ${num(P.hi)}] ч.`, '');
  out.push('## Предпочтения (1–5)', '');
  out.push(table(['ID', ...data.experts], data.tasks.map((t, j) => [t.id, ...data.experts.map((e) => data.preferences[e][j])])));
  out.push('', '## Решение', '');
  out.push(table(['ID', 'Задача', 'Сложность, ч', 'Исполнитель', 'Предпочтение исполнителя'], data.tasks.map((t, j) => [t.id, t.name, P.c[j], `**${P.experts[sol.assign[j]]}**`, P.p[sol.assign[j]][j]])));
  out.push('', table(['Участник', 'Задачи', 'Нагрузка, ч', 'Среднее предпочтение (взвешенное часами)'], P.experts.map((e, i) => {
    const js = data.tasks.map((_, j) => j).filter((j) => sol.assign[j] === i);
    const h = ev.load[i];
    return [e, js.map((j) => data.tasks[j].id).join(', '), num(h), num(js.reduce((s, j) => s + P.p[i][j] * P.c[j], 0) / h)];
  })));
  out.push('', `Значение целевой функции: **${num(ev.objective)}** (максимально возможное без ограничений, если каждый получит любимые задачи, — ${num(data.tasks.reduce((s, _, j) => s + Math.max(...P.p.map((row) => row[j])) * P.c[j], 0))}).`, '');
  out.push('## Проверка', '');
  out.push(`- GLPK (glpk.js 4.0.2): оптимум ${num(sol.objective)}.`);
  out.push(`- Полный перебор ${brute.total.toLocaleString('ru-RU')} назначений: допустимых ${brute.feasible.toLocaleString('ru-RU')}, оптимум ${num(brute.objective)}, оптимальных назначений — ${brute.optimaCount}.`);
  out.push(`- Значения совпадают: ${Math.abs(brute.objective - sol.objective) < 1e-9 ? 'да' : 'НЕТ'}; все ограничения выполнены: ${ev.ok ? 'да' : 'НЕТ'}.`);
  out.push('', 'Модель в формате CPLEX LP: [модель распределения.lp](<модель распределения.lp>).', '');
  return out.join('\n');
}

async function main() {
  const data = readJson(path.join(phaseDir, 'Данные', 'задачи и оценки.json'));
  const P = buildProblem(data);
  const sol = await solveGlpk(P);
  const brute = bruteForce(P);
  if (Math.abs(brute.objective - sol.objective) > 1e-9) throw new Error('GLPK и перебор дали разные оптимумы');
  fs.writeFileSync(path.join(here, 'модель распределения.lp'), lpText(P), 'utf8');
  fs.writeFileSync(path.join(here, 'Результаты распределения.md'), report(data, P, sol, brute), 'utf8');
  const assignment = Object.fromEntries(data.tasks.map((t, j) => [t.id, P.experts[sol.assign[j]]]));
  fs.writeFileSync(path.join(here, 'назначения.json'), JSON.stringify(assignment, null, 2) + '\n', 'utf8');
  console.log('Назначения:', assignment);
  console.log(`Оптимум ${sol.objective}; перебор подтвердил (${brute.optimaCount} оптимальных назначений).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
