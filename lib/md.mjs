// Общие помощники для генерации Markdown-результатов фаз 2–5.

import fs from 'node:fs';

export const num = (x, d = 2) => (Number.isInteger(x) && d <= 2 ? String(x) : x.toFixed(d)).replace('.', ',');

export const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export const GENERATED_NOTE = (cmd) => `> Файл создаётся командой \`${cmd}\` из исходных данных в папке «Данные». Не редактируйте его вручную.`;

// Детерминированный генератор псевдослучайных чисел (mulberry32): одинаковые результаты при повторном запуске.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.min(s.length - 1, Math.max(0, idx))];
};
