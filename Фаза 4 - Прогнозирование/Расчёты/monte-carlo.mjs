// Фаза 4. Прогноз срока фазы 5 методом Монте-Карло двумя способами.
// Запуск: npm run phase4
//
// Модель 1: каждую неделю команда закрывает случайное число задач, взятое из истории прошлых недель.
// Модель 2: каждую неделю команда тратит случайное число человеко-часов из истории,
//           а длительность каждой задачи фазы 5 берётся из треугольного распределения (o, m, p).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, percentile } from '../../lib/md.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Задачи фазы 5 и трёхточечные оценки, человеко-часы: [ID, задача, оптимистичная, ожидаемая, пессимистичная]
export const TASKS = [
  ['P5-01', 'Встреча: старт фазы 5', 2.5, 3, 4.5],
  ['P5-02', 'Разбить разработку MusicApp на 20–25 задач', 2, 3, 5],
  ['P5-03', 'Состав команды и ресурсы задач', 1, 1.5, 3],
  ['P5-04', 'Длительности и связи предшествования', 1.5, 2, 4],
  ['P5-05', 'Код эвристик и расчёт расписаний', 3, 5, 8],
  ['P5-06', 'Выбор лучшего расписания, календарный план', 1, 2, 3],
  ['P5-07', 'Встреча: проверка плана', 2.5, 3, 4.5],
  ['P5-08', 'Отчёт фазы 5', 2, 3, 5],
  ['P5-09', 'Итоговый отчёт и RACI', 1.5, 2.5, 4],
];

const HISTORY_UNTIL = '2026-11-08'; // прогноз делается по полностью прошедшим неделям
const RUNS = 10000;
const SEED = 20261110;

export function readHistory(file) {
  const [head, ...lines] = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const cols = head.split(';');
  return lines.map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v])))
    .filter((r) => r['неделя_по'] <= HISTORY_UNTIL)
    .map((r) => ({ from: r['неделя_с'], to: r['неделя_по'], tasks: +r['завершено_задач'], hours: +r['человеко_часы'].replace(',', '.') }));
}

// Треугольное распределение методом обратной функции.
export function triangular(o, m, p, u) {
  const f = (m - o) / (p - o);
  return u < f ? o + Math.sqrt(u * (p - o) * (m - o)) : p - Math.sqrt((1 - u) * (p - o) * (p - m));
}

const pick = (xs, rand) => xs[Math.floor(rand() * xs.length)];

export function modelByTasks(throughput, taskCount, runs, rand) {
  return Array.from({ length: runs }, () => {
    let done = 0; let weeks = 0;
    while (done < taskCount) { done += pick(throughput, rand); weeks++; }
    return weeks;
  });
}

export function modelByHours(hoursPerWeek, tasks, runs, rand) {
  return Array.from({ length: runs }, () => {
    const need = tasks.reduce((s, [, , o, m, p]) => s + triangular(o, m, p, rand()), 0);
    let spent = 0; let weeks = 0;
    while (spent < need) { spent += pick(hoursPerWeek, rand); weeks++; }
    return weeks;
  });
}

const f1 = (x) => x.toFixed(1).replace('.', ',');

function distribution(title, weeks) {
  const counts = {};
  weeks.forEach((w) => { counts[w] = (counts[w] ?? 0) + 1; });
  let cum = 0;
  const rows = Object.keys(counts).map(Number).sort((a, b) => a - b).map((w) => {
    cum += counts[w];
    return `| ${w} | ${f1((100 * counts[w]) / weeks.length)} % | ${f1((100 * cum) / weeks.length)} % |`;
  });
  const mean = weeks.reduce((s, w) => s + w, 0) / weeks.length;
  return [`### ${title}`, '', '| Недель | Доля запусков | Накопленная доля |', '|---|---|---|', ...rows, '',
    `Среднее: ${f1(mean)} нед. 50 %: ${percentile(weeks, 50)} нед. **80 %: ${percentile(weeks, 80)} нед.** 90 %: ${percentile(weeks, 90)} нед.`, ''].join('\n');
}

function main() {
  const hist = readHistory(path.join(here, '..', '..', 'Таск трекер', 'Статистика по неделям.csv'));
  const throughput = hist.map((h) => h.tasks);
  const hours = hist.map((h) => h.hours);
  const expected = TASKS.reduce((s, [, , o, m, p]) => s + (o + m + p) / 3, 0);
  const out = [
    `История: ${hist.length} недель (${hist[0].from} — ${hist.at(-1).to}).`,
    `Задач за неделю: ${throughput.join(', ')}. Человеко-часов за неделю: ${hours.map(f1).join(', ')}.`,
    `Задач фазы 5: ${TASKS.length}. Средние трудозатраты по треугольным оценкам: ${f1(expected)} чел.-ч.`,
    `Запусков в каждой модели: ${RUNS}, начальное число генератора: ${SEED}.`, '',
    distribution('Модель 1: по числу задач за неделю', modelByTasks(throughput, TASKS.length, RUNS, rng(SEED))),
    distribution('Модель 2: по человеко-часам за неделю', modelByHours(hours, TASKS, RUNS, rng(SEED + 1))),
  ];
  console.log(out.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
