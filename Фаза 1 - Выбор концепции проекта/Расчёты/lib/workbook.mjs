// Расчётная книга XLSX: исходные данные, промежуточные таблицы и итоги в виде формул Excel.
// Формулы вычисляются HyperFormula и сверяются с независимой реализацией на JS (topsis.mjs, ahp.mjs).
// Единственные значения, которые вносятся числами, а не формулами, — исходные ответы и главные
// собственные векторы МАИ; правильность последних проверяется в самой книге: все λ_i = (A·w)_i / w_i
// должны совпадать.

import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import { rank } from './topsis.mjs';
import { ALTERNATIVES, CRITERIA, EXPERTS, RANDOM_INDEX_SOURCE, CR_THRESHOLD, pairsOf, byId } from './config.mjs';

const S = {
  rawT: 'Исходные TOPSIS',
  calcT: 'TOPSIS расчёт',
  rawM: 'Исходные МАИ',
  mat: 'МАИ матрицы',
  sumM: 'МАИ итог',
  cmp: 'Сравнение',
  chk: 'Проверки',
  desc: 'Описание',
};

export function colName(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const a1 = (r, c) => `${colName(c)}${r}`;
const abs = (r, c) => `$${colName(c)}$${r}`;
const xref = (sheet, r, c) => `'${sheet}'!${a1(r, c)}`;
const range = (r1, c1, r2, c2) => `${a1(r1, c1)}:${a1(r2, c2)}`;

class SheetModel {
  constructor(name) { this.name = name; this.cells = new Map(); this.widths = {}; }
  set(r, c, v, style = {}) { this.cells.set(`${r},${c}`, { r, c, v, ...style }); return a1(r, c); }
  f(r, c, formula, style = {}) { return this.set(r, c, undefined, { formula, ...style }); }
  head(r, c, values) { values.forEach((v, i) => this.set(r, c + i, v, { head: true })); }
  title(r, text) { this.set(r, 1, text, { bold: true, size: 12 }); }
  bounds() {
    let mr = 0; let mc = 0;
    for (const x of this.cells.values()) { mr = Math.max(mr, x.r); mc = Math.max(mc, x.c); }
    return [mr, mc];
  }
  toArray() {
    const [mr, mc] = this.bounds();
    const data = Array.from({ length: mr }, () => Array(mc).fill(null));
    for (const x of this.cells.values()) data[x.r - 1][x.c - 1] = x.formula ? `=${x.formula}` : (x.v ?? null);
    return data;
  }
}

const NUM = '0.0000';
const FRACTION = '# ?/?';

export function buildModel({ inputs, topsis, ahp }) {
  const experts = EXPERTS.map((e) => e.id);
  const alts = ALTERNATIVES.map((a) => a.id);
  const crits = CRITERIA;
  const nA = alts.length; const nC = crits.length; const nE = experts.length;
  const sheets = {};
  const mk = (k) => (sheets[k] = new SheetModel(S[k]));

  // ---------- Исходные TOPSIS
  const rawT = mk('rawT');
  rawT.title(1, 'Исходные индивидуальные оценки TOPSIS (шкала 1–9)');
  rawT.set(3, 1, 'Важность критериев', { bold: true });
  rawT.head(4, 1, ['Эксперт', ...crits.map((c) => c.id)]);
  const impRow = (e) => 5 + e;
  experts.forEach((e, ei) => {
    rawT.set(impRow(ei), 1, e);
    crits.forEach((c, ci) => rawT.set(impRow(ei), 2 + ci, inputs.importance[e][c.id]));
  });
  const ratHead = impRow(nE) + 2;
  rawT.set(ratHead, 1, 'Оценки альтернатив по критериям', { bold: true });
  rawT.head(ratHead + 1, 1, ['Эксперт', 'Альтернатива', ...crits.map((c) => c.id)]);
  const ratRow = (ei, ai) => ratHead + 2 + ei * nA + ai;
  experts.forEach((e, ei) => alts.forEach((a, ai) => {
    rawT.set(ratRow(ei, ai), 1, e);
    rawT.set(ratRow(ei, ai), 2, a);
    crits.forEach((c, ci) => rawT.set(ratRow(ei, ai), 3 + ci, inputs.ratings[e][a][c.id]));
  }));

  // ---------- TOPSIS расчёт
  const t = mk('calcT');
  t.title(1, 'Нечёткий коллективный TOPSIS: промежуточные и итоговые таблицы');
  // 1. Веса
  let r0 = 3;
  t.set(r0, 1, '1. Нечёткие веса: l = MIN, m = MEDIAN, u = MAX трёх оценок важности; w = (l, m, u) / 9', { bold: true });
  t.head(r0 + 1, 1, ['Критерий', 'Тип', 'l', 'm', 'u', 'w_l', 'w_m', 'w_u']);
  const wCell = {};
  crits.forEach((c, ci) => {
    const r = r0 + 2 + ci;
    const rng = `'${S.rawT}'!${range(impRow(0), 2 + ci, impRow(nE - 1), 2 + ci)}`;
    t.set(r, 1, c.id);
    t.set(r, 2, c.type === 'benefit' ? 'выгода' : 'затраты');
    t.f(r, 3, `MIN(${rng})`);
    t.f(r, 4, `MEDIAN(${rng})`);
    t.f(r, 5, `MAX(${rng})`);
    wCell[c.id] = [6, 7, 8].map((col, k) => { t.f(r, col, `${a1(r, 3 + k)}/9`, { fmt: NUM }); return abs(r, col); });
  });

  const triHead = (r) => { t.head(r, 1, ['Альтернатива', ...crits.flatMap((c) => ['l', 'm', 'u'].map((x) => `${c.id} ${x}`))]); };
  const triCol = (ci, k) => 2 + ci * 3 + k;

  // 2. Нечёткие оценки
  r0 = r0 + 3 + nC;
  t.set(r0, 1, '2. Нечёткие оценки альтернатив: (MIN, MEDIAN, MAX) трёх оценок', { bold: true });
  triHead(r0 + 1);
  const xRow0 = r0 + 2;
  const xRow = (ai) => xRow0 + ai;
  alts.forEach((a, ai) => {
    t.set(xRow(ai), 1, a);
    crits.forEach((c, ci) => {
      const refs = experts.map((_, ei) => xref(S.rawT, ratRow(ei, ai), 3 + ci)).join(',');
      ['MIN', 'MEDIAN', 'MAX'].forEach((fn, k) => t.f(xRow(ai), triCol(ci, k), `${fn}(${refs})`));
    });
  });

  // 3. База нормирования
  r0 = xRow(nA - 1) + 2;
  t.set(r0, 1, '3. База нормирования: выгода — u* = max u; затраты — l⁻ = min l (шкала начинается с 1, деления на ноль нет)', { bold: true });
  t.head(r0 + 1, 1, ['Критерий', 'Тип', 'Правило', 'Значение']);
  const baseCell = {};
  crits.forEach((c, ci) => {
    const r = r0 + 2 + ci;
    t.set(r, 1, c.id);
    t.set(r, 2, c.type === 'benefit' ? 'выгода' : 'затраты');
    if (c.type === 'benefit') {
      t.set(r, 3, 'u* = max u');
      t.f(r, 4, `MAX(${range(xRow(0), triCol(ci, 2), xRow(nA - 1), triCol(ci, 2))})`);
    } else {
      t.set(r, 3, 'l⁻ = min l');
      t.f(r, 4, `MIN(${range(xRow(0), triCol(ci, 0), xRow(nA - 1), triCol(ci, 0))})`);
    }
    baseCell[c.id] = abs(r, 4);
  });

  // 4. Нормированная матрица
  r0 = r0 + 3 + nC;
  t.set(r0, 1, '4. Нормированная матрица: выгода (l/u*, m/u*, u/u*); затраты (l⁻/u, l⁻/m, l⁻/l)', { bold: true });
  triHead(r0 + 1);
  const nRow0 = r0 + 2;
  const nRow = (ai) => nRow0 + ai;
  alts.forEach((a, ai) => {
    t.set(nRow(ai), 1, a);
    crits.forEach((c, ci) => {
      for (let k = 0; k < 3; k++) {
        const formula = c.type === 'benefit'
          ? `${a1(xRow(ai), triCol(ci, k))}/${baseCell[c.id]}`
          : `${baseCell[c.id]}/${a1(xRow(ai), triCol(ci, 2 - k))}`;
        t.f(nRow(ai), triCol(ci, k), formula, { fmt: NUM });
      }
    });
  });

  // 5. Взвешенная матрица
  r0 = nRow(nA - 1) + 2;
  t.set(r0, 1, '5. Взвешенная нормированная матрица: v = r ⊗ w (покомпонентно)', { bold: true });
  triHead(r0 + 1);
  const vRow0 = r0 + 2;
  const vRow = (ai) => vRow0 + ai;
  alts.forEach((a, ai) => {
    t.set(vRow(ai), 1, a);
    crits.forEach((c, ci) => {
      for (let k = 0; k < 3; k++) t.f(vRow(ai), triCol(ci, k), `${a1(nRow(ai), triCol(ci, k))}*${wCell[c.id][k]}`, { fmt: NUM });
    });
  });

  // 6. Расстояния и коэффициент близости
  r0 = vRow(nA - 1) + 2;
  t.set(r0, 1, '6. Расстояния до A+ = (1, 1, 1) и A− = (0, 0, 0): d = √(Σ(разность²) / 3); CC = D− / (D+ + D−)', { bold: true });
  t.head(r0 + 1, 1, ['Альтернатива', ...crits.map((c) => `d+ ${c.id}`), ...crits.map((c) => `d− ${c.id}`), 'D+', 'D−', 'CC', 'Ранг']);
  const dRow0 = r0 + 2;
  const dRow = (ai) => dRow0 + ai;
  const ccCol = 2 + 2 * nC + 2;
  const ccCell = {}; const tRankCell = {};
  alts.forEach((a, ai) => {
    const r = dRow(ai);
    t.set(r, 1, a);
    crits.forEach((c, ci) => {
      const [l, m, u] = [0, 1, 2].map((k) => a1(vRow(ai), triCol(ci, k)));
      t.f(r, 2 + ci, `SQRT(((1-${l})^2+(1-${m})^2+(1-${u})^2)/3)`, { fmt: NUM });
      t.f(r, 2 + nC + ci, `SQRT((${l}^2+${m}^2+${u}^2)/3)`, { fmt: NUM });
    });
    t.f(r, 2 + 2 * nC, `SUM(${range(r, 2, r, 1 + nC)})`, { fmt: NUM });
    t.f(r, 3 + 2 * nC, `SUM(${range(r, 2 + nC, r, 1 + 2 * nC)})`, { fmt: NUM });
    t.f(r, ccCol, `${a1(r, 3 + 2 * nC)}/(${a1(r, 2 + 2 * nC)}+${a1(r, 3 + 2 * nC)})`, { fmt: NUM, bold: true });
    t.f(r, ccCol + 1, `1+COUNTIF(${abs(dRow(0), ccCol)}:${abs(dRow(nA - 1), ccCol)},">"&${a1(r, ccCol)})`, { bold: true });
    ccCell[a] = xref(S.calcT, r, ccCol);
    tRankCell[a] = xref(S.calcT, r, ccCol + 1);
  });

  // ---------- Исходные МАИ
  const rawM = mk('rawM');
  rawM.title(1, 'Исходные попарные сравнения МАИ: a_ij — левый объект относительно правого (шкала Саати)');
  rawM.head(3, 1, ['№', 'Блок', 'Левый', 'Правый', ...experts]);
  const pairRow = {};
  let pr = 4; let num = 1;
  for (const g of inputs.groups) {
    for (const [l, rr] of pairsOf(g.items)) {
      rawM.set(pr, 1, num++);
      rawM.set(pr, 2, g.id === 'criteria' ? 'критерии' : g.id);
      rawM.set(pr, 3, l);
      rawM.set(pr, 4, rr);
      experts.forEach((e, ei) => rawM.set(pr, 5 + ei, inputs.answers[e][g.id][`${l}|${rr}`], { fmt: FRACTION }));
      pairRow[`${g.id}|${l}|${rr}`] = pr++;
    }
  }

  // ---------- МАИ матрицы
  const mat = mk('mat');
  mat.title(1, 'Матрицы попарных сравнений: индивидуальные и коллективные (геометрическое среднее), собственные векторы и согласованность');
  mat.set(2, 1, `RI: ${RANDOM_INDEX_SOURCE}. Порог CR ≤ ${String(CR_THRESHOLD).replace('.', ',')} — диагностический.`);
  const sources = [...experts, 'Коллективная'];
  const block = {};
  let br = 4;
  for (const g of inputs.groups) {
    block[g.id] = {};
    const n = g.items.length;
    for (const s of sources) {
      const res = s === 'Коллективная' ? ahp.collective[g.id] : ahp.individual[g.id][s];
      mat.set(br, 1, `${g.id === 'criteria' ? 'Критерии' : `Альтернативы по ${g.id}`} — ${s === 'Коллективная' ? 'коллективная матрица' : `эксперт ${s}`}`, { bold: true });
      mat.head(br + 1, 1, ['', ...g.items, 'w', 'Σ a_ij·w_j', 'λ_i']);
      const rowBase = br + 2;
      const row = (i) => rowBase + i;
      const wCol = n + 2;
      const wRowR = br + 2 + n;
      g.items.forEach((it, i) => {
        mat.set(row(i), 1, it);
        g.items.forEach((jt, j) => {
          if (i === j) mat.set(row(i), 2 + j, 1, { fmt: FRACTION });
          else if (i < j) {
            if (s === 'Коллективная') {
              const refs = experts.map((e) => a1(block[g.id][e].row(i), 2 + j)).join(',');
              mat.f(row(i), 2 + j, `GEOMEAN(${refs})`, { fmt: NUM });
            } else {
              mat.f(row(i), 2 + j, xref(S.rawM, pairRow[`${g.id}|${it}|${jt}`], 5 + experts.indexOf(s)), { fmt: FRACTION });
            }
          } else {
            mat.f(row(i), 2 + j, `1/${a1(row(j), 2 + i)}`, { fmt: s === 'Коллективная' ? NUM : FRACTION });
          }
        });
        mat.set(row(i), wCol, res.weights[i], { fmt: NUM, bold: true });
        mat.f(row(i), wCol + 1, `SUMPRODUCT(${range(row(i), 2, row(i), 1 + n)},${abs(wRowR, 2)}:${abs(wRowR, 1 + n)})`, { fmt: NUM });
        mat.f(row(i), wCol + 2, `${a1(row(i), wCol + 1)}/${a1(row(i), wCol)}`, { fmt: NUM });
      });
      mat.set(wRowR, 1, 'w строкой');
      g.items.forEach((_, j) => mat.f(wRowR, 2 + j, a1(row(j), wCol), { fmt: NUM }));
      const lamCol = `${a1(row(0), wCol + 2)}:${a1(row(n - 1), wCol + 2)}`;
      mat.set(wRowR + 1, 1, 'λmax');
      mat.f(wRowR + 1, 2, `AVERAGE(${lamCol})`, { fmt: NUM });
      mat.set(wRowR + 2, 1, 'CI');
      mat.f(wRowR + 2, 2, `(${a1(wRowR + 1, 2)}-${n})/(${n}-1)`, { fmt: NUM });
      mat.set(wRowR + 3, 1, 'RI');
      mat.set(wRowR + 3, 2, res.ri);
      mat.set(wRowR + 4, 1, 'CR');
      mat.f(wRowR + 4, 2, `IF(${a1(wRowR + 3, 2)}=0,0,${a1(wRowR + 2, 2)}/${a1(wRowR + 3, 2)})`, { fmt: NUM, bold: true });
      mat.f(wRowR + 4, 3, `IF(${a1(wRowR + 4, 2)}<=${CR_THRESHOLD},"согласовано","CR > 0,10: пересмотреть")`);
      mat.set(wRowR + 5, 1, 'Разброс λ_i');
      mat.f(wRowR + 5, 2, `MAX(${lamCol})-MIN(${lamCol})`, { fmt: '0.0E+00' });
      mat.set(wRowR + 5, 3, '≈ 0 подтверждает, что w — собственный вектор');
      block[g.id][s] = { row, wCol, crCell: a1(wRowR + 4, 2), lamSpread: a1(wRowR + 5, 2), wCell: (i) => a1(row(i), wCol), n };
      br = wRowR + 7;
    }
  }
  const matRef = (cell) => `'${S.mat}'!${cell}`;

  // ---------- МАИ итог
  const sm = mk('sumM');
  sm.title(1, 'Синтез МАИ: глобальный приоритет = Σ (вес критерия × локальный приоритет альтернативы)');
  sm.set(2, 1, 'Коллективные веса и приоритеты — главные собственные векторы коллективных матриц (лист «МАИ матрицы»).');
  sm.head(3, 1, ['', ...crits.map((c) => c.id), 'Глобальный приоритет', 'Ранг']);
  sm.set(4, 1, 'Вес критерия');
  crits.forEach((c, ci) => sm.f(4, 2 + ci, matRef(block.criteria['Коллективная'].wCell(ci)), { fmt: NUM, bold: true }));
  sm.f(4, 2 + nC, `SUM(${range(4, 2, 4, 1 + nC)})`, { fmt: NUM });
  const gCol = 2 + nC;
  const gCell = {}; const mRankCell = {};
  alts.forEach((a, ai) => {
    const r = 5 + ai;
    sm.set(r, 1, a);
    crits.forEach((c, ci) => sm.f(r, 2 + ci, matRef(block[c.id]['Коллективная'].wCell(ai)), { fmt: NUM }));
    sm.f(r, gCol, `SUMPRODUCT(${range(r, 2, r, 1 + nC)},${abs(4, 2)}:${abs(4, 1 + nC)})`, { fmt: NUM, bold: true });
    sm.f(r, gCol + 1, `1+COUNTIF(${abs(5, gCol)}:${abs(4 + nA, gCol)},">"&${a1(r, gCol)})`, { bold: true });
    gCell[a] = xref(S.sumM, r, gCol);
    mRankCell[a] = xref(S.sumM, r, gCol + 1);
  });
  sm.set(5 + nA, 1, 'Сумма');
  sm.f(5 + nA, gCol, `SUM(${range(5, gCol, 4 + nA, gCol)})`, { fmt: NUM });

  let er = 7 + nA;
  sm.set(er, 1, 'Диагностика: итог по собственным матрицам каждого эксперта (в коллективный результат не входит)', { bold: true });
  sm.head(er + 1, 1, ['Альтернатива', ...experts]);
  alts.forEach((a, ai) => {
    const r = er + 2 + ai;
    sm.set(r, 1, a);
    experts.forEach((e, ei) => {
      const terms = crits.map((c, ci) => `${matRef(block.criteria[e].wCell(ci))}*${matRef(block[c.id][e].wCell(ai))}`).join('+');
      sm.f(r, 2 + ei, terms, { fmt: NUM });
    });
  });

  // ---------- Сравнение
  const cmp = mk('cmp');
  cmp.title(1, 'Сравнение рангов TOPSIS и МАИ');
  cmp.set(2, 1, 'Абсолютные значения CC и приоритета МАИ имеют разный смысл и напрямую не сравниваются; сравниваются ранги.');
  cmp.head(3, 1, ['Код', 'Концепция', 'CC TOPSIS', 'Ранг TOPSIS', 'Приоритет МАИ', 'Ранг МАИ', 'Ранги совпадают']);
  alts.forEach((a, ai) => {
    const r = 4 + ai;
    cmp.set(r, 1, a);
    cmp.set(r, 2, byId(ALTERNATIVES, a).name);
    cmp.f(r, 3, ccCell[a], { fmt: NUM });
    cmp.f(r, 4, tRankCell[a]);
    cmp.f(r, 5, gCell[a], { fmt: NUM });
    cmp.f(r, 6, mRankCell[a]);
    cmp.f(r, 7, `IF(${a1(r, 4)}=${a1(r, 6)},"да","нет")`);
  });

  // ---------- Проверки
  const chk = mk('chk');
  chk.title(1, 'Проверки инвариантов');
  chk.head(3, 1, ['Проверка', 'Значение', 'Ожидается', 'Итог']);
  let cr = 4;
  const check = (name, formula, expected, okFormula, fmt) => {
    chk.set(cr, 1, name);
    chk.f(cr, 2, formula, fmt ? { fmt } : {});
    chk.set(cr, 3, expected);
    chk.f(cr, 4, okFormula(a1(cr, 2)));
    cr++;
  };
  const nTopsis = nE * nC * (1 + nA);
  const nPairs = Object.keys(pairRow).length;
  check('Заполнено оценок TOPSIS', `COUNT('${S.rawT}'!${range(impRow(0), 2, impRow(nE - 1), 1 + nC)})+COUNT('${S.rawT}'!${range(ratRow(0, 0), 3, ratRow(nE - 1, nA - 1), 2 + nC)})`, nTopsis, (c) => `IF(${c}=${nTopsis},"OK","ОШИБКА")`);
  check('Заполнено сравнений МАИ', `COUNT('${S.rawM}'!${range(4, 5, 3 + nPairs, 4 + nE)})`, nE * nPairs, (c) => `IF(${c}=${nE * nPairs},"OK","ОШИБКА")`);
  check('Сумма весов критериев МАИ', xref(S.sumM, 4, 2 + nC), 1, (c) => `IF(ABS(${c}-1)<0.000000001,"OK","ОШИБКА")`, NUM);
  check('Сумма глобальных приоритетов МАИ', xref(S.sumM, 5 + nA, gCol), 1, (c) => `IF(ABS(${c}-1)<0.000000001,"OK","ОШИБКА")`, NUM);
  const ccList = alts.map((a) => ccCell[a]).join(',');
  check('CC TOPSIS в диапазоне [0; 1]', `IF(AND(MIN(${ccList})>=0,MAX(${ccList})<=1),1,0)`, 1, (c) => `IF(${c}=1,"OK","ОШИБКА")`);
  for (const g of inputs.groups) {
    for (const s of sources) {
      const b = block[g.id][s];
      const name = `${g.id === 'criteria' ? 'Критерии' : g.id}, ${s === 'Коллективная' ? 'коллективная' : s}`;
      check(`CR: ${name}`, matRef(b.crCell), `≤ ${String(CR_THRESHOLD).replace('.', ',')}`, (c) => `IF(${c}<=${CR_THRESHOLD},"OK","пересмотреть")`, NUM);
      check(`Собственный вектор: ${name}`, matRef(b.lamSpread), '≈ 0', (c) => `IF(${c}<0.000001,"OK","ОШИБКА")`, '0.0E+00');
    }
  }

  // ---------- Описание
  const d = mk('desc');
  [
    'Расчётная книга фазы 1: выбор концепции проекта',
    'Создаётся командой `npm run calc` из CSV-файлов папки «Данные». Не редактируйте её вручную: исправления вносятся в исходные ответы экспертов.',
    'Все промежуточные значения — формулы Excel. Числами внесены только исходные ответы и собственные векторы МАИ (их проверка — столбец λ_i).',
    '',
    'Нечёткий коллективный TOPSIS (вариант Chen, 2000)',
    '1. Три оценки одной величины упорядочиваются: l = минимум (пессимистичная), m = медиана (ожидаемая), u = максимум (оптимистичная).',
    '   Для критерия затрат K4 тройка также упорядочивается по числу, но благоприятный исход — l (наименьшая трудоёмкость); направление учитывается при нормировании.',
    '2. Веса критериев — треугольные числа (l, m, u) / 9.',
    '3. Нормирование: выгода — делением на u* = max u; затраты — l⁻ / (u, m, l), где l⁻ = min l.',
    '4. Взвешенная матрица v = r ⊗ w; A+ = (1, 1, 1), A− = (0, 0, 0); вершинное расстояние; CC = D− / (D+ + D−).',
    '',
    'Чёткий коллективный МАИ',
    '1. Эксперт задаёт a_ij только для пар i < j; диагональ 1; a_ji = 1 / a_ij.',
    '2. Коллективная матрица — поэлементное геометрическое среднее трёх матриц.',
    '3. Приоритеты — нормированный главный собственный вектор; λmax = среднее (A·w)_i / w_i; CI = (λmax − n) / (n − 1); CR = CI / RI.',
    `4. RI: ${RANDOM_INDEX_SOURCE}. n = 4: 0,90; n = 5: 1,12.`,
    '5. Глобальный приоритет = Σ_j w_j · p_ij.',
  ].forEach((line, i) => d.set(1 + i, 1, line, i === 0 ? { bold: true, size: 12 } : {}));
  d.widths[1] = 140;

  const order = ['desc', 'rawT', 'calcT', 'rawM', 'mat', 'sumM', 'cmp', 'chk'];
  return { sheets: order.map((k) => sheets[k]), refs: { ccCell, tRankCell, gCell, mRankCell, block, matRef } };
}

/** Вычисляет формулы через HyperFormula. Возвращает функцию чтения значения по ссылке 'Лист'!A1. */
export function evaluate(model) {
  const data = Object.fromEntries(model.sheets.map((s) => [s.name, s.toArray()]));
  const hf = HyperFormula.buildFromSheets(data, { licenseKey: 'gpl-v3', smartRounding: false });
  const value = (sheetName, r, c) => hf.getCellValue({ sheet: hf.getSheetId(sheetName), row: r - 1, col: c - 1 });
  const errors = [];
  for (const s of model.sheets) {
    for (const x of s.cells.values()) {
      if (!x.formula) continue;
      const v = value(s.name, x.r, x.c);
      if (v && typeof v === 'object' && 'type' in v) errors.push(`${s.name}!${a1(x.r, x.c)}: ${v.type} ${v.message ?? ''}`);
      x.result = v;
    }
  }
  if (errors.length) throw new Error(`Ошибки формул:\n${errors.slice(0, 20).join('\n')}`);
  const byRef = (ref) => {
    const m = ref.match(/^'(.+)'!([A-Z]+)(\d+)$/);
    const col = m[2].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    return value(m[1], Number(m[3]), col);
  };
  return { byRef };
}

/** Сверяет вычисленные в книге итоги с JS-реализацией. Бросает ошибку при расхождении. */
export function crossCheck(model, ev, { topsis, ahp }, tol = 1e-9) {
  const problems = [];
  const near = (a, b, what) => { if (!(Math.abs(a - b) <= tol)) problems.push(`${what}: книга ${a}, скрипт ${b}`); };
  const { ccCell, tRankCell, gCell, mRankCell, block, matRef } = model.refs;
  for (const r of topsis.result) {
    near(ev.byRef(ccCell[r.alternative]), r.cc, `CC ${r.alternative}`);
    near(ev.byRef(tRankCell[r.alternative]), r.rank, `Ранг TOPSIS ${r.alternative}`);
  }
  const ahpRanks = rank(ahp.global);
  ahp.alternatives.forEach((a, i) => {
    near(ev.byRef(gCell[a]), ahp.global[i], `Приоритет МАИ ${a}`);
    near(ev.byRef(mRankCell[a]), ahpRanks[i], `Ранг МАИ ${a}`);
  });
  for (const [gid, res] of Object.entries(ahp.collective)) {
    near(ev.byRef(matRef(block[gid]['Коллективная'].crCell)), res.cr, `CR коллективная ${gid}`);
    if (ev.byRef(matRef(block[gid]['Коллективная'].lamSpread)) > 1e-6) problems.push(`Собственный вектор ${gid} не подтверждён`);
  }
  for (const [gid, byExpert] of Object.entries(ahp.individual)) {
    for (const [e, res] of Object.entries(byExpert)) near(ev.byRef(matRef(block[gid][e].crCell)), res.cr, `CR ${e} ${gid}`);
  }
  if (problems.length) throw new Error(`Книга и скрипт расходятся:\n${problems.join('\n')}`);
  return true;
}

export async function writeWorkbook(model, file) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'victorian-levs, фаза 1';
  wb.calcProperties.fullCalcOnLoad = true;
  for (const s of model.sheets) {
    const ws = wb.addWorksheet(s.name);
    const [, mc] = s.bounds();
    for (let c = 1; c <= mc; c++) ws.getColumn(c).width = s.widths[c] ?? (c === 1 ? 16 : 11);
    for (const x of s.cells.values()) {
      const cell = ws.getCell(x.r, x.c);
      cell.value = x.formula ? { formula: x.formula, result: x.result } : x.v;
      if (x.fmt) cell.numFmt = x.fmt;
      if (x.bold || x.size) cell.font = { bold: !!x.bold, size: x.size };
      if (x.head) {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      }
    }
  }
  await wb.xlsx.writeFile(file);
}
