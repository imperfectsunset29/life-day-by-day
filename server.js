const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : __dirname;
const TASKS_FILES = {
  vc: path.join(DATA_DIR, 'tasks.json'),
  fg: path.join(DATA_DIR, 'tasks-fg.json'),
};
const EVENTS_FILES = {
  vc: path.join(DATA_DIR, 'events.json'),
  fg: path.join(DATA_DIR, 'events-fg.json'),
};

function getTasksFile(profile) {
  return TASKS_FILES[profile] || TASKS_FILES.vc;
}

function getEventsFile(profile) {
  return EVENTS_FILES[profile] || EVENTS_FILES.vc;
}

function profileFrom(req) {
  const p = (req.headers['x-profile'] || 'vc').toLowerCase();
  return p === 'fg' ? 'fg' : 'vc';
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD not set — VC running in dev mode.');
if (!process.env.FG_ADMIN_PASSWORD) console.warn('WARNING: FG_ADMIN_PASSWORD not set — FG running in dev mode.');

app.get('/api/auth-mode', (req, res) => {
  const profile = profileFrom(req);
  const passwordRequired = profile === 'fg' ? !!process.env.FG_ADMIN_PASSWORD : !!process.env.ADMIN_PASSWORD;
  res.json({ passwordRequired });
});

function requireAdmin(req, res, next) {
  const profile = profileFrom(req);
  const expectedPw = profile === 'fg' ? process.env.FG_ADMIN_PASSWORD : process.env.ADMIN_PASSWORD;
  if (!expectedPw) return next(); // dev mode: this profile's password not set
  const pw = req.headers['x-admin-password'];
  if (!pw || pw !== expectedPw) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Returns the "YYYY-MM-DD" (PT) of the most recent Sunday whose 23:59 PT has already passed.
// If it's currently Sunday but before 23:59 PT, returns last Sunday's date.
function getLastSundayPT() {
  const now = new Date();
  // Build a fake Date object whose getDay/getHours/etc. reflect PT local time
  const ptDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const dayOfWeek = ptDate.getDay();   // 0 = Sun
  const hour     = ptDate.getHours();
  const minute   = ptDate.getMinutes();

  // How many days to roll back to reach the most recent Sunday 23:59?
  let daysBack = dayOfWeek; // e.g. Mon=1, Tue=2 ... Sat=6 → last Sunday
  if (dayOfWeek === 0 && (hour < 23 || (hour === 23 && minute < 59))) {
    daysBack = 7; // it's Sunday but the 23:59 window hasn't hit yet — use previous Sunday
  }

  const sundayPT = new Date(ptDate);
  sundayPT.setDate(sundayPT.getDate() - daysBack);
  const y = sundayPT.getFullYear();
  const m = String(sundayPT.getMonth() + 1).padStart(2, '0');
  const d = String(sundayPT.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayPT() {
  const now = new Date();
  const ptDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const y = ptDate.getFullYear();
  const m = String(ptDate.getMonth() + 1).padStart(2, '0');
  const d = String(ptDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const WARDROBE_SUBCATS = {
  tops: ['T-shirts', 'Blouses & Shirts', 'Sweaters & Knits', 'Cardigans', 'Tanks & Camisoles', 'Other'],
  bottoms: ['Jeans', 'Trousers & Pants', 'Skirts', 'Shorts', 'Leggings', 'Other'],
  dresses: ['Casual Dresses', 'Cocktail & Party', 'Formal & Evening', 'Maxi Dresses', 'Wrap Dresses', 'Other'],
  jumpsuitsRompers: ['Jumpsuits', 'Rompers', 'Overalls', 'Other'],
  shoes: ['Sneakers', 'Boots', 'Heels', 'Flats & Loafers', 'Sandals', 'Other'],
  outerwear: ['Coats', 'Jackets', 'Blazers', 'Vests', 'Other'],
  accessories: ['Bags', 'Jewelry', 'Scarves', 'Belts', 'Hats', 'Other']
};

// Claude sometimes wraps JSON replies in ```json fences despite instructions not to — strip before parsing.
function parseJsonFromModel(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

// Turns an Anthropic API error into something a non-technical user can act on,
// instead of the raw "400 {\"type\":\"error\",...}" JSON blob the SDK throws.
function friendlyAnthropicError(err) {
  const msg = err.message || '';
  const usageLimit = msg.match(/reached your specified API usage limits.*?regain access on ([^."]+)/i);
  if (usageLimit) return `Anthropic API usage limit reached — resets ${usageLimit[1].trim()}. Check console.anthropic.com to adjust it.`;
  if (/rate_limit/i.test(msg) || err.status === 429) return 'Anthropic API is rate-limited right now — try again in a bit.';
  return err.message;
}

// Enforce outfit coherence regardless of what the model (or the no-AI fallback) picked:
// no repeated item, at most one item per category, and a single one-piece garment
// (dress or jumpsuit/romper) replaces top+bottom rather than joining them.
const ONE_PIECE_CATEGORIES = ['dresses', 'jumpsuitsRompers'];
function sanitizeOutfit(items) {
  const seenIds = new Set();
  const seenCats = new Set();
  const deduped = items.filter(item => {
    if (seenIds.has(item.id) || seenCats.has(item.wardrobeCategory)) return false;
    seenIds.add(item.id);
    seenCats.add(item.wardrobeCategory);
    return true;
  });
  const onePiece = deduped.find(i => ONE_PIECE_CATEGORIES.includes(i.wardrobeCategory));
  if (!onePiece) return deduped;
  return deduped.filter(i =>
    i === onePiece ||
    (i.wardrobeCategory !== 'tops' && i.wardrobeCategory !== 'bottoms' && !ONE_PIECE_CATEGORIES.includes(i.wardrobeCategory))
  );
}

// WMO weather codes used by Open-Meteo — https://open-meteo.com/en/docs
const WEATHER_CODES = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'depositing rime fog',
  51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
  56: 'light freezing drizzle', 57: 'dense freezing drizzle',
  61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain',
  66: 'light freezing rain', 67: 'heavy freezing rain',
  71: 'slight snow', 73: 'moderate snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'slight rain showers', 81: 'moderate rain showers', 82: 'violent rain showers',
  85: 'slight snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with slight hail', 99: 'thunderstorm with heavy hail'
};

// Free, no-API-key weather lookup for the outfit suggester.
async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const current = data.current;
    if (!current) return null;
    return {
      tempF: Math.round(current.temperature_2m),
      description: WEATHER_CODES[current.weather_code] || 'unknown conditions'
    };
  } catch {
    return null;
  }
}

const fallbackPynchonQuotes = [
  "Another system dismantled from within. They said it couldn't be done, but They say a lot of things.",
  "The project is complete, which means of course that it was never really about the project at all.",
  "Somewhere between the first commit and the last, the paranoia lifted — briefly — and what remained was something almost like accomplishment.",
  "They will tell you it was inevitable. They will be wrong. You chose this, against every entropic tendency of the universe.",
  "Finished. A word that implies endings, but the real ones — the ones that matter — only rearrange the furniture in rooms you haven't entered yet.",
  "And so it ascends, this strange artifact of will and caffeine, to take its place among the completed things, which is to say, among the myths.",
  "The signal has been sent. Whether anyone receives it is, as always, beside the point. The work was the transmission.",
  "Consider: every finished project is a small death, a version of yourself you'll never need to be again. Mourn briefly. Move on.",
  "In the grand calculus of Things Done and Things Left Undone, this one tips the scale — imperceptibly, but it tips.",
  "You have emerged from the other side of it. The other side looks remarkably like this side, except now you know something you didn't before.",
  "What was once a project is now a ghost, haunting the margins of your to-do list with the quiet satisfaction of the completed.",
  "Done, they say. But done is just the present tense of a future someone else will have to maintain.",
  "The conspiracy of incompletion has been thwarted, at least temporarily. Celebrate with the appropriate level of suspicion.",
  "It joins the archive now, this thing you made, filed somewhere between ambition and accident, which is where all the best work lives.",
  "Preterite no more. This one has been elected, chosen, elevated above the merely attempted into the rarefied air of the actually finished.",
  "Against all probability — and the probability was considerable — the thing got done. The universe adjusts its ledgers accordingly.",
  "A trajectory completed. Not the parabolic arc of a rocket, perhaps, but something. Definitely something.",
  "You have proven, once again, that entropy is not the only game in town. Order can be imposed. Briefly.",
  "The work is finished, which means it has already begun its slow transformation into something you'll remember differently.",
  "Somewhere a bell rings for completed projects. You can't hear it, but the dogs can, and they are impressed.",
  "This was not supposed to be possible, according to several theories you yourself advanced at 2 AM on a Tuesday. And yet.",
  "Filed under: Things That Actually Happened, subsection: Against The Odds, cross-referenced with: Who Would Have Thought.",
  "The gravitational pull of unfinished business releases its hold, and for a moment you float, weightless, in the space between tasks.",
  "Another one wrestled from the jaws of procrastination, that great beast with infinite patience and excellent Wi-Fi.",
];

const defaultTasks = {
  oneOff: [
    { id: 1, text: "Pick up candle", done: false },
    { id: 2, text: "Wash blanket", done: false },
    { id: 3, text: "Print pictures of HK and JPN", done: false },
    { id: 4, text: "Put clothes to sell", done: false },
    { id: 5, text: "Organize clothes from suitcase closet", done: false },
    { id: 6, text: "Clean candle vessels", done: false },
    { id: 7, text: "Fix water ring", done: false },
    { id: 8, text: "Send Patrick response", done: false },
    { id: 9, text: "Go to eye exam", done: false },
    { id: 10, text: "Send mom eye prescription", done: false }
  ],
  habits: [
    { id: 101, text: "Stretching", doneToday: false, lastDoneDate: null },
    { id: 102, text: "Foam roll", doneToday: false, lastDoneDate: null },
    { id: 103, text: "Gua sha", doneToday: false, lastDoneDate: null },
    { id: 104, text: "Dry brushing", doneToday: false, lastDoneDate: null },
    { id: 105, text: "Hang from bar", doneToday: false, lastDoneDate: null },
    { id: 106, text: "Drink collagen", doneToday: false, lastDoneDate: null },
    { id: 107, text: "Plank", doneToday: false, lastDoneDate: null },
    { id: 205, text: "Hobochini", doneToday: false, lastDoneDate: null }
  ],
  projects: [
    { id: 201, text: "Interaction design foundation courses", progress: 0 },
    { id: 202, text: "Accent practice", progress: 0 },
    { id: 203, text: "Read for RS", progress: 0 },
    { id: 204, text: "Job search", progress: 0 },
    { id: 206, text: "Personal webpage", progress: 0 }
  ],
  treats: [
    { id: 401, text: "Watch a movie" },
    { id: 402, text: "Take a long bath" },
    { id: 403, text: "Go to a café with a book" },
    { id: 404, text: "Buy yourself flowers" },
    { id: 405, text: "Cook something elaborate" },
    { id: 406, text: "Call a friend" },
    { id: 407, text: "Go for a walk with no destination" },
    { id: 408, text: "Try a new recipe" },
    { id: 409, text: "Rearrange a shelf" },
    { id: 410, text: "Listen to a full album start to finish" }
  ],
  hardThings: [],
  shoppingList: [],
  wardrobe: [],
  dreams: [],
  done: [],
  olympus: [],
  lastDoneCleared: null,
  nextId: 500
};

const defaultFgTasks = {
  oneOff: [],
  habits: [],
  projects: [],
  treats: [],
  hardThings: [],
  shoppingList: [],
  wardrobe: [],
  dreams: [],
  done: [],
  olympus: [],
  oracle: { text: '', source: '', preview: '' },
  lastDoneCleared: null,
  nextId: 1
};

// Returns the current "habit day" in PT, with the day rolling over at 5 AM PT.
// Between midnight and 4:59 AM PT, it's still considered the previous habit-day.
function getHabitDay() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).formatToParts(now);
  const year  = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day   = parts.find(p => p.type === 'day').value;
  const hour  = parseInt(parts.find(p => p.type === 'hour').value, 10);

  // Before 5 AM PT still belongs to the previous habit-day
  if (hour < 5) {
    const d = new Date(`${year}-${month}-${day}T12:00:00`); // noon to avoid any DST edge
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  return `${year}-${month}-${day}`;
}

function readTasks(profile) {
  const file = getTasksFile(profile || 'vc');
  const defaults = profile === 'fg' ? defaultFgTasks : defaultTasks;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2));
    return JSON.parse(JSON.stringify(defaults));
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Ensure new fields exist for migration
  if (!data.done) data.done = [];
  if (!data.olympus) data.olympus = [];
  if (!data.treats) data.treats = [];
  if (!data.hardThings) data.hardThings = [];
  if (!data.shoppingList) data.shoppingList = [];
  if (!data.wardrobe) data.wardrobe = [];
  if (!data.dreams) data.dreams = [];
  if (!data.wearLog) data.wearLog = [];
  if (!data.wishlist) data.wishlist = [];
  if (!data.acquired) data.acquired = [];
  if (!data.oracle) data.oracle = { text: '', source: '', preview: '' };
  if (data.oracle.preview === undefined) data.oracle.preview = '';
  if (data.lastDoneCleared === undefined) data.lastDoneCleared = null;
  if (data.lastShoppingCleared === undefined) data.lastShoppingCleared = null;
  let changed = false;
  for (const project of data.projects) {
    if (!project.steps) project.steps = [];
    for (const step of project.steps) {
      if (step.completedAt === undefined) {
        step.completedAt = step.done ? new Date().toISOString() : null;
        changed = true;
      }
    }
  }

  // Move completed steps older than 1 hour into the done list
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const project of data.projects) {
    const toMigrate = project.steps.filter(s =>
      s.done && s.completedAt && new Date(s.completedAt).getTime() < oneHourAgo
    );
    if (toMigrate.length > 0) {
      for (const step of toMigrate) {
        data.done.push({
          id: step.id,
          text: `${project.text} → ${step.text}`,
          completedAt: step.completedAt
        });
      }
      project.steps = project.steps.filter(s => !toMigrate.some(m => m.id === s.id));
      changed = true;
    }
  }

  // Reset habits if the habit-day has changed (rolls over at 5 AM PT)
  const today = getHabitDay();
  for (const habit of data.habits) {
    if (habit.lastDoneDate !== today && habit.doneToday) {
      habit.doneToday = false;
      changed = true;
    }
  }

  // Clear done list every Sunday at 23:59 PT
  const lastSunday = getLastSundayPT();
  if (data.lastDoneCleared !== lastSunday && data.done.length > 0) {
    data.done = [];
    data.lastDoneCleared = lastSunday;
    changed = true;
  } else if (data.lastDoneCleared !== lastSunday) {
    // No items to clear but still record the sweep so we don't re-check
    data.lastDoneCleared = lastSunday;
    changed = true;
  }

  // One-time split of the old single shopping list: anything with a link was a want,
  // not an errand, so it moves to the wishlist. Everything else stays in errands.
  if (!data.shoppingSplit) {
    const isWant = i => !i.done && /https?:\/\/\S+/i.test(i.text);
    for (const item of data.shoppingList.filter(isWant)) {
      data.wishlist.push({ id: item.id, text: item.text, note: '', createdAt: item.createdAt || new Date().toISOString() });
    }
    data.shoppingList = data.shoppingList.filter(i => !isWant(i));
    data.shoppingSplit = true;
    changed = true;
  }

  // Clear done shopping list items at the end of each PT day
  const todayPT = getTodayPT();
  if (data.lastShoppingCleared !== todayPT) {
    if (data.shoppingList.some(i => i.done)) {
      data.shoppingList = data.shoppingList.filter(i => !i.done);
    }
    data.lastShoppingCleared = todayPT;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  return data;
}

function writeTasks(data, profile) {
  fs.writeFileSync(getTasksFile(profile || 'vc'), JSON.stringify(data, null, 2));
}

function logEvent(type, payload, profile) {
  const file = getEventsFile(profile || 'vc');
  const events = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  events.push({ type, at: new Date().toISOString(), ...payload });
  fs.writeFileSync(file, JSON.stringify(events, null, 2));
}

// ---- Pynchon quotes (project ascension + one-off celebration) ----
// Repetition comes from asking the same question the same way every time, so each request
// gets: the specific thing that was finished, a randomly drawn angle, and the recent quotes
// it must not echo. The house motifs (entropy, "They", hidden systems) are a palette to
// draw from occasionally, not a checklist every quote has to tick.

// Each angle is a different doorway into the same voice — one is drawn at random per quote.
const PYNCHON_ANGLES = [
  'a dispatch from a secret postal service that has been tracking this project',
  'a line from a song a minor character bursts into, complete with an absurd detail',
  'a footnote from the official history of some company that does not quite exist',
  'a rule from a paranoid\'s private rulebook',
  'the trajectory of something launched — and where it actually came down',
  'an overheard bit of conversation in a bar at 3 a.m. between two people who know too much',
  'an inventory of strange objects left behind after the work was done',
  'a radio announcer reporting the finish as though it were weather or traffic',
  'a mid-century bureaucratic memo, stamped and countersigned, approving the finish',
  'a scientist\'s lab note recording an anomaly that turns out to be you',
  'the view from a minor saint, a lightbulb, or another unlikely witness',
  'a misprinted map in which this finished thing is marked as a place',
  'a bit of vaudeville or a slapstick routine that turns suddenly tender',
  'a conspiracy theory explaining why this, of all things, got done',
  'the moment just after the finish, rendered with absurd, precise physical detail',
  'an elegy that keeps getting interrupted by something ridiculous',
];

const recentCelebrationQuotes = { vc: [], fg: [] }; // in-memory; one-off quotes aren't persisted

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildPynchonPrompt({ occasion, subject, avoid }) {
  const angle = pickRandom(PYNCHON_ANGLES);
  const avoidBlock = avoid.length
    ? `\n\nThese recent quotes have already been used. Yours must share none of their images, openings, sentence shapes, or key words:\n${avoid.map(q => `- ${q}`).join('\n')}`
    : '';
  return `Write one short aphorism (1–3 sentences) in the voice of Thomas Pynchon, marking this moment: ${occasion}${subject ? ` The thing finished was: "${subject}". Let it shape the quote obliquely — a specific detail, not a summary.` : ''}

Come at it through this angle: ${angle}.

The register is sardonic, paranoid, literary, darkly funny, and it should land as a small reward for the person who finished. Surprise is the priority: reach for concrete, unexpected images over stock gestures. Do not lean on the default moves (the word "entropy", a capitalized "They", "And yet.", "Filed under", "somewhere a bell rings"); use one only if it's genuinely fresh here. Make it a complete thought — no em-dash openings, no fragments, no trailing off.${avoidBlock}

Return only the quote, with no attribution or preamble.`;
}

async function generatePynchon({ occasion, subject, avoid, fallbacks }) {
  const freshFallback = () => {
    const unused = fallbacks.filter(q => !avoid.includes(q));
    return pickRandom(unused.length ? unused : fallbacks);
  };
  if (!anthropic) return freshFallback();
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 300,
      messages: [{ role: 'user', content: buildPynchonPrompt({ occasion, subject, avoid }) }]
    });
    const text = msg.content.find(b => b.type === 'text');
    return (text && text.text.trim().replace(/^["“]|["”]$/g, '')) || freshFallback();
  } catch {
    return freshFallback();
  }
}

function getProjectReflection(projectText, data) {
  const avoid = (data.olympus || []).map(o => o.reflection).filter(Boolean).slice(-12);
  return generatePynchon({
    occasion: 'a project has just been carried all the way to 100% and ascends to Olympus.',
    subject: projectText,
    avoid,
    fallbacks: fallbackPynchonQuotes
  });
}

// Add a step to a project
app.post('/api/tasks/projects/:id/steps', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { id } = req.params;
  const { text } = req.body;
  const project = data.projects.find(t => t.id === Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.steps) project.steps = [];
  const stepId = data.nextId++;
  project.steps.push({ id: stepId, text, done: false });
  writeTasks(data, profile);
  res.json(project);
});

