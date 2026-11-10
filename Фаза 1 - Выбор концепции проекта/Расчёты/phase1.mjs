#!/usr/bin/env node
// Учебный расчётный инструмент фазы 1. Команды:
//   forms   — создать пустой шаблон формы экспертной оценки
//   collect — прочитать заполненные формы Данные/Ответы/E1..E3.xlsx и записать CSV
//   status  — показать, каких исходных данных не хватает
//   calc    — выполнить TOPSIS и МАИ (только при полном наборе ответов трёх экспертов)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERTS, CRITERIA, ALTERNATIVES } from './lib/config.mjs';
import { buildBlankForm, readForm } from './lib/forms.mjs';
import { TOPSIS_HEADER, AHP_HEADER, writeCsv, readCsv, formsToRows, loadInputs, summarizeMissing } from './lib/data.mjs';
import { fuzzyTopsis } from './lib/topsis.mjs';
import { collectiveAhp } from './lib/ahp.mjs';
import { buildModel, evaluate, crossCheck, writeWorkbook } from './lib/workbook.mjs';
import { resultsMarkdown } from './lib/results-md.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const phaseDir = path.resolve(here, '..');
const P = {
  form: path.join(phaseDir, 'Данные', 'Форма экспертной оценки (шаблон).xlsx'),
  answers: path.join(phaseDir, 'Данные', 'Ответы'),
  topsisCsv: path.join(phaseDir, 'Данные', 'topsis_оценки.csv'),
  ahpCsv: path.join(phaseDir, 'Данные', 'mai_сравнения.csv'),
  xlsx: path.join(here, 'Фаза 1 расчёты TOPSIS и МАИ.xlsx'),
  md: path.join(here, 'Результаты расчётов.md'),
};
const rel = (f) => path.relative(path.resolve(phaseDir, '..'), f);

export function calculate(inputs) {
  const topsis = fuzzyTopsis({
    experts: inputs.experts, criteria: CRITERIA, alternatives: ALTERNATIVES.map((a) => a.id),
    importance: inputs.importance, ratings: inputs.ratings,
  });
  const ahp = collectiveAhp({ experts: inputs.experts, groups: inputs.groups, answers: inputs.answers });
  const model = buildModel({ inputs, topsis, ahp });
  const ev = evaluate(model);
  crossCheck(model, ev, { topsis, ahp });
  return { topsis, ahp, model };
}

function loadFromCsv() {
  return loadInputs(readCsv(P.topsisCsv, TOPSIS_HEADER), readCsv(P.ahpCsv, AHP_HEADER));
}

function printStatus(inputs) {
  if (inputs.errors.length) {
    console.log(`Ошибки во входных данных (${inputs.errors.length}):`);
    inputs.errors.forEach((e) => console.log(`  - ${e}`));
  }
  const by = summarizeMissing(inputs.missing);
  const perExpert = CRITERIA.length * (1 + ALTERNATIVES.length);
  console.log(`Ожидается от каждого эксперта: ${perExpert} оценок TOPSIS и ${inputs.groups.reduce((s, g) => s + (g.items.length * (g.items.length - 1)) / 2, 0)} сравнений МАИ.`);
  for (const e of EXPERTS) {
    const m = by[e.id];
    console.log(`  ${e.id} ${e.name}: ${m ? `не хватает TOPSIS ${m.TOPSIS}, МАИ ${m['МАИ']}` : 'полный набор'}`);
  }
  return inputs.missing.length === 0 && inputs.errors.length === 0;
}

async function main(cmd) {
  if (cmd === 'forms') {
    await buildBlankForm(P.form);
    console.log(`Шаблон формы: ${rel(P.form)}`);
  } else if (cmd === 'collect') {
    const forms = [];
    let problems = 0;
    for (const e of EXPERTS) {
      const f = path.join(P.answers, `${e.id}.xlsx`);
      if (!fs.existsSync(f)) { console.log(`${e.id}: файла ${rel(f)} нет`); continue; }
      const form = await readForm(f, e.id);
      forms.push(form);
      problems += form.problems.length;
      console.log(`${e.id}: ${form.problems.length ? `замечаний ${form.problems.length}` : 'форма заполнена полностью'}`);
      form.problems.forEach((p) => console.log(`    - ${p}`));
    }
    if (!forms.length) { console.log('Заполненных форм нет, CSV не изменены.'); return; }
    const rows = formsToRows(forms);
    writeCsv(P.topsisCsv, TOPSIS_HEADER, rows.topsis);
    writeCsv(P.ahpCsv, AHP_HEADER, rows.ahp);
    console.log(`Записаны ${rel(P.topsisCsv)} (${rows.topsis.length} строк) и ${rel(P.ahpCsv)} (${rows.ahp.length} строк).`);
    if (problems) process.exitCode = 1;
  } else if (cmd === 'status') {
    if (!printStatus(loadFromCsv())) process.exitCode = 1;
  } else if (cmd === 'calc') {
    const inputs = loadFromCsv();
    if (!printStatus(inputs)) {
      console.log('Расчёт не выполнен: нужен полный и корректный набор ответов трёх экспертов. Результаты не создаются.');
      process.exitCode = 1;
      return;
    }
    const { topsis, ahp, model } = calculate(inputs);
    await writeWorkbook(model, P.xlsx);
    fs.writeFileSync(P.md, resultsMarkdown({ inputs, topsis, ahp }), 'utf8');
    console.log('Формулы книги вычислены и совпали с независимым расчётом скрипта.');
    console.log(`Записаны ${rel(P.xlsx)} и ${rel(P.md)}.`);
  } else {
    console.log('Команды: forms | collect | status | calc');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
