// Форма экспертной оценки (один XLSX на эксперта) и чтение заполненных форм.
// Расположение ячеек задано здесь и используется и генератором, и сборщиком.

import ExcelJS from 'exceljs';
import {
  EXPERTS, ALTERNATIVES, CRITERIA, IMPORTANCE_ANCHORS, SAATY_LABELS, SAATY_VERBAL,
  ahpGroups, pairsOf, ahpQuestion, byId,
} from './config.mjs';

export const FORM_VERSION = '1.0';
export const LAYOUT = {
  info: { sheet: 'Инструкция', expert: 'C4', name: 'C5', date: 'C6', version: 'C7' },
  topsis: { sheet: 'TOPSIS', importanceRow0: 6, importanceCol: 4, ratingsRow0: 15, ratingsCol0: 3 },
  ahp: { sheet: 'МАИ', row0: 6, groupCol: 2, leftCol: 3, rightCol: 4, answerCol: 6 },
};

const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
const BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

function header(row) {
  row.eachCell((c) => { c.font = { bold: true }; c.fill = HEAD_FILL; c.border = BORDER; c.alignment = { wrapText: true, vertical: 'middle' }; });
}

function input(cell, validation) {
  cell.fill = INPUT_FILL;
  cell.border = BORDER;
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.dataValidation = validation;
}

const intValidation = {
  type: 'whole', operator: 'between', formulae: [1, 9], allowBlank: true, showErrorMessage: true,
  errorTitle: 'Недопустимое значение', error: 'Введите целое число от 1 до 9',
};

export function ahpPairRows() {
  const rows = [];
  for (const g of ahpGroups()) {
    for (const [left, right] of pairsOf(g.items)) rows.push({ group: g.id, groupTitle: g.title, left, right });
  }
  return rows;
}

const label = (id) => {
  const c = byId(CRITERIA, id);
  if (c) return `${c.id} ${c.name}`;
  const a = byId(ALTERNATIVES, id);
  return `${a.id} ${a.name}`;
};

