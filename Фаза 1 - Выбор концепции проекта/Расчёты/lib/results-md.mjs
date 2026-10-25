// Markdown-представление результатов расчёта (генерируется, вручную не редактируется).

import { ALTERNATIVES, CRITERIA, CR_THRESHOLD, RANDOM_INDEX_SOURCE, byId } from './config.mjs';
import { inconsistentPairs, saatyText } from './ahp.mjs';
import { rank } from './topsis.mjs';

export const num = (x, d = 4) => x.toFixed(d).replace('.', ',');
const tri = (t, d = 3) => `(${t.map((x) => num(x, d)).join('; ')})`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const altName = (id) => `${id} ${byId(ALTERNATIVES, id).name}`;

export function crFlags(ahp, groups) {
  const flags = [];
  for (const g of groups) {
    for (const [e, res] of Object.entries(ahp.individual[g.id])) {
      if (res.cr > CR_THRESHOLD) flags.push({ who: e, group: g, res, pairs: inconsistentPairs(res.matrix, res.weights, g.items) });
    }
    const c = ahp.collective[g.id];
    if (c.cr > CR_THRESHOLD) flags.push({ who: 'коллективная', group: g, res: c, pairs: inconsistentPairs(c.matrix, c.weights, g.items) });
  }
  return flags;
}

