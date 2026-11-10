// Фаза 5. Расписание разработки MusicApp эвристиками упорядочения работ.
// Запуск: npm run phase5
//
// Время — рабочие дни по 8 часов. Ресурсы — специалисты команды (неисчерпаемые, т. е. возобновляемые:
// освобождаются после окончания задачи). Расписание строится последовательной схемой (serial SGS):
// из задач, у которых выполнены все предшественники, берётся задача с лучшим приоритетом и ставится
// на самый ранний день, когда хватает свободных людей нужных специальностей на всю её длительность.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../../lib/md.mjs';

// Состав команды (типы ресурсов и их запас)
export const RESOURCES = { AN: ['Аналитик-дизайнер', 1], BE: ['Backend-разработчик', 2], FE: ['Frontend-разработчик', 2], QA: ['Тестировщик', 1] };

// Задачи: длительность d в рабочих днях, r — сколько людей каких специальностей, pred — предшественники
export const TASKS = [
  { id: 'D-01', stage: 1, name: 'Уточнить требования и сценарии', d: 5, r: { AN: 1 }, pred: [] },
  { id: 'D-02', stage: 1, name: 'Прототип интерфейса и дизайн', d: 9, r: { AN: 1 }, pred: ['D-01'] },
  { id: 'D-03', stage: 1, name: 'Схема данных и API', d: 4, r: { BE: 1 }, pred: ['D-01'] },
  { id: 'D-04', stage: 1, name: 'Каркас backend, CI, тестовый стенд', d: 4, r: { BE: 1 }, pred: ['D-03'] },
  { id: 'D-05', stage: 1, name: 'Каркас frontend и набор компонентов', d: 5, r: { FE: 1 }, pred: ['D-02'] },
  { id: 'D-06', stage: 2, name: 'Backend: регистрация и вход (UC-01, 02)', d: 5, r: { BE: 1 }, pred: ['D-04'] },
  { id: 'D-07', stage: 2, name: 'Backend: каталог и загрузка треков (UC-13, 14)', d: 11, r: { BE: 1 }, pred: ['D-04'] },
  { id: 'D-08', stage: 2, name: 'Backend: поиск и страница исполнителя (UC-03, 04)', d: 6, r: { BE: 1 }, pred: ['D-07'] },
  { id: 'D-09', stage: 2, name: 'Backend: воспроизведение и история (UC-05, 11)', d: 8, r: { BE: 1 }, pred: ['D-07'] },
  { id: 'D-10', stage: 2, name: 'Backend: избранное и подписки (UC-06, 10)', d: 5, r: { BE: 1 }, pred: ['D-06', 'D-07'] },
  { id: 'D-11', stage: 2, name: 'Backend: плейлисты и ссылки (UC-07–09)', d: 8, r: { BE: 1 }, pred: ['D-06', 'D-07'] },
  { id: 'D-12', stage: 2, name: 'Backend: персональная подборка (UC-12)', d: 8, r: { BE: 1 }, pred: ['D-09', 'D-10'] },
  { id: 'D-13', stage: 2, name: 'Frontend: регистрация и вход', d: 4, r: { FE: 1 }, pred: ['D-05', 'D-06'] },
  { id: 'D-14', stage: 2, name: 'Frontend: кабинет администратора', d: 8, r: { FE: 1 }, pred: ['D-05', 'D-07'] },
  { id: 'D-15', stage: 2, name: 'Frontend: поиск и страница исполнителя', d: 6, r: { FE: 1 }, pred: ['D-05', 'D-08'] },
  { id: 'D-16', stage: 2, name: 'Frontend: плеер, очередь, история', d: 10, r: { FE: 1 }, pred: ['D-05', 'D-09'] },
  { id: 'D-17', stage: 2, name: 'Frontend: избранное и подписки', d: 5, r: { FE: 1 }, pred: ['D-10', 'D-15'] },
  { id: 'D-18', stage: 2, name: 'Frontend: плейлисты и ссылки', d: 7, r: { FE: 1 }, pred: ['D-05', 'D-11'] },
  { id: 'D-19', stage: 2, name: 'Frontend: подборка', d: 3, r: { FE: 1 }, pred: ['D-12', 'D-16'] },
  { id: 'D-20', stage: 1, name: 'Тест-план и тестовый каталог', d: 5, r: { QA: 1 }, pred: ['D-01'] },
  { id: 'D-21', stage: 3, name: 'Тестирование: учётные записи и каталог', d: 5, r: { QA: 1 }, pred: ['D-13', 'D-14', 'D-20'] },
  { id: 'D-22', stage: 3, name: 'Тестирование: прослушивание и библиотека', d: 9, r: { QA: 1 }, pred: ['D-16', 'D-17', 'D-18', 'D-19', 'D-21'] },
  { id: 'D-23', stage: 3, name: 'Исправление дефектов', d: 4, r: { BE: 2 }, pred: ['D-22'] },
  { id: 'D-24', stage: 3, name: 'Нагрузочное тестирование потоков', d: 3, r: { QA: 1, BE: 1 }, pred: ['D-23'] },
  { id: 'D-25', stage: 3, name: 'Развёртывание и приёмка MVP', d: 3, r: { AN: 1, BE: 1 }, pred: ['D-24'] },
];