export async function buildBlankForm(file) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'victorian-levs, фаза 1';
  wb.created = new Date(0);
  wb.modified = new Date(0);

  // --- Инструкция
  const info = wb.addWorksheet(LAYOUT.info.sheet);
  info.columns = [{ width: 3 }, { width: 28 }, { width: 70 }];
  info.getCell('B2').value = 'Форма независимой экспертной оценки концепций — фаза 1';
  info.getCell('B2').font = { bold: true, size: 14 };
  info.getCell('B4').value = 'ID эксперта';
  info.getCell('B5').value = 'Участник';
  info.getCell('B6').value = 'Дата заполнения';
  info.getCell('B7').value = 'Версия формы';
  input(info.getCell(LAYOUT.info.expert), {
    type: 'list', allowBlank: true, formulae: [`"${EXPERTS.map((e) => e.id).join(',')}"`],
    showErrorMessage: true, error: 'Выберите E1, E2 или E3',
  });
  input(info.getCell(LAYOUT.info.name), undefined);
  input(info.getCell(LAYOUT.info.date), undefined);
  info.getCell(LAYOUT.info.version).value = FORM_VERSION;
  const lines = [
    'Как заполнять',
    '1. Заполняйте форму самостоятельно, не обсуждая ответы с другими участниками до сдачи всех трёх форм.',
    '2. Выберите свой ID эксперта: ' + EXPERTS.map((e) => `${e.id} — ${e.name}`).join('; ') + '.',
    '3. Жёлтые ячейки — поля для ответа. Остальные ячейки не изменяйте, строки и столбцы не переставляйте.',
    '4. Лист «TOPSIS»: 5 оценок важности критериев и 20 оценок концепций, целые числа 1–9 (чётные — промежуточные).',
    '   Для K4 оценивается сама трудоёмкость: 9 — очень трудоёмко. Направление «меньше — лучше» учтёт расчёт.',
    '5. Лист «МАИ»: 40 попарных сравнений. Выберите, какой объект предпочтительнее и во сколько раз.',
    '   «левый ×5» — левый объект существенно предпочтительнее правого; «равны» — одинаково; «правый ×3» — правый умеренно предпочтительнее.',
    '   Для K4 предпочтительнее та концепция, которая требует МЕНЬШЕ учебной трудоёмкости.',
    '   Обратные сравнения (правый с левым) не задаются: они вычисляются автоматически.',
    '6. Ответы TOPSIS и МАИ не обязаны совпадать численно: это два разных вопроса о тех же предпочтениях.',
    '7. Сохраните файл как E1.xlsx, E2.xlsx или E3.xlsx и передайте ответственному за сбор данных.',
    '',
    'Концепции',
    ...ALTERNATIVES.map((a) => `${a.id} ${a.name}: ${a.short}.`),
    'Подробно — «1. Альтернативы и критерии.md» в репозитории.',
    '',
    'Критерии',
    ...CRITERIA.map((c) => `${c.id} ${c.name} — ${c.type === 'benefit' ? 'больше — лучше' : 'меньше — лучше'}.`),
    '',
    'Шкала Саати',
    ...Object.entries(SAATY_VERBAL).map(([v, t]) => `${v} — ${t}`),
    '2, 4, 6, 8 — промежуточные значения.',
  ];
  lines.forEach((t, i) => {
    const c = info.getCell(`B${10 + i}`);
    c.value = t;
    if (['Как заполнять', 'Концепции', 'Критерии', 'Шкала Саати'].includes(t)) c.font = { bold: true };
  });

  // --- TOPSIS
  const t = wb.addWorksheet(LAYOUT.topsis.sheet);
  t.columns = [{ width: 8 }, { width: 46 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  t.getCell('A1').value = 'Нечёткий коллективный TOPSIS: оценки по шкале 1–9';
  t.getCell('A1').font = { bold: true, size: 13 };
  t.getCell('A2').value = 'Три оценки участников по каждой величине будут упорядочены: минимум — пессимистичная, медиана — ожидаемая, максимум — оптимистичная.';
  t.getCell('A4').value = '1. Насколько важен критерий для выбора концепции (1 — практически не важен, 9 — решающий)';
  t.getCell('A4').font = { bold: true };
  const ih = t.getRow(5);
  ih.values = ['Код', 'Критерий', 'Направление', 'Важность 1–9'];
  header(ih);
  CRITERIA.forEach((c, i) => {
    const r = LAYOUT.topsis.importanceRow0 + i;
    t.getCell(r, 1).value = c.id;
    t.getCell(r, 2).value = c.name;
    t.getCell(r, 3).value = c.type === 'benefit' ? 'больше — лучше' : 'меньше — лучше';
    input(t.getCell(r, LAYOUT.topsis.importanceCol), intValidation);
  });

  t.getCell('A13').value = '2. Оценка концепций по каждому критерию (смысл баллов — в таблице ниже)';
  t.getCell('A13').font = { bold: true };
  const rh = t.getRow(14);
  rh.values = ['Код', 'Концепция', ...CRITERIA.map((c) => c.id)];
  header(rh);
  ALTERNATIVES.forEach((a, i) => {
    const r = LAYOUT.topsis.ratingsRow0 + i;
    t.getCell(r, 1).value = a.id;
    t.getCell(r, 2).value = a.name;
    CRITERIA.forEach((_, j) => input(t.getCell(r, LAYOUT.topsis.ratingsCol0 + j), intValidation));
  });

  t.getCell('A21').value = 'Опорные значения шкал (2, 4, 6, 8 — промежуточные)';
  t.getCell('A21').font = { bold: true };
  const legend = [['Балл', 'Важность критерия', ...CRITERIA.map((c) => `${c.id} ${c.name}`)]];
  for (const v of [1, 3, 5, 7, 9]) legend.push([v, IMPORTANCE_ANCHORS[v], ...CRITERIA.map((c) => c.anchors[v])]);
  // Легенда ниже основной таблицы, по одной строке на опорный балл.
  legend.forEach((row, i) => {
    const r = t.getRow(22 + i);
    r.values = row;
    r.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) header(r);
    else r.eachCell((c) => { c.border = BORDER; });
  });
  for (let j = 3; j <= 2 + CRITERIA.length; j++) t.getColumn(j).width = 26;

  // --- МАИ
  const m = wb.addWorksheet(LAYOUT.ahp.sheet);
  m.columns = [{ width: 5 }, { width: 22 }, { width: 34 }, { width: 34 }, { width: 70 }, { width: 14 }, { width: 10 }, { width: 30 }];
  m.getCell('A1').value = 'Чёткий коллективный МАИ: попарные сравнения по шкале Саати';
  m.getCell('A1').font = { bold: true, size: 13 };
  m.getCell('A2').value = 'В столбце «Ответ» выберите значение из списка. «левый ×N» — левый объект предпочтительнее правого в N раз, «правый ×N» — наоборот.';
  m.getCell('A3').value = '1 — равная предпочтительность, 3 — умеренное, 5 — существенное, 7 — значительное, 9 — абсолютное превосходство; 2, 4, 6, 8 — промежуточные.';
  m.getCell('A4').value = 'Столбец a_ij заполняется автоматически: это значение для матрицы (левый относительно правого).';
  const mh = m.getRow(5);
  mh.values = ['№', 'Блок', 'Левый объект', 'Правый объект', 'Вопрос', 'Ответ', 'a_ij', 'Комментарий (необязательно)'];
  header(mh);

  const scale = wb.addWorksheet('Шкала', { state: 'hidden' });
  scale.getRow(1).values = ['Ответ', 'a_ij'];
  SAATY_LABELS.forEach((s, i) => { scale.getRow(2 + i).values = [s.label, s.value]; });
  const scaleRange = `'Шкала'!$A$2:$B$${1 + SAATY_LABELS.length}`;

  ahpPairRows().forEach((p, i) => {
    const r = LAYOUT.ahp.row0 + i;
    m.getCell(r, 1).value = i + 1;
    m.getCell(r, LAYOUT.ahp.groupCol).value = p.groupTitle;
    m.getCell(r, LAYOUT.ahp.leftCol).value = label(p.left);
    m.getCell(r, LAYOUT.ahp.rightCol).value = label(p.right);
    m.getCell(r, 5).value = ahpQuestion(p.group, p.left, p.right);
    m.getCell(r, 5).alignment = { wrapText: true };
    input(m.getCell(r, LAYOUT.ahp.answerCol), {
      type: 'list', allowBlank: true, formulae: [`"${SAATY_LABELS.map((s) => s.label).join(',')}"`],
      showErrorMessage: true, error: 'Выберите значение из списка',
    });
    const ans = m.getCell(r, LAYOUT.ahp.answerCol).address;
    m.getCell(r, 7).value = { formula: `IF(${ans}="","",VLOOKUP(${ans},${scaleRange},2,FALSE))` };
    m.getCell(r, 7).numFmt = '0.000';
    [1, 2, 3, 4, 5, 7].forEach((c) => { m.getCell(r, c).border = BORDER; });
    m.getCell(r, 8).border = BORDER;
  });
  m.views = [{ state: 'frozen', ySplit: 5 }];

  await wb.xlsx.writeFile(file);
}

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('text' in v) return String(v.text);
  }
  return String(v).trim();
}

