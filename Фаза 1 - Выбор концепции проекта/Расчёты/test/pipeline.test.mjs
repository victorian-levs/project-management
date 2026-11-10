// Сквозная проверка инструмента на СИНТЕТИЧЕСКИХ данных. Эти данные создаются в памяти и во временной
// папке ОС, не являются оценками команды и никогда не записываются в «Данные».

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { EXPERTS, CRITERIA, ALTERNATIVES, SAATY_LABELS } from '../lib/config.mjs';
import { buildBlankForm, readForm, LAYOUT, ahpPairRows } from '../lib/forms.mjs';
import { formsToRows, loadInputs, writeCsv, readCsv, TOPSIS_HEADER, AHP_HEADER } from '../lib/data.mjs';
import { calculate } from '../phase1.mjs';
import { writeWorkbook } from '../lib/workbook.mjs';
import { resultsMarkdown } from '../lib/results-md.mjs';
import { parseMarkdown } from '../../../lib/docx.mjs';

function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-synthetic-'));

async function fillForm(blank, file, expert, rnd) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(blank);
  wb.getWorksheet(LAYOUT.info.sheet).getCell(LAYOUT.info.expert).value = expert;
  const t = wb.getWorksheet(LAYOUT.topsis.sheet);
  CRITERIA.forEach((_, i) => { t.getCell(LAYOUT.topsis.importanceRow0 + i, LAYOUT.topsis.importanceCol).value = 1 + Math.floor(rnd() * 9); });
  ALTERNATIVES.forEach((_, i) => CRITERIA.forEach((__, j) => {
    t.getCell(LAYOUT.topsis.ratingsRow0 + i, LAYOUT.topsis.ratingsCol0 + j).value = 1 + Math.floor(rnd() * 9);
  }));
  const m = wb.getWorksheet(LAYOUT.ahp.sheet);
  ahpPairRows().forEach((_, i) => {
    m.getCell(LAYOUT.ahp.row0 + i, LAYOUT.ahp.answerCol).value = SAATY_LABELS[Math.floor(rnd() * SAATY_LABELS.length)].label;
  });
  await wb.xlsx.writeFile(file);
}

test('форма → CSV → расчёт: формулы книги совпадают со скриптом', async () => {
  const blank = path.join(tmp, 'blank.xlsx');
  await buildBlankForm(blank);
  const rnd = prng(20261025);
  const forms = [];
  for (const e of EXPERTS) {
    const f = path.join(tmp, `${e.id}.xlsx`);
    await fillForm(blank, f, e.id, rnd);
    const form = await readForm(f, e.id);
    assert.deepEqual(form.problems, []);
    assert.equal(Object.keys(form.importance).length, 5);
    assert.equal(form.ahp.length, 40);
    forms.push(form);
  }
  const rows = formsToRows(forms);
  assert.equal(rows.topsis.length, 3 * 25);
  assert.equal(rows.ahp.length, 3 * 40);
  writeCsv(path.join(tmp, 't.csv'), TOPSIS_HEADER, rows.topsis);
  writeCsv(path.join(tmp, 'm.csv'), AHP_HEADER, rows.ahp);
  const inputs = loadInputs(readCsv(path.join(tmp, 't.csv'), TOPSIS_HEADER), readCsv(path.join(tmp, 'm.csv'), AHP_HEADER));
  assert.deepEqual(inputs.missing, []);
  assert.deepEqual(inputs.errors, []);

  const { topsis, ahp, model } = calculate(inputs); // бросает ошибку при расхождении книги и скрипта
  assert.equal(topsis.result.length, 4);
  const out = path.join(tmp, 'calc.xlsx');
  await writeWorkbook(model, out);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  assert.ok(wb.getWorksheet('TOPSIS расчёт'));
  const md = resultsMarkdown({ inputs, topsis, ahp });
  assert.match(md, /Сводная таблица рангов/);
  assert.ok(parseMarkdown(md).some((b) => b.type === 'table'));
});

test('незаполненная форма и чужой ID дают замечания, а не молчаливые значения', async () => {
  const blank = path.join(tmp, 'blank2.xlsx');
  await buildBlankForm(blank);
  const form = await readForm(blank, 'E2');
  assert.ok(form.problems.some((p) => p.includes('ID эксперта')));
  assert.equal(form.problems.filter((p) => p.startsWith('TOPSIS')).length, 25);
  assert.equal(form.problems.filter((p) => p.startsWith('МАИ')).length, 40);
  const inputs = loadInputs([], []);
  assert.equal(inputs.missing.length, 3 * (25 + 40));
});

test('ошибочные строки CSV попадают в errors', () => {
  const inputs = loadInputs(
    [{ 'эксперт': 'E1', 'вид': 'важность', 'альтернатива': '', 'критерий': 'K1', 'оценка': '10' },
      { 'эксперт': 'E9', 'вид': 'важность', 'альтернатива': '', 'критерий': 'K1', 'оценка': '5' }],
    [{ 'эксперт': 'E1', 'блок': 'criteria', 'левый': 'K2', 'правый': 'K1', 'a_ij': '3' },
      { 'эксперт': 'E1', 'блок': 'criteria', 'левый': 'K1', 'правый': 'K2', 'a_ij': '11' }],
  );
  assert.equal(inputs.errors.length, 4);
});
