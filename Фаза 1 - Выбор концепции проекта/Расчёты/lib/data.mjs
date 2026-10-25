// Исходные индивидуальные оценки в машиночитаемом виде (CSV, разделитель «;», UTF-8 с BOM для Excel).

import fs from 'node:fs';
import { EXPERTS, ALTERNATIVES, CRITERIA, ahpGroups, pairsOf } from './config.mjs';
import { parseSaaty } from './ahp.mjs';

export const TOPSIS_HEADER = ['эксперт', 'вид', 'альтернатива', 'критерий', 'оценка'];
export const AHP_HEADER = ['эксперт', 'блок', 'левый', 'правый', 'a_ij'];

export function writeCsv(file, header, rows) {
  const text = [header, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
  fs.writeFileSync(file, '﻿' + text, 'utf8');
}

export function readCsv(file, header) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const head = lines[0].split(';').map((s) => s.trim());
  if (head.join(';') !== header.join(';')) throw new Error(`${file}: ожидается заголовок «${header.join(';')}»`);
  return lines.slice(1).map((l, i) => {
    const cells = l.split(';').map((s) => s.trim());
    if (cells.length !== header.length) throw new Error(`${file}, строка ${i + 2}: ожидается ${header.length} полей`);
    return Object.fromEntries(header.map((h, k) => [h, cells[k]]));
  });
}

export function formsToRows(forms) {
  const topsis = [];
  const ahp = [];
  for (const f of forms) {
    for (const c of CRITERIA) if (f.importance[c.id] !== undefined) topsis.push([f.expert, 'важность', '', c.id, f.importance[c.id]]);
    for (const a of ALTERNATIVES) {
      for (const c of CRITERIA) if (f.ratings[a.id]?.[c.id] !== undefined) topsis.push([f.expert, 'оценка', a.id, c.id, f.ratings[a.id][c.id]]);
    }
    for (const p of f.ahp) ahp.push([f.expert, p.group, p.left, p.right, p.value]);
  }
  return { topsis, ahp };
}

/**
 * Разбирает CSV в структуры для расчётов и перечисляет недостающие или ошибочные значения.
 * Ничего не дополняет и не исправляет.
 */
export function loadInputs(topsisRows, ahpRows) {
  const experts = EXPERTS.map((e) => e.id);
  const missing = [];
  const errors = [];
  const importance = {};
  const ratings = {};
  const answers = {};
  const seen = new Set();

  for (const r of topsisRows) {
    const key = `T|${r['эксперт']}|${r['вид']}|${r['альтернатива']}|${r['критерий']}`;
    if (seen.has(key)) errors.push(`TOPSIS: повтор ${key.slice(2)}`);
    seen.add(key);
    const v = Number(r['оценка']);
    if (!experts.includes(r['эксперт'])) { errors.push(`TOPSIS: неизвестный эксперт ${r['эксперт']}`); continue; }
    if (!CRITERIA.some((c) => c.id === r['критерий'])) { errors.push(`TOPSIS: неизвестный критерий ${r['критерий']}`); continue; }
    if (!Number.isInteger(v) || v < 1 || v > 9) { errors.push(`TOPSIS: ${r['эксперт']} ${r['альтернатива']} ${r['критерий']} = «${r['оценка']}», нужно целое 1–9`); continue; }
    if (r['вид'] === 'важность') {
      (importance[r['эксперт']] ??= {})[r['критерий']] = v;
    } else if (r['вид'] === 'оценка' && ALTERNATIVES.some((a) => a.id === r['альтернатива'])) {
      ((ratings[r['эксперт']] ??= {})[r['альтернатива']] ??= {})[r['критерий']] = v;
    } else {
      errors.push(`TOPSIS: непонятная строка ${JSON.stringify(r)}`);
    }
  }

  const groups = ahpGroups();
  for (const r of ahpRows) {
    const key = `M|${r['эксперт']}|${r['блок']}|${r['левый']}|${r['правый']}`;
    if (seen.has(key)) errors.push(`МАИ: повтор ${key.slice(2)}`);
    seen.add(key);
    const g = groups.find((x) => x.id === r['блок']);
    if (!experts.includes(r['эксперт']) || !g) { errors.push(`МАИ: непонятная строка ${JSON.stringify(r)}`); continue; }
    const li = g.items.indexOf(r['левый']);
    const ri = g.items.indexOf(r['правый']);
    if (li < 0 || ri < 0 || li >= ri) { errors.push(`МАИ: пара ${r['левый']} — ${r['правый']} должна идти в порядке списка блока ${g.id}`); continue; }
    try {
      ((answers[r['эксперт']] ??= {})[g.id] ??= {})[`${r['левый']}|${r['правый']}`] = parseSaaty(r['a_ij'], `МАИ ${r['эксперт']} ${g.id} ${r['левый']}—${r['правый']}`);
    } catch (e) { errors.push(e.message); }
  }

  for (const e of experts) {
    for (const c of CRITERIA) {
      if (importance[e]?.[c.id] === undefined) missing.push(`${e}: TOPSIS важность ${c.id}`);
      for (const a of ALTERNATIVES) if (ratings[e]?.[a.id]?.[c.id] === undefined) missing.push(`${e}: TOPSIS оценка ${a.id} по ${c.id}`);
    }
    for (const g of groups) {
      for (const [l, r] of pairsOf(g.items)) if (answers[e]?.[g.id]?.[`${l}|${r}`] === undefined) missing.push(`${e}: МАИ ${g.id} ${l}—${r}`);
    }
  }

  return { experts, importance, ratings, answers, groups, missing, errors };
}

export function summarizeMissing(missing) {
  const by = {};
  for (const m of missing) {
    const [e, rest] = m.split(': ');
    const kind = rest.startsWith('TOPSIS') ? 'TOPSIS' : 'МАИ';
    by[e] ??= { TOPSIS: 0, 'МАИ': 0 };
    by[e][kind]++;
  }
  return by;
}
