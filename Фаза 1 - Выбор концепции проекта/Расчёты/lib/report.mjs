// Сводный DOCX-отчёт фазы 1, собранный из Markdown-документов репозитория.
// Содержание не дублируется: отчёт всегда отражает текущие документы, результаты расчётов и трекер.

import fs from 'node:fs';
import path from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  AlignmentType, PageOrientation, ShadingType, Header, PageNumber, Footer,
} from 'docx';
import { EXPERTS } from './config.mjs';

// Строка статуса должна начинаться с начала строки, чтобы пример в подсказке не считался решением.
export const DECISION_MARK = /^\*\*Статус решения:\*\*\s*принято командой/im;

// ---------- Markdown → блоки
export function parseMarkdown(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { i++; continue; }
    if (isTableRow(line)) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: body.join(' ') });
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) { items.push({ level: Math.min(2, Math.floor(m[1].length / 2)), marker: m[2], text: m[3] }); i++; continue; }
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|\s*\||\s*>|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ type: 'para', text: para.join(' ') });
  }
  return blocks;
}

// ---------- инлайн-разметка
export function inlineRuns(text, base = {}) {
  const clean = text
    .replace(/\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g, (_, t, url) => (/^<?https?:/.test(url) ? `${t} (${url.replace(/[<>]/g, '')})` : t))
    .replace(/\\\|/g, '|');
  const runs = [];
  const parts = clean.split(/(\*\*[^*]+\*\*|`[^`]+`|<br\s*\/?>)/g).filter((p) => p !== '');
  for (const p of parts) {
    if (/^<br/.test(p)) runs.push(new TextRun({ ...base, text: '', break: 1 }));
    else if (p.startsWith('**')) runs.push(new TextRun({ ...base, text: p.slice(2, -2), bold: true }));
    else if (p.startsWith('`')) runs.push(new TextRun({ ...base, text: p.slice(1, -1), font: 'Consolas' }));
    else runs.push(new TextRun({ ...base, text: p }));
  }
  return runs;
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function toDocx(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'heading') out.push(new Paragraph({ heading: HEADINGS[b.level - 1], children: inlineRuns(b.text) }));
    else if (b.type === 'para') out.push(new Paragraph({ children: inlineRuns(b.text), spacing: { after: 120 } }));
    else if (b.type === 'quote') out.push(new Paragraph({ children: inlineRuns(b.text, { italics: true }), indent: { left: 400 }, spacing: { after: 120 } }));
    else if (b.type === 'code') {
      for (const l of b.text.split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: l, font: 'Consolas', size: 18 })] }));
    } else if (b.type === 'list') {
      for (const it of b.items) {
        if (/^\d+\.$/.test(it.marker)) out.push(new Paragraph({ children: inlineRuns(`${it.marker} ${it.text}`), indent: { left: 360 + it.level * 360, hanging: 360 } }));
        else out.push(new Paragraph({ children: inlineRuns(it.text), bullet: { level: it.level } }));
      }
    } else if (b.type === 'table') {
      const width = Math.max(...b.rows.map((r) => r.length));
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: b.rows.map((r, ri) => new TableRow({
          tableHeader: ri === 0,
          children: Array.from({ length: width }, (_, ci) => new TableCell({
            shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'DDEBF7', color: 'auto' } : undefined,
            children: [new Paragraph({ children: inlineRuns(r[ci] ?? '', { size: 18, bold: ri === 0 ? true : undefined }) })],
          })),
        })),
      }));
      out.push(new Paragraph({ text: '' }));
    }
  }
  return out;
}

export function reportSources(phaseDir) {
  const tracker = path.join(phaseDir, '..', 'Таск трекер');
  const results = path.join(phaseDir, 'Расчёты', 'Результаты расчётов.md');
  return {
    portrait: [
      path.join(phaseDir, '1. Альтернативы и критерии.md'),
      path.join(phaseDir, '2. Экспертные оценки.md'),
      path.join(phaseDir, '3. TOPSIS.md'),
      path.join(phaseDir, '4. МАИ.md'),
      ...(fs.existsSync(results) ? [results] : []),
      path.join(phaseDir, '5. Сравнение результатов и выводы.md'),
    ],
    landscape: [
      path.join(tracker, 'Задачи.md'),
      path.join(tracker, 'Матрица RACI.md'),
      path.join(tracker, 'Таблица трудозатрат.md'),
    ],
    resultsExist: fs.existsSync(results),
  };
}

export async function buildReport(phaseDir, outFile) {
  const src = reportSources(phaseDir);
  const conclusions = fs.readFileSync(path.join(phaseDir, '5. Сравнение результатов и выводы.md'), 'utf8');
  const isDraft = !src.resultsExist || !DECISION_MARK.test(conclusions);
  const read = (f) => toDocx(parseMarkdown(fs.readFileSync(f, 'utf8')));

  const title = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 240 }, children: [new TextRun({ text: 'Проектный менеджмент', size: 32 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: 'Фаза 1. Выбор концепции проекта', bold: true, size: 40 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: 'Сводный отчёт', size: 32 })] }),
    ...(isDraft ? [new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 600 },
      children: [new TextRun({ text: 'ЧЕРНОВИК', bold: true, size: 36, color: 'C00000' }), new TextRun({ text: src.resultsExist ? ' — решение команды не зафиксировано' : ' — экспертные оценки и расчёты ещё не получены', size: 24, color: 'C00000' })],
    })] : []),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Команда victorian-levs, учебная группа 22', size: 24 })] }),
    ...EXPERTS.map((e) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${e.id} — ${e.name} (@${e.github})`, size: 24 })] })),
  ];

  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: isDraft ? 'Фаза 1 · ЧЕРНОВИК' : 'Фаза 1 · сводный отчёт', size: 16, color: isDraft ? 'C00000' : '808080' })] })] });
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] });

  const doc = new Document({
    creator: 'victorian-levs',
    title: 'Фаза 1. Выбор концепции проекта — сводный отчёт',
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: 24 } } },
    },
    features: { updateFields: false },
    sections: [
      { properties: {}, headers: { default: header }, footers: { default: footer }, children: [...title] },
      { properties: {}, headers: { default: header }, footers: { default: footer }, children: src.portrait.flatMap(read) },
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
        headers: { default: header }, footers: { default: footer },
        children: src.landscape.flatMap(read),
      },
    ],
  });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
  return { isDraft, sources: [...src.portrait, ...src.landscape] };
}