// Update a step (toggle done or rename)
app.put('/api/tasks/projects/:id/steps/:stepId', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { id, stepId } = req.params;
  const project = data.projects.find(t => t.id === Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const step = project.steps && project.steps.find(s => s.id === Number(stepId));
  if (!step) return res.status(404).json({ error: 'Step not found' });

  if (req.body.text !== undefined) step.text = req.body.text;
  if (req.body.done !== undefined) {
    step.done = req.body.done;
    step.completedAt = req.body.done ? new Date().toISOString() : null;
    if (req.body.done) logEvent('step_done', { taskId: step.id, text: step.text, projectId: Number(id), projectText: project.text }, profile);
    else logEvent('step_undone', { taskId: step.id, text: step.text, projectId: Number(id), projectText: project.text }, profile);
  }

  writeTasks(data, profile);
  res.json(project);
});

// Delete a step
app.delete('/api/tasks/projects/:id/steps/:stepId', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { id, stepId } = req.params;
  const project = data.projects.find(t => t.id === Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.steps) return res.status(404).json({ error: 'Step not found' });
  const deletedStep = project.steps.find(s => s.id === Number(stepId));
  if (deletedStep) logEvent('step_deleted', { taskId: deletedStep.id, text: deletedStep.text, projectId: Number(id), projectText: project.text }, profile);
  project.steps = project.steps.filter(s => s.id !== Number(stepId));

  writeTasks(data, profile);
  res.json({ success: true });
});