/** Читает заполненную форму. Возвращает ответы и список проблем (не исправляя ответы). */
export async function readForm(file, expectedExpert) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const problems = [];
  const info = wb.getWorksheet(LAYOUT.info.sheet);
  const t = wb.getWorksheet(LAYOUT.topsis.sheet);
  const m = wb.getWorksheet(LAYOUT.ahp.sheet);
  if (!info || !t || !m) throw new Error(`${file}: нет листов «Инструкция», «TOPSIS» или «МАИ» — используйте шаблон формы`);

  const expert = cellText(info.getCell(LAYOUT.info.expert));
  if (expert !== expectedExpert) problems.push(`ID эксперта в форме «${expert || 'не указан'}», а файл назван ${expectedExpert}`);

  const importance = {};
  CRITERIA.forEach((c, i) => {
    const r = LAYOUT.topsis.importanceRow0 + i;
    if (cellText(t.getCell(r, 1)) !== c.id) problems.push(`TOPSIS: строка ${r} должна относиться к ${c.id}`);
    const raw = cellText(t.getCell(r, LAYOUT.topsis.importanceCol));
    if (raw === '') problems.push(`TOPSIS: не заполнена важность ${c.id}`);
    else if (!/^[1-9]$/.test(raw)) problems.push(`TOPSIS: важность ${c.id} = «${raw}», нужно целое 1–9`);
    else importance[c.id] = Number(raw);
  });

  const ratings = {};
  ALTERNATIVES.forEach((a, i) => {
    const r = LAYOUT.topsis.ratingsRow0 + i;
    if (cellText(t.getCell(r, 1)) !== a.id) problems.push(`TOPSIS: строка ${r} должна относиться к ${a.id}`);
    ratings[a.id] = {};
    CRITERIA.forEach((c, j) => {
      const raw = cellText(t.getCell(r, LAYOUT.topsis.ratingsCol0 + j));
      if (raw === '') problems.push(`TOPSIS: не заполнена оценка ${a.id} по ${c.id}`);
      else if (!/^[1-9]$/.test(raw)) problems.push(`TOPSIS: оценка ${a.id} по ${c.id} = «${raw}», нужно целое 1–9`);
      else ratings[a.id][c.id] = Number(raw);
    });
  });

  const ahp = [];
  ahpPairRows().forEach((p, i) => {
    const r = LAYOUT.ahp.row0 + i;
    if (cellText(m.getCell(r, LAYOUT.ahp.leftCol)) !== label(p.left) || cellText(m.getCell(r, LAYOUT.ahp.rightCol)) !== label(p.right)) {
      problems.push(`МАИ: строка ${r} изменена (ожидалось ${p.left} — ${p.right})`);
      return;
    }
    const raw = cellText(m.getCell(r, LAYOUT.ahp.answerCol));
    const found = SAATY_LABELS.find((s) => s.label === raw);
    if (raw === '') problems.push(`МАИ №${i + 1}: нет ответа (${p.groupTitle}: ${p.left} — ${p.right})`);
    else if (!found) problems.push(`МАИ №${i + 1}: «${raw}» не из списка`);
    else ahp.push({ group: p.group, left: p.left, right: p.right, value: found.text });
  });

  return { expert: expectedExpert, importance, ratings, ahp, problems };
}