export function resultsMarkdown({ inputs, topsis, ahp }) {
  const alts = ALTERNATIVES.map((a) => a.id);
  const out = [];
  out.push('# Результаты расчётов фазы 1');
  out.push('');
  out.push('> Файл создаётся командой `npm run calc` из `Данные/topsis_оценки.csv` и `Данные/mai_сравнения.csv`. Не редактируйте его вручную. Расчётная книга с формулами: [Фаза 1 расчёты TOPSIS и МАИ.xlsx](<Фаза 1 расчёты TOPSIS и МАИ.xlsx>).');
  out.push('');

  out.push('## 1. Нечёткий коллективный TOPSIS');
  out.push('');
  out.push('### 1.1. Нечёткие веса критериев');
  out.push('');
  out.push(table(['Критерий', 'Тип', ...inputs.experts, '(l; m; u)', 'w = (l; m; u) / 9'],
    CRITERIA.map((c) => [c.id, c.type === 'benefit' ? 'выгода' : 'затраты', ...inputs.experts.map((e) => inputs.importance[e][c.id]), tri(topsis.weightTriangles[c.id], 0), tri(topsis.weights[c.id])])));
  out.push('');
  out.push('### 1.2. Нечёткие оценки альтернатив (l; m; u)');
  out.push('');
  out.push(table(['Альтернатива', ...CRITERIA.map((c) => c.id)], alts.map((a) => [a, ...CRITERIA.map((c) => tri(topsis.fuzzy[a][c.id], 0))])));
  out.push('');
  out.push('Исходные тройки по экспертам (E1, E2, E3) — в расчётной книге, лист «Исходные TOPSIS».');
  out.push('');
  out.push('### 1.3. Нормирование');
  out.push('');
  out.push(table(['Критерий', 'Правило', 'База'], CRITERIA.map((c) => [c.id, c.type === 'benefit' ? '(l/u*; m/u*; u/u*)' : '(l⁻/u; l⁻/m; l⁻/l)', `${topsis.normBase[c.id].kind} = ${topsis.normBase[c.id].value}`])));
  out.push('');
  out.push(table(['Альтернатива', ...CRITERIA.map((c) => c.id)], alts.map((a) => [a, ...CRITERIA.map((c) => tri(topsis.normalized[a][c.id]))])));
  out.push('');
  out.push('### 1.4. Взвешенная нормированная матрица v = r ⊗ w');
  out.push('');
  out.push(table(['Альтернатива', ...CRITERIA.map((c) => c.id)], alts.map((a) => [a, ...CRITERIA.map((c) => tri(topsis.weighted[a][c.id]))])));
  out.push('');
  out.push('### 1.5. Расстояния и коэффициент близости');
  out.push('');
  out.push('A+ = (1; 1; 1), A− = (0; 0; 0) по каждому критерию; d — вершинное расстояние.');
  out.push('');
  out.push(table(['Альтернатива', 'D+', 'D−', 'CC', 'Ранг'], topsis.result.map((r) => [altName(r.alternative), num(r.dPlus), num(r.dMinus), `**${num(r.cc)}**`, r.rank])));
  out.push('');

  out.push('## 2. Чёткий коллективный МАИ');
  out.push('');
  out.push(`Коллективные матрицы — поэлементное геометрическое среднее; приоритеты — главный собственный вектор. RI: ${RANDOM_INDEX_SOURCE}. Порог CR ≤ ${num(CR_THRESHOLD, 2)}.`);
  out.push('');
  out.push('### 2.1. Согласованность матриц (CR)');
  out.push('');
  out.push(table(['Блок', ...inputs.experts, 'Коллективная'], inputs.groups.map((g) => [
    g.id === 'criteria' ? 'Критерии' : `Альтернативы по ${g.id}`,
    ...inputs.experts.map((e) => { const cr = ahp.individual[g.id][e].cr; return cr > CR_THRESHOLD ? `**${num(cr, 3)}** ⚠` : num(cr, 3); }),
    num(ahp.collective[g.id].cr, 3),
  ])));
  out.push('');
  const flags = crFlags(ahp, inputs.groups);
  if (flags.length) {
    out.push('Матрицы с CR выше порога. Ниже — пары, сильнее всего расходящиеся с итоговыми весами этой матрицы. Это подсказка для пересмотра самим экспертом; ответы автоматически не исправляются.');
    out.push('');
    out.push(table(['Эксперт', 'Блок', 'CR', 'Пара', 'Дано a_ij', 'Согласовано с весами ≈'], flags.flatMap((f) => f.pairs.map((p) => [
      f.who, f.group.id === 'criteria' ? 'критерии' : f.group.id, num(f.res.cr, 3), `${p.left} — ${p.right}`, f.who === 'коллективная' ? num(p.given, 3) : saatyText(p.given), num(p.implied, 2),
    ]))));
  } else {
    out.push('Все индивидуальные и коллективные матрицы согласованы (CR ≤ порога).');
  }
  out.push('');
  out.push('### 2.2. Коллективные веса критериев');
  out.push('');
  out.push(table(['Критерий', 'Вес', 'λmax', 'CR'], CRITERIA.map((c, i) => [c.id, num(ahp.critWeights[i]), i === 0 ? num(ahp.collective.criteria.lambdaMax) : '', i === 0 ? num(ahp.collective.criteria.cr, 3) : ''])));
  out.push('');
  out.push('### 2.3. Локальные и глобальные приоритеты');
  out.push('');
  const gRanks = rank(ahp.global);
  out.push(table(['Альтернатива', ...CRITERIA.map((c, i) => `${c.id} (w=${num(ahp.critWeights[i], 3)})`), 'Глобальный приоритет', 'Ранг'],
    alts.map((a, ai) => [altName(a), ...CRITERIA.map((c) => num(ahp.collective[c.id].weights[ai])), `**${num(ahp.global[ai])}**`, gRanks[ai]])));
  out.push('');
  out.push('Диагностика: итог по собственным матрицам каждого эксперта (в коллективный результат не входит).');
  out.push('');
  out.push(table(['Альтернатива', ...inputs.experts], alts.map((a, ai) => [a, ...inputs.experts.map((e) => num(ahp.perExpertGlobal[e][ai]))])));
  out.push('');

  out.push('## 3. Сводная таблица рангов');
  out.push('');
  out.push('Абсолютные значения CC (TOPSIS) и глобального приоритета (МАИ) имеют разный смысл и напрямую не сравниваются.');
  out.push('');
  out.push(table(['Альтернатива', 'CC TOPSIS', 'Ранг TOPSIS', 'Приоритет МАИ', 'Ранг МАИ'], alts.map((a, ai) => {
    const t = topsis.result.find((r) => r.alternative === a);
    return [altName(a), num(t.cc), t.rank, num(ahp.global[ai]), gRanks[ai]];
  })));
  out.push('');
  const topT = topsis.result.filter((r) => r.rank === 1).map((r) => r.alternative);
  const topM = alts.filter((_, i) => gRanks[i] === 1);
  const same = topT.length === 1 && topM.length === 1 && topT[0] === topM[0];
  out.push(same
    ? `Оба метода ставят на первое место ${altName(topT[0])}. Итоговое решение фиксирует команда после обсуждения (см. «5. Сравнение результатов и выводы.md»).`
    : `Лидеры методов различаются или есть равенство: TOPSIS — ${topT.join(', ')}, МАИ — ${topM.join(', ')}. Выбор передаётся команде; результаты не подгоняются.`);
  out.push('');
  return out.join('\n');
}