// Analyze clothing photos with Claude vision — returns extracted metadata, discards images
app.post('/api/wardrobe/analyze-photo', requireAdmin, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY' });
  try {
    const { images } = req.body;
    if (!images || !images.length) return res.status(400).json({ error: 'No images provided' });
    const imageBlocks = images.map(({ image, mimeType }) => ({
      type: 'image',
      source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: image }
    }));
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          { type: 'text', text: `These are photos of the same clothing item. Analyze them together for accuracy. Return ONLY a JSON object with these keys: category (one of: tops, bottoms, dresses, jumpsuitsRompers, shoes, outerwear, accessories), subcategory (pick the single best match from the list for whichever category you chose above — ${Object.entries(WARDROBE_SUBCATS).map(([cat, subs]) => `${cat}: ${subs.join(', ')}`).join(' | ')}), brand (visible brand name or empty string), color (main color in 2-3 words), material (e.g. linen, denim, knit wool — infer from texture), pattern (one of: solid, stripes, plaid, floral, graphic, geometric, other), occasion (one of: casual, formal, sporty, evening, business), season (one of: summer, winter, spring, autumn, all), text (short descriptive name e.g. "white linen shirt"). Raw JSON only, no markdown.` }
        ]
      }]
    });
    res.json(parseJsonFromModel(message.content[0].text));
  } catch (err) {
    console.error('Wardrobe photo analysis failed:', err);
    res.status(500).json({ error: friendlyAnthropicError(err) });
  }
});

