// Собирает DOCX-версию отчёта каждой фазы из «Фаза N - отчёт.md». Запуск: npm run report

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToDocx } from './lib/docx.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

for (const dir of fs.readdirSync(root).filter((d) => /^Фаза \d/.test(d)).sort()) {
  const n = dir.match(/^Фаза (\d)/)[1];
  const md = path.join(root, dir, `Фаза ${n} - отчёт.md`);
  if (!fs.existsSync(md)) { console.log(`${dir}: нет отчёта`); continue; }
  const out = md.replace(/\.md$/, '.docx');
  await markdownToDocx(md, out, `Фаза ${n}`);
  console.log(`${path.relative(root, out)}`);
}
