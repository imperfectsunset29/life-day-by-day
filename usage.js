// Public usage summary for iamvalentina.us (GET /api/public/usage).
// Pure function over the events log: no file access, no server, so a script can run
// the exact same code against an exported log to check the numbers.
//
// PRIVACY: nothing a task, habit or project is called ever leaves this function, except
// book titles, and those come from public-books.json (the allowlist), never from the data.
// A finished project only becomes a book when its name exactly matches an allowlist entry.

const TZ = 'America/Los_Angeles';

// Event times are UTC; a day is the calendar date in Los Angeles (midnight to midnight).
function ptDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}

function nextDate(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const normalize = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// events: [{ type, at, taskId, text, ... }]
// asOf: "YYYY-MM-DD" (PT), the last day to include
// books: [{ project, title }] from public-books.json
function computePublicUsage(events, asOf, books = []) {
  const inRange = events
    .filter(e => e && e.type && e.at)
    .map(e => ({ ...e, day: ptDate(e.at) }))
    .filter(e => e.day <= asOf)
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const empty = { since: asOf, asOf, days: [], totals: { daysUsed: 0, daysTotal: 0, habits: 0, oneOffs: 0, projectsFinished: 0, surprisesOffered: 0, surprisesTaken: 0, longestRun: 0, currentRun: 0 }, books: [] };
  if (!inRange.length) return empty;

  const since = inRange[0].day;
  const byDay = new Map();
  for (let d = since; d <= asOf; d = nextDate(d)) byDay.set(d, { date: d, actions: 0, opened: false, finished: 0 });

  const totals = { habits: 0, oneOffs: 0, projectsFinished: 0, surprisesOffered: 0, surprisesTaken: 0 };
  const finishedProjects = new Map(); // project id -> { day, text }, first time it reached 100%

  for (const e of inRange) {
    const day = byDay.get(e.day);
    switch (e.type) {
      case 'session_start': day.opened = true; break;
      case 'habit_done': day.actions++; totals.habits++; break;
      case 'oneoff_done': day.actions++; totals.oneOffs++; break;
      case 'step_done': day.actions++; break;
      case 'project_ascended': {
        // A project counts once, on the day it first reached 100%. Restoring it from
        // Olympus and finishing it again (or a double tap) doesn't count it twice.
        const key = String(e.taskId || e.text);
        if (finishedProjects.has(key)) break;
        finishedProjects.set(key, { day: e.day, text: e.text });
        day.actions++; day.finished++; totals.projectsFinished++;
        break;
      }
      case 'surprise_surfaced': totals.surprisesOffered++; break;
      case 'surprise_acted': totals.surprisesTaken++; break;
    }
  }

  // A day is "used" when the app was opened or something was done in it.
  const days = [...byDay.values()];
  const used = d => d.opened || d.actions > 0;
  let longestRun = 0, run = 0;
  for (const d of days) { run = used(d) ? run + 1 : 0; longestRun = Math.max(longestRun, run); }
  // Current run ends today, or yesterday if today hasn't been used yet (the day isn't over).
  let currentRun = 0;
  let i = days.length - 1;
  if (i >= 0 && !used(days[i])) i--;
  for (; i >= 0 && used(days[i]); i--) currentRun++;

  const allow = new Map(books.map(b => [normalize(b.project), b.title]));
  const bookList = [...finishedProjects.values()]
    .filter(p => allow.has(normalize(p.text)))
    .map(p => ({ title: allow.get(normalize(p.text)), finishedOn: p.day }))
    .sort((a, b) => (a.finishedOn < b.finishedOn ? -1 : 1));

  return {
    since,
    asOf,
    days,
    totals: {
      daysUsed: days.filter(used).length,
      daysTotal: days.length,
      ...totals,
      longestRun,
      currentRun,
    },
    books: bookList,
  };
}

module.exports = { computePublicUsage, ptDate };