// Suggest an outfit from the wardrobe given a free-text prompt
// Random pick per category — used when there's no API key configured, and as a
// fallback so a hiccup building the AI outfit still leaves the user with *something*
// rather than an empty result that reads as "you have no clothes."
function randomOutfitPick(wardrobe) {
  const cats = ['tops', 'bottoms', 'dresses', 'jumpsuitsRompers', 'shoes', 'outerwear', 'accessories'];
  return cats
    .map(cat => {
      const pool = wardrobe.filter(i => i.wardrobeCategory === cat);
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    })
    .filter(Boolean);
}

app.post('/api/wardrobe/suggest-outfit', async (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { prompt, lat, lon } = req.body;
  if (!data.wardrobe || !data.wardrobe.length) return res.json({ items: [], wardrobeEmpty: true });

  const weather = (typeof lat === 'number' && typeof lon === 'number') ? await fetchWeather(lat, lon) : null;
  const weatherLine = weather ? `Current weather at the user's location: ${weather.tempF}°F, ${weather.description}.` : '';

  // Try the AI stylist, but never let it be a hard failure — any problem (usage limits,
  // rate limits, a bad network hiccup, an unparsable response) just falls back to a
  // random pick so the user always gets *an* outfit rather than a raw error message.
  let items = null;
  if (anthropic) {
    try {
      const stats = computeWardrobeStats(data);
      const inventory = data.wardrobe.map(i => {
        const st = stats.items[i.id];
        const worn = st.timesWorn ? `worn:${st.timesWorn}x, last:${st.lastWorn}` : 'worn:never';
        return `ID:${i.id} | ${i.wardrobeCategory} | ${i.brand ? i.brand + ' ' : ''}${i.text} | color:${i.color || ''} | ${i.material || ''} | pattern:${i.pattern || ''} | occasion:${i.occasion || ''} | season:${i.season || ''} | ${worn}`;
      }).join('\n');

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `You are a personal stylist. Wardrobe inventory:\n${inventory}\n\n${weatherLine}\n\nBuild an outfit for: "${prompt}"\n\nPick the best combination: at most one item per category, never the same item twice, compatible patterns and seasons${weather ? ', and appropriate for the current weather (temperature and precipitation/wind implied by the conditions)' : ''}. A dress or jumpsuit/romper is a complete base layer — if you pick one, do not also pick a top or bottom. Otherwise pick one top and one bottom. When two pieces suit the prompt about equally well, favor the one worn least recently (or never) so the whole closet stays in rotation. Return ONLY a JSON array of item IDs (numbers). Raw JSON array only, no markdown.`
        }]
      });

      let ids;
      try {
        ids = parseJsonFromModel(message.content[0].text);
      } catch {
        // Model added commentary or otherwise didn't return clean JSON — pull the
        // first bracketed array out of the text instead of failing the whole request.
        const match = message.content[0].text.match(/\[[\s\d,]*\]/);
        ids = match ? JSON.parse(match[0]) : [];
      }
      items = ids.map(id => data.wardrobe.find(i => i.id === id)).filter(Boolean);
    } catch (err) {
      console.error('AI outfit suggestion unavailable, falling back to random pick:', friendlyAnthropicError(err));
    }
  }
  // No AI configured, the AI call failed, or it picked nothing usable — random pick,
  // rather than showing an empty "add clothes" result when the wardrobe has items.
  if (!items || items.length === 0) items = randomOutfitPick(data.wardrobe);

  res.json({ items: sanitizeOutfit(items), weather });
});

