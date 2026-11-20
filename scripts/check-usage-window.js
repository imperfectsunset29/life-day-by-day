// Runs the public usage numbers (usage.js, the same code as GET /api/public/usage) against
// an events export, to check them against figures published elsewhere.
//   node scripts/check-usage-window.js ~/Downloads/life-events.csv 2026-10-16
// The export is the CSV from /api/export (admin only). Prints totals and books only.
const fs = require('fs');
const path = require('path');
const { computePublicUsage } = require('../usage');

const [file, asOf] = process.argv.slice(2);
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) {
  console.error('Usage: node scripts/check-usage-window.js <events.csv|events.json> <YYYY-MM-DD>');
  process.exit(1);
}

function readEvents(f) {
  const raw = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.json')) return JSON.parse(raw);
  return raw.split('\n').slice(1).filter(Boolean).map(line => {
    const m = line.match(/^([^,]*),([^,]*),([^,]*),"((?:[^"]|"")*)",(.*)$/);
    if (!m) throw new Error(`Unreadable line: ${line.slice(0, 40)}…`);
    return { type: m[1], at: m[2], taskId: m[3] ? Number(m[3]) : undefined, text: m[4].replace(/""/g, '"') };
  });
}

const books = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public-books.json'), 'utf8'));
const out = computePublicUsage(readEvents(file), asOf, books);
console.log(JSON.stringify({ since: out.since, asOf: out.asOf, totals: out.totals, books: out.books }, null, 2));