export const STAGES = { 1: 'Подготовка', 2: 'Разработка функций', 3: 'Тестирование и запуск' };

const START = '2027-01-11'; // понедельник, после новогодних праздников
const HOLIDAYS = ['2027-02-23', '2027-03-08'];
const RANDOM_RUNS = 1000;
const SEED = 20261110;

const sumR = (t) => Object.values(t.r).reduce((s, x) => s + x, 0);

// Метод критического пути без учёта ресурсов: ранние и поздние сроки
export function cpm(tasks) {
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const succ = Object.fromEntries(tasks.map((t) => [t.id, []]));
  tasks.forEach((t) => t.pred.forEach((p) => succ[p].push(t.id)));
  const est = {}; const eft = {};
  for (const t of tasks) { est[t.id] = Math.max(0, ...t.pred.map((p) => eft[p])); eft[t.id] = est[t.id] + t.d; }
  const end = Math.max(...Object.values(eft));
  const lft = {}; const lst = {};
  for (const t of [...tasks].reverse()) { lft[t.id] = Math.min(end, ...succ[t.id].map((s) => lst[s])); lst[t.id] = lft[t.id] - t.d; }
  return { byId, succ, est, eft, lst, lft, end };
}

// Эвристики из задания. dir: 'min' — по возрастанию, 'max' — по убыванию.
export function rules(tasks, c) {
  const R = Object.fromEntries(Object.entries(RESOURCES).map(([k, [, cap]]) => [k, cap]));
  const S = (t) => c.succ[t.id].map((id) => c.byId[id]);
  return {
    SLK: ['min', (t) => c.lst[t.id] - c.est[t.id]],
    FREE: ['min', (t) => Math.min(c.end, ...S(t).map((s) => c.est[s.id])) - c.eft[t.id]],
    LST: ['min', (t) => c.lst[t.id]],
    LFT: ['min', (t) => c.lft[t.id]],
    LSTLFT: ['min', (t) => c.lst[t.id] + c.lft[t.id]],
    GRPW: ['max', (t) => t.d + S(t).reduce((s, x) => s + x.d, 0)],
    LPT: ['max', (t) => t.d],
    MIS: ['max', (t) => S(t).length],
    GRD: ['max', (t) => t.d * sumR(t)],
    GRWC: ['max', (t) => sumR(t)],
    GCRWC: ['max', (t) => sumR(t) + S(t).reduce((s, x) => s + sumR(x), 0)],
    ROT: ['max', (t) => Object.entries(t.r).reduce((s, [k, x]) => s + x / R[k], 0) / t.d],
  };
}