// ---- Wardrobe history: wear log, stats, dossier ----
// "Love it" on a suggested outfit records a wear. Everything else (last worn, times worn,
// best friends, a garment's story, the closet line) is derived from that log on request.

const WEAR_STORY_LENGTH = 3;   // recent wears shown on a garment's card
const FRIEND_MIN_TOGETHER = 2; // worn together at least this often to count as friends

function daysAgo(dateStr) {
  const then = new Date(`${dateStr}T12:00:00`);
  const now = new Date(`${getHabitDay()}T12:00:00`);
  return Math.round((now - then) / 86400000);
}

function computeWardrobeStats(data) {
  const items = {};
  for (const item of data.wardrobe) {
    items[item.id] = { timesWorn: 0, lastWorn: null, daysSinceWorn: null, friends: [], story: [] };
  }
  const together = {}; // id -> { otherId -> count }

  // Oldest first, so the last write for each item is its most recent wear
  for (const wear of data.wearLog) {
    const ids = wear.itemIds.filter(id => items[id]);
    for (const id of ids) {
      const st = items[id];
      st.timesWorn++;
      st.lastWorn = wear.date;
      st.story.unshift({ date: wear.date, prompt: wear.prompt, weather: wear.weather });
      together[id] = together[id] || {};
      for (const other of ids) {
        if (other !== id) together[id][other] = (together[id][other] || 0) + 1;
      }
    }
  }

  for (const [id, st] of Object.entries(items)) {
    st.story = st.story.slice(0, WEAR_STORY_LENGTH);
    if (st.lastWorn) st.daysSinceWorn = daysAgo(st.lastWorn);
    st.friends = Object.entries(together[id] || {})
      .filter(([, n]) => n >= FRIEND_MIN_TOGETHER)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([otherId, n]) => ({ id: Number(otherId), count: n }));
  }

  const colors = new Set(data.wardrobe.map(i => (i.color || '').trim().toLowerCase()).filter(Boolean));
  let mostLoyal = null;
  for (const item of data.wardrobe) {
    const n = items[item.id].timesWorn;
    if (n === 0) continue;
    const best = mostLoyal && items[mostLoyal.id];
    // Ties go to whichever was worn most recently
    if (!best || n > best.timesWorn || (n === best.timesWorn && items[item.id].lastWorn > best.lastWorn)) mostLoyal = item;
  }

  return {
    items,
    summary: {
      pieces: data.wardrobe.length,
      colors: colors.size,
      mostLoyal: mostLoyal ? { id: mostLoyal.id, text: mostLoyal.text } : null
    }
  };
}

