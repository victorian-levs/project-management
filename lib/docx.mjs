// Перевод Markdown-отчёта фазы в DOCX (заголовки, абзацы, списки, таблицы, жирный текст).

import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  AlignmentType, ShadingType, PageNumber, Footer,
} from 'docx';

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

export function toDocx(blocks) {
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

/** Markdown-файл → DOCX: шрифт Times New Roman 12, номера страниц внизу. */
export async function markdownToDocx(mdFile, outFile, title) {
  const blocks = parseMarkdown(fs.readFileSync(mdFile, 'utf8'));
  const doc = new Document({
    creator: 'victorian-levs',
    title,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
      children: toDocx(blocks),
    }],
  });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
}