// Последовательная схема генерации расписания. prio(t) — чем меньше, тем раньше.
export function serialSgs(tasks, prio) {
  const used = {}; Object.keys(RESOURCES).forEach((k) => { used[k] = []; });
  const free = (k, day) => RESOURCES[k][1] - (used[k][day] ?? 0);
  const start = {}; const finish = {};
  const order = tasks.map((t, i) => ({ t, i }));
  while (Object.keys(start).length < tasks.length) {
    const eligible = order.filter(({ t }) => start[t.id] === undefined && t.pred.every((p) => finish[p] !== undefined));
    eligible.sort((a, b) => prio(a.t) - prio(b.t) || a.i - b.i);
    const { t } = eligible[0];
    let s = Math.max(0, ...t.pred.map((p) => finish[p]));
    while (!Array.from({ length: t.d }, (_, k) => s + k).every((day) => Object.entries(t.r).every(([k, x]) => free(k, day) >= x))) s++;
    for (let day = s; day < s + t.d; day++) for (const [k, x] of Object.entries(t.r)) used[k][day] = (used[k][day] ?? 0) + x;
    start[t.id] = s; finish[t.id] = s + t.d;
  }
  return { start, finish, makespan: Math.max(...Object.values(finish)) };
}

export function workdays(count) {
  const days = []; const d = new Date(`${START}T00:00:00Z`);
  while (days.length < count) {
    const iso = d.toISOString().slice(0, 10); const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.includes(iso)) days.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

const ru = (iso) => iso.split('-').reverse().join('.');

function main() {
  const c = cpm(TASKS);
  const results = Object.entries(rules(TASKS, c)).map(([name, [dir, f]]) => {
    const sol = serialSgs(TASKS, (t) => (dir === 'min' ? f(t) : -f(t)));
    return { name, sol };
  });
  const rand = rng(SEED);
  let bestRandom = null; let sumRandom = 0;
  for (let i = 0; i < RANDOM_RUNS; i++) {
    const p = Object.fromEntries(TASKS.map((t) => [t.id, rand()]));
    const sol = serialSgs(TASKS, (t) => p[t.id]);
    sumRandom += sol.makespan;
    if (!bestRandom || sol.makespan < bestRandom.makespan) bestRandom = sol;
  }
  results.push({ name: `Случайные приоритеты (лучший из ${RANDOM_RUNS})`, sol: bestRandom });
  const best = results.reduce((b, r) => (r.sol.makespan < b.sol.makespan ? r : b));

  const hours = TASKS.reduce((s, t) => s + t.d * sumR(t) * 8, 0);
  const cal = workdays(best.sol.makespan);
  const out = [];
  out.push(`Задач: ${TASKS.length}. Трудозатраты: ${hours} чел.-ч. Критический путь без учёта ресурсов: ${c.end} раб. дн.`, '');
  out.push('### Эвристики', '', '| Эвристика | Срок, раб. дн. |', '|---|---|');
  results.forEach((r) => out.push(`| ${r.name} | ${r.sol.makespan}${r === best ? ' (лучшее)' : ''} |`));
  out.push('', `Среднее по случайным приоритетам: ${(sumRandom / RANDOM_RUNS).toFixed(1).replace('.', ',')} раб. дн.`, '');
  out.push(`### Лучшее расписание: ${best.name}, ${best.sol.makespan} раб. дн.`, '', '| ID | Задача | Кто | Дни | Даты |', '|---|---|---|---|---|');
  [...TASKS].sort((a, b) => best.sol.start[a.id] - best.sol.start[b.id] || a.id.localeCompare(b.id)).forEach((t) => {
    const s = best.sol.start[t.id]; const f = best.sol.finish[t.id];
    const who = Object.entries(t.r).map(([k, x]) => `${k}×${x}`).join(', ');
    out.push(`| ${t.id} | ${t.name} | ${who} | ${s + 1}–${f} | ${ru(cal[s])} — ${ru(cal[f - 1])} |`);
  });
  out.push('', '### Этапы', '', '| Этап | Начало | Конец |', '|---|---|---|');
  for (const [n, name] of Object.entries(STAGES)) {
    const ts = TASKS.filter((t) => t.stage === +n);
    const s = Math.min(...ts.map((t) => best.sol.start[t.id])); const f = Math.max(...ts.map((t) => best.sol.finish[t.id]));
    out.push(`| ${n}. ${name} | ${ru(cal[s])} | ${ru(cal[f - 1])} |`);
  }
  out.push('', `Проект: ${ru(cal[0])} — ${ru(cal.at(-1))}, ${best.sol.makespan} рабочих дней.`);
  console.log(out.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