app.get('/api/wardrobe/stats', (req, res) => {
  res.json(computeWardrobeStats(readTasks(profileFrom(req))));
});

// Records a worn outfit (from "Love it")
app.post('/api/wardrobe/wear', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const known = new Set(data.wardrobe.map(i => i.id));
  const itemIds = (Array.isArray(req.body.itemIds) ? req.body.itemIds : []).map(Number).filter(id => known.has(id));
  if (!itemIds.length) return res.status(400).json({ error: 'No known garments in outfit' });

  const wear = {
    id: data.nextId++,
    date: getHabitDay(),
    wornAt: new Date().toISOString(),
    itemIds,
    prompt: typeof req.body.prompt === 'string' ? req.body.prompt.slice(0, 200) : '',
    weather: typeof req.body.weather === 'string' ? req.body.weather.slice(0, 100) : ''
  };
  data.wearLog.push(wear);
  writeTasks(data, profile);
  logEvent('outfit_worn', { itemIds, prompt: wear.prompt }, profile);
  res.json(wear);
});

// A one-line, Pynchon-voiced file on a garment, written from its real history. Cached on the
// item and only rewritten once the garment has been worn again since the last one was written.
app.post('/api/wardrobe/:id/dossier', requireAdmin, async (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const item = data.wardrobe.find(i => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Garment not found' });

  const stats = computeWardrobeStats(data);
  const st = stats.items[item.id];
  if (item.dossier && item.dossier.wearCount === st.timesWorn) return res.json({ dossier: item.dossier.text });
  if (!anthropic) return res.json({ dossier: null });

  const nameOf = id => (data.wardrobe.find(i => i.id === id) || {}).text;
  const facts = [
    `Garment: ${[item.brand, item.text].filter(Boolean).join(' ')} (${[item.color, item.material, item.pattern].filter(Boolean).join(', ')})`,
    st.timesWorn ? `Worn ${st.timesWorn} time(s); last on ${st.lastWorn}` : 'Never worn yet',
    st.friends.length ? `Most often worn with: ${st.friends.map(f => `${nameOf(f.id)} (${f.count}x)`).join('; ')}` : '',
    st.story.length ? `Recent outings (the wearer's own words): ${st.story.map(w => `"${w.prompt}"${w.weather ? ` at ${w.weather}` : ''}`).join('; ')}` : '',
    item.origin ? `Origin: ${item.origin}` : '',
    item.acquired ? `Acquired: ${item.acquired}` : '',
    item.memory ? `The wearer's memory of it: ${item.memory}` : ''
  ].filter(Boolean).join('\n');

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Write a one- or two-sentence dossier entry on this garment, in the voice of Thomas Pynchon: as if a paranoid, half-amused intelligence service has been keeping a file on it. Sardonic, literary, affectionate underneath. Build it only from the facts below, using at least one specific detail. If it has never been worn, treat that as its own small mystery. Avoid stock moves like the word "entropy" or a capitalized "They" unless they're genuinely fresh here.\n\n${facts}\n\nReturn only the entry, with no title, label or quotes.`
      }]
    });
    const text = msg.content.find(b => b.type === 'text');
    const dossier = text ? text.text.trim().replace(/^["“]|["”]$/g, '') : null;
    if (dossier) {
      item.dossier = { text: dossier, wearCount: st.timesWorn, generatedAt: new Date().toISOString() };
      writeTasks(data, profile);
    }
    res.json({ dossier });
  } catch (err) {
    console.error('Dossier unavailable:', friendlyAnthropicError(err));
    res.json({ dossier: item.dossier ? item.dossier.text : null });
  }
});

// Blocks requests to internal/private network addresses — this endpoint fetches
// arbitrary user-supplied URLs, so it shouldn't be usable to probe internal services.
function isPrivateHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '0.0.0.0'
    || /^127\./.test(h)
    || /^10\./.test(h)
    || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || /^169\.254\./.test(h);
}

function decodeHtmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Fetches a linked page's title (and image, if any) so a pasted URL can show real
// context instead of just its domain — plain HTTP fetch, no AI/paid API involved.
app.get('/api/link-preview', requireAdmin, async (req, res) => {
  const { url } = req.query;
  let parsed;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (isPrivateHostname(parsed.hostname)) return res.status(400).json({ error: 'Invalid URL' });

  try {
    const response = await fetch(parsed.href, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LifeDayByDayBot/1.0)' }
    });
    if (!response.ok) return res.json({ title: null, image: null });

    const html = (await response.text()).slice(0, 200000);
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

    const title = ogTitle ? decodeHtmlEntities(ogTitle[1]).trim() : titleTag ? decodeHtmlEntities(titleTag[1]).trim() : null;
    const image = ogImage ? ogImage[1].trim() : null;
    res.json({ title, image });
  } catch (err) {
    console.error('Link preview failed for', url, err.message);
    res.json({ title: null, image: null });
  }
});

// Get all tasks
app.get('/api/tasks', (req, res) => {
  const profile = profileFrom(req);
  res.json(readTasks(profile));
});

// Add a task
app.post('/api/tasks/:category', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { category } = req.params;
  const { text } = req.body;
  if (!['oneOff', 'habits', 'projects', 'treats', 'hardThings', 'shoppingList', 'wishlist', 'wardrobe', 'dreams'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const id = data.nextId++;
  const createdAt = new Date().toISOString();
  const body = req.body;
  const task = category === 'habits'
    ? { id, text, doneToday: false, lastDoneDate: null, createdAt }
    : category === 'treats' || category === 'hardThings'
    ? { id, text, createdAt }
    : category === 'dreams'
    ? { id, text, image: body.image || '', createdAt }
    : category === 'shoppingList'
    ? { id, text, done: false, createdAt }
    : category === 'wishlist'
    ? { id, text, note: '', createdAt }
    : category === 'projects'
    ? { id, text, progress: 0, createdAt }
    : category === 'wardrobe'
    ? { id, text: body.text, brand: body.brand || '', color: body.color || '', material: body.material || '', pattern: body.pattern || '', occasion: body.occasion || '', season: body.season || 'all', wardrobeCategory: body.wardrobeCategory || 'tops', subcategory: body.subcategory || '', origin: body.origin || '', acquired: body.acquired || '', memory: body.memory || '', createdAt }
    : { id, text, done: false, createdAt };
  data[category].unshift(task);
  logEvent('task_created', { taskId: id, text, category }, profile);
  writeTasks(data, profile);
  res.json(task);
});

// Reorder tasks within a category
app.put('/api/tasks/:category/reorder', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { category } = req.params;
  const { ids } = req.body;
  if (!['oneOff', 'habits', 'projects', 'treats', 'hardThings', 'shoppingList', 'wishlist', 'wardrobe', 'dreams'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const items = data[category];
  data[category] = ids.map(id => items.find(t => t.id === Number(id))).filter(Boolean);
  writeTasks(data, profile);
  res.json({ success: true });
});

// ---- Shopping: errands (shoppingList) and wishlist ----

// Bought a wish: it moves to the Acquired archive, remembering how long it was wanted
app.post('/api/wishlist/:id/acquire', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const wish = data.wishlist.find(w => w.id === Number(req.params.id));
  if (!wish) return res.status(404).json({ error: 'Wish not found' });

  const acquiredAt = new Date().toISOString();
  const entry = { id: wish.id, text: wish.text, note: wish.note || '', createdAt: wish.createdAt, acquiredAt };
  data.acquired.push(entry);
  data.wishlist = data.wishlist.filter(w => w.id !== wish.id);
  writeTasks(data, profile);
  logEvent('wish_acquired', { taskId: wish.id, text: wish.text }, profile);
  res.json(entry);
});

// Moves an item between errands and the wishlist (it keeps its id and text)
app.post('/api/shopping/move', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const id = Number(req.body.id);
  const to = req.body.to;
  if (to !== 'wishlist' && to !== 'shoppingList') return res.status(400).json({ error: 'Invalid destination' });
  const from = to === 'wishlist' ? 'shoppingList' : 'wishlist';
  const item = data[from].find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  data[from] = data[from].filter(i => i.id !== id);
  data[to].push(to === 'wishlist'
    ? { id, text: item.text, note: '', createdAt: item.createdAt || new Date().toISOString() }
    : { id, text: item.text, done: false, createdAt: item.createdAt || new Date().toISOString() });
  writeTasks(data, profile);
  res.json({ success: true });
});

// Update oracle
app.put('/api/oracle', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  if (req.body.text !== undefined) {
    data.oracle.text = req.body.text;
    logEvent('oracle_updated', { source: req.body.source || data.oracle.source }, profile);
  }
  if (req.body.source !== undefined) data.oracle.source = req.body.source;
  if (req.body.preview !== undefined) {
    data.oracle.preview = req.body.preview;
    if (req.body.preview) logEvent('oracle_sentence_selected', { preview: req.body.preview }, profile);
  }
  writeTasks(data, profile);
  res.json(data.oracle);
});

// Generate a one-off celebration quote
const fallbackCelebrationQuotes = [
  'The list is empty. The world, improbably, persists.',
  'All tasks resolved. The entropy was only deferred.',
  'You have named the knowable things and done them. The rest were never on the list.',
];

app.get('/api/quote/celebration', async (req, res) => {
  const profile = profileFrom(req);
  const recent = recentCelebrationQuotes[profile] || (recentCelebrationQuotes[profile] = []);
  const quote = await generatePynchon({
    occasion: 'every single item on a to-do list has just been cleared.',
    avoid: recent,
    fallbacks: fallbackCelebrationQuotes
  });
  recent.push(quote);
  if (recent.length > 12) recent.shift();
  res.json({ quote });
});

// Update a task
app.put('/api/tasks/:category/:id', requireAdmin, async (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { category, id } = req.params;
  if (!['oneOff', 'habits', 'projects', 'treats', 'hardThings', 'shoppingList', 'wishlist', 'wardrobe', 'dreams'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const task = data[category].find(t => t.id === Number(id));
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (req.body.text !== undefined) task.text = req.body.text;

  if (category === 'dreams') {
    if (req.body.image !== undefined) task.image = req.body.image;
  }

  if (category === 'wishlist') {
    if (req.body.note !== undefined) task.note = String(req.body.note).slice(0, 200);
  }

  if (category === 'wardrobe') {
    if (req.body.brand !== undefined) task.brand = req.body.brand;
    if (req.body.color !== undefined) task.color = req.body.color;
    if (req.body.material !== undefined) task.material = req.body.material;
    if (req.body.pattern !== undefined) task.pattern = req.body.pattern;
    if (req.body.occasion !== undefined) task.occasion = req.body.occasion;
    if (req.body.season !== undefined) task.season = req.body.season;
    if (req.body.wardrobeCategory !== undefined) task.wardrobeCategory = req.body.wardrobeCategory;
    if (req.body.subcategory !== undefined) task.subcategory = req.body.subcategory;
    if (req.body.origin !== undefined) task.origin = req.body.origin;
    if (req.body.acquired !== undefined) task.acquired = req.body.acquired;
    if (req.body.memory !== undefined) task.memory = req.body.memory;
  }

  if (category === 'habits') {
    if (req.body.doneToday !== undefined) {
      task.doneToday = req.body.doneToday;
      task.lastDoneDate = req.body.doneToday ? getHabitDay() : task.lastDoneDate;
      if (req.body.doneToday) logEvent('habit_done', { taskId: task.id, text: task.text }, profile);
      else logEvent('habit_undone', { taskId: task.id, text: task.text }, profile);
    }
  } else if (category === 'projects' && req.body.progress !== undefined) {
    const prevProgress = task.progress;
    task.progress = Math.max(0, Math.min(100, req.body.progress));
    logEvent('project_progress', { taskId: task.id, text: task.text, from: prevProgress, to: task.progress }, profile);

    // Auto-ascend at 100%
    if (task.progress >= 100) {
      logEvent('project_ascended', { taskId: task.id, text: task.text }, profile);
      const reflection = await getProjectReflection(task.text, data);
      data.olympus.push({
        id: task.id,
        text: task.text,
        completedAt: new Date().toISOString(),
        reflection
      });
      data.projects = data.projects.filter(t => t.id !== task.id);
      writeTasks(data, profile);
      return res.json({ ascended: true, reflection });
    }
  } else if (req.body.done !== undefined) {
    const wasDone = task.done;
    task.done = req.body.done;

    // Move to done when one-off checked
    if (req.body.done && !wasDone && category === 'oneOff') {
      logEvent('oneoff_done', { taskId: task.id, text: task.text }, profile);
      data.done.push({
        id: task.id,
        text: task.text,
        completedAt: new Date().toISOString()
      });
      data.oneOff = data.oneOff.filter(t => t.id !== task.id);
    }
  }

  writeTasks(data, profile);
  res.json(task);
});

// Delete a task
app.delete('/api/tasks/:category/:id', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { category, id } = req.params;
  if (!['oneOff', 'habits', 'projects', 'treats', 'hardThings', 'shoppingList', 'wishlist', 'acquired', 'wardrobe', 'dreams', 'done', 'olympus'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const deletedTask = data[category].find(t => t.id === Number(id));
  if (deletedTask) logEvent('task_deleted', { taskId: deletedTask.id, text: deletedTask.text, category }, profile);
  data[category] = data[category].filter(t => t.id !== Number(id));
  writeTasks(data, profile);
  res.json({ success: true });
});

// Restore a done/olympus task back to its original category
app.post('/api/restore/:category/:id', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { category, id } = req.params;
  const numId = Number(id);

  if (category === 'done') {
    const idx = data.done.findIndex(t => t.id === numId);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    const task = data.done.splice(idx, 1)[0];
    logEvent('task_restored', { taskId: task.id, text: task.text, from: 'done' }, profile);
    data.oneOff.push({ id: task.id, text: task.text, done: false });
  } else if (category === 'olympus') {
    const idx = data.olympus.findIndex(t => t.id === numId);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    const task = data.olympus.splice(idx, 1)[0];
    logEvent('task_restored', { taskId: task.id, text: task.text, from: 'olympus' }, profile);
    data.projects.push({ id: task.id, text: task.text, progress: 0 });
  } else {
    return res.status(400).json({ error: 'Can only restore from done or olympus' });
  }

  writeTasks(data, profile);
  res.json({ success: true });
});

// Get a random uncompleted task (20% treat, 20% hard thing, 60% regular pool)
app.get('/api/random', (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const excludeId = req.query.exclude ? Number(req.query.exclude) : null;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const treats = (data.treats || []).filter(t => t.id !== excludeId).map(t => ({ ...t, category: 'treats' }));
  const hardThings = (data.hardThings || []).filter(t => t.id !== excludeId).map(t => ({ ...t, category: 'hardThings' }));

  const surfaceAndReturn = (task) => {
    if (task) logEvent('surprise_surfaced', { taskId: task.id, text: task.text, category: task.category }, profile);
    res.json(task);
  };

  if (treats.length > 0 && Math.random() < 0.2) return surfaceAndReturn(pick(treats));
  if (hardThings.length > 0 && Math.random() < 0.2) return surfaceAndReturn(pick(hardThings));

  const pool = [
    ...data.oneOff.filter(t => !t.done && t.id !== excludeId).map(t => ({ ...t, category: 'oneOff' })),
    ...data.habits.filter(t => !t.doneToday && t.id !== excludeId).map(t => ({ ...t, category: 'habits' }))
  ];
  if (pool.length === 0) {
    const specials = [...treats, ...hardThings];
    return surfaceAndReturn(specials.length > 0 ? pick(specials) : null);
  }
  surfaceAndReturn(pick(pool));
});

// Log a Surprise Me outcome (acted / dismissed / skipped)
app.post('/api/surprise/outcome', (req, res) => {
  const profile = profileFrom(req);
  const { taskId, text, category, outcome } = req.body;
  if (taskId) logEvent(`surprise_${outcome}`, { taskId, text, category }, profile);
  res.json({ ok: true });
});

// Session ping — logs each time the app is opened
app.post('/api/ping', (req, res) => {
  const profile = profileFrom(req);
  logEvent('session_start', {}, profile);
  res.json({ ok: true });
});

// Export events log as CSV (admin only)
app.get('/api/export', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const file = getEventsFile(profile);
  const events = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const rows = [['type', 'at', 'taskId', 'text', 'value'].join(',')];
  for (const e of events) {
    const value = e.from !== undefined ? `${e.from}→${e.to}` : '';
    rows.push([e.type, e.at, e.taskId || '', `"${(e.text || '').replace(/"/g, '""')}"`, value].join(','));
  }
  const date = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Disposition', `attachment; filename="life-events-${profile}-${date}.csv"`);
  res.setHeader('Content-Type', 'text/csv');
  res.send(rows.join('\n'));
});

// Backup — download tasks.json as a file (admin only)
app.get('/api/backup', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const date = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Disposition', `attachment; filename="tasks-${profile}-backup-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data, null, 2));
});

app.listen(PORT, () => {
  console.log(`LIFE (day by day) running at http://localhost:${PORT}`);
});
