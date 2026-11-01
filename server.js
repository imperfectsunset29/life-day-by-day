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

// ---- Storage safety: all-or-nothing saves, daily snapshots, recovery ----

// On Railway the data must live on the mounted volume, or it's wiped on every deploy.
// Railway sets RAILWAY_ENVIRONMENT_NAME, so a missing volume there is shouted about.
const PERSISTENT = DATA_DIR === '/app/data';
if (!PERSISTENT && process.env.RAILWAY_ENVIRONMENT_NAME) {
  console.error('!!! STORAGE WARNING: /app/data volume not found. Data is being saved inside the container and WILL BE LOST on the next deploy. Reattach the volume at /app/data in Railway.');
}

const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const SNAPSHOT_KEEP_DAYS = 14;

// Write to a temp file, then rename over the real one. A rename is atomic, so a crash
// or a deploy mid-save leaves either the old file or the new one, never half of one.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function snapshotsFor(profile) {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  const prefix = `tasks-${profile}-`;
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort(); // names end in YYYY-MM-DD, so this is oldest → newest
}

// Copies today's data file into snapshots/ once per day (before the day's first save),
// keeping the last SNAPSHOT_KEEP_DAYS days per profile.
function snapshotIfDue(profile) {
  const file = getTasksFile(profile);
  if (!fs.existsSync(file)) return;
  const name = `tasks-${profile}-${getTodayPT()}.json`;
  const target = path.join(SNAPSHOT_DIR, name);
  if (fs.existsSync(target)) return;
  try {
    JSON.parse(fs.readFileSync(file, 'utf8')); // never snapshot a damaged file
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.copyFileSync(file, target);
    const all = snapshotsFor(profile);
    for (const old of all.slice(0, Math.max(0, all.length - SNAPSHOT_KEEP_DAYS))) {
      fs.unlinkSync(path.join(SNAPSHOT_DIR, old));
    }
  } catch (err) {
    console.error(`Snapshot for ${profile} skipped:`, err.message);
  }
}

// ---- Media: dream photos live as files on the volume, not inside the data file ----
// A dream's `image` holds a URL like /media/vc/dreams/123-a1b2c3.jpg. Files are never
// deleted the moment a dream is: sweepMedia() (daily, off the save path) removes a photo
// only once it's over a day old and neither the current data nor any snapshot refers to
// it, so restoring a snapshot keeps its photos and a just-saved photo is never swept.
const MEDIA_DIR = path.join(DATA_DIR, 'media');

function saveDreamImage(profile, dreamId, image) {
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return image || ''; // '' or an existing /media URL
  const match = image.match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/);
  if (!match) return '';
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const name = `${dreamId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = path.join(MEDIA_DIR, profile, 'dreams');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${name}.tmp`);
  fs.writeFileSync(tmp, Buffer.from(match[2], 'base64'));
  fs.renameSync(tmp, path.join(dir, name));
  return `/media/${profile}/dreams/${name}`;
}

function sweepMedia(profile) {
  const dir = path.join(MEDIA_DIR, profile, 'dreams');
  if (!fs.existsSync(dir)) return;
  const sources = [getTasksFile(profile), ...snapshotsFor(profile).map(n => path.join(SNAPSHOT_DIR, n))];
  const referenced = new Set();
  for (const file of sources) {
    try {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/\/media\/[a-z]+\/dreams\/([\w.-]+)/g)) referenced.add(m[1]);
    } catch {}
  }
  const dayAgo = Date.now() - 86400000;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (!referenced.has(name) && fs.statSync(file).mtimeMs < dayAgo) fs.unlinkSync(file);
  }
}

function sweepAllMedia() {
  for (const profile of Object.keys(TASKS_FILES)) {
    try { sweepMedia(profile); } catch (err) { console.error(`Media sweep for ${profile} failed:`, err.message); }
  }
}

// Reads a profile's data file. If it can't be parsed, the damaged file is set aside
// and the newest snapshot that does parse is restored in its place.
function readDataFile(file, profile) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`!!! ${file} could not be read (${err.message}). Restoring from the latest snapshot.`);
    fs.copyFileSync(file, `${file}.damaged-${Date.now()}`);
    for (const name of snapshotsFor(profile).reverse()) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, name), 'utf8'));
        writeJsonAtomic(file, data);
        console.error(`Restored ${file} from snapshots/${name}.`);
        return data;
      } catch {
        // that snapshot is damaged too — try the one before it
      }
    }
    throw new Error(`${file} is damaged and no usable snapshot exists`);
  }
}

function profileFrom(req) {
  const p = (req.headers['x-profile'] || 'vc').toLowerCase();
  return p === 'fg' ? 'fg' : 'vc';
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d', immutable: true })); // names never change, so cache hard

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
    writeJsonAtomic(file, defaults);
    return JSON.parse(JSON.stringify(defaults));
  }
  const data = readDataFile(file, profile || 'vc');

  // Ensure new fields exist for migration
  if (!data.done) data.done = [];
  if (!data.olympus) data.olympus = [];
  if (!data.treats) data.treats = [];
  if (!data.hardThings) data.hardThings = [];
  if (!data.shoppingList) data.shoppingList = [];
  if (!data.wardrobe) data.wardrobe = [];
  if (!data.dreams) data.dreams = [];
  if (!data.wearLog) data.wearLog = [];
  if (!data.outfitPasses) data.outfitPasses = [];
  if (!data.recentSuggestions) data.recentSuggestions = [];
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

  // Dream photos used to be stored inline as base64 — move each one out to a file
  for (const dream of data.dreams) {
    if (typeof dream.image === 'string' && dream.image.startsWith('data:image/')) {
      dream.image = saveDreamImage(profile || 'vc', dream.id, dream.image);
      changed = true;
    }
  }

  // Garment dossiers were removed — drop any cached ones still stored on garments
  for (const item of data.wardrobe) {
    if (item.dossier !== undefined) { delete item.dossier; changed = true; }
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
    snapshotIfDue(profile || 'vc');
    writeJsonAtomic(file, data);
  }
  return data;
}

function writeTasks(data, profile) {
  snapshotIfDue(profile || 'vc');
  writeJsonAtomic(getTasksFile(profile || 'vc'), data);
}

function logEvent(type, payload, profile) {
  const file = getEventsFile(profile || 'vc');
  const events = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  events.push({ type, at: new Date().toISOString(), ...payload });
  writeJsonAtomic(file, events);
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

// Principle 3 (scaled ceremony): the quote knows how long the project was carried
function describeCarried(days) {
  if (days == null) return '';
  if (days < 14) return `${Math.max(1, days)} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}

function getProjectReflection(projectText, data, carriedDays) {
  const avoid = (data.olympus || []).map(o => o.reflection).filter(Boolean).slice(-12);
  const carried = describeCarried(carriedDays);
  return generatePynchon({
    occasion: `a project has just been carried all the way to 100% and ascends to Olympus${carried ? `, after being carried for ${carried}` : ''}.`,
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

// The stylist: Claude Opus 5.5 at low effort (wardrobe is used occasionally, so each call is
// kept lean). Stable rules + the closet go in a cached system prefix, so a Re-spin within a
// few minutes re-reads them at a fraction of the cost. Output is schema-constrained JSON.
const STYLIST_RULES = `You are a personal stylist choosing one outfit from the user's own closet (listed below).

Rules:
- Color: one clear color story. At most one strong color; everything else neutral or deliberately tonal. Never pair near-miss shades of one color family (bright red with burgundy, navy with black) unless the whole outfit is tonal on purpose.
- Formality: every piece shares one level of dressiness that matches the occasion. Don't mix office tailoring, casual daywear and evening pieces in one outfit.
- Practicality: dress for the given weather and for any walking, standing or travel the request implies. Shoes must suit the distance. Add a layer when it's cool or will get colder after dark.
- Structure: at most one item per category. A dress or jumpsuit/romper replaces a top and bottom; otherwise pick one top and one bottom. Include shoes if the closet has any. Add outerwear or an accessory only when it helps.
- Rotation: among choices that work equally well, prefer pieces worn least recently or never — but not ones you suggested recently (listed in the request). Spread suggestions across the closet; don't build every outfit around the same favorite.
- Taste: outfits the user loved show their style; echo their spirit, don't repeat them. Outfits they marked "not my style" show what to steer away from: avoid that direction, not just those exact pieces.

Check the outfit against every rule before answering. "itemIds" are the chosen garments' IDs. "why" is one short sentence (under 20 words), warm and editorial, saying why this works for the occasion.`;

// Principle 2 (off the hook): taste chooses the outfit, but now and then chance slips one
// of your own pieces in. Unmarked: the outfit looks like any other.
const WILD_CARD_ODDS = 0.25;

const OUTFIT_SCHEMA = {
  type: 'object',
  properties: {
    itemIds: { type: 'array', items: { type: 'integer' } },
    why: { type: 'string' },
    // What the stylist read from an attached photo, in a few words ("70s disco night at a bar").
    // Shown in place of the prompt and saved as the wear's prompt when no words were typed.
    occasion: { type: 'string' }
  },
  required: ['itemIds', 'why', 'occasion'],
  additionalProperties: false
};

// A photo attached to the outfit request (a party flier, an invitation, an outfit to echo).
// Read for this one request and never saved, like the garment photos.
const OUTFIT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const OUTFIT_PHOTO_MAX_CHARS = 7 * 1024 * 1024; // base64; the app sends ~1568px JPEGs, well under this

function uploadedPhotoFrom(body) {
  const photo = body && body.photo;
  if (!photo || typeof photo.image !== 'string' || !photo.image) return null;
  if (photo.image.length > OUTFIT_PHOTO_MAX_CHARS) return null;
  const mimeType = OUTFIT_PHOTO_TYPES.includes(photo.mimeType) ? photo.mimeType : 'image/jpeg';
  return { image: photo.image, mimeType };
}

app.post('/api/wardrobe/suggest-outfit', async (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const { prompt, lat, lon } = req.body;
  const photo = uploadedPhotoFrom(req.body);
  // Outfits already shown for this prompt (Re-spin), as arrays of garment IDs
  const exclude = Array.isArray(req.body.exclude) ? req.body.exclude.filter(Array.isArray).slice(-8) : [];
  if (!data.wardrobe || !data.wardrobe.length) return res.json({ items: [], wardrobeEmpty: true });

  const weather = (typeof lat === 'number' && typeof lon === 'number') ? await fetchWeather(lat, lon) : null;

  // Try the AI stylist, but never let it be a hard failure — any problem (usage limits,
  // rate limits, a refusal, a network hiccup) just falls back to a random pick so the
  // user always gets *an* outfit rather than a raw error message.
  let items = null;
  let why = '';
  let occasion = '';
  if (anthropic) {
    try {
      const stats = computeWardrobeStats(data);
      const nameOf = id => (data.wardrobe.find(i => i.id === id) || {}).text;
      const inventory = data.wardrobe.map(i => {
        const st = stats.items[i.id];
        const worn = st.timesWorn ? `worn ${st.timesWorn}x, last ${st.lastWorn}` : 'never worn';
        return `${i.id} | ${i.wardrobeCategory} | ${i.brand ? i.brand + ' ' : ''}${i.text} | ${[i.color, i.material, i.pattern, i.occasion, i.season].filter(Boolean).join(', ')} | ${worn}`;
      }).join('\n');

      const loved = data.wearLog.slice(-6).reverse()
        .map(w => `- "${w.prompt}": ${w.itemIds.map(nameOf).filter(Boolean).join(' + ')}`);
      // Main pieces (dress, jumpsuit, top, bottom) of the last few suggestions, so one favorite
      // doesn't anchor every outfit. Shoes and layers repeat naturally and aren't listed.
      const MAIN_CATEGORIES = ['dresses', 'jumpsuitsRompers', 'tops', 'bottoms'];
      const recent = [...new Set(data.recentSuggestions.slice(-10).flatMap(s => s.itemIds))]
        .filter(id => MAIN_CATEGORIES.includes((data.wardrobe.find(i => i.id === id) || {}).wardrobeCategory));
      const shownIds = new Set(exclude.flat());
      const wildPool = data.wardrobe.filter(i => !shownIds.has(i.id));
      const wildCard = wildPool.length && Math.random() < WILD_CARD_ODDS ? pickRandom(wildPool) : null;
      const passed = data.outfitPasses.slice(-6).reverse()
        .map(p => `- "${p.prompt}": ${p.itemIds.map(nameOf).filter(Boolean).join(' + ')}`);
      const words = String(prompt || '').slice(0, 300);
      const request = [
        words ? `Occasion: "${words}"` : 'Occasion: see the attached photo.',
        photo ? `The user attached a photo. Work out what it is. If it's a flier, invitation or event page, read it for the occasion: the event, theme, dress code, venue, date and time, and dress for that event (if it's on another day or at night, the weather below is only a hint). If it's an outfit or a look, take its inspiration (silhouette, color story, mood, level of dressiness) and recreate its spirit from the closet only; never describe pieces the user doesn't own. If it's something else, take its mood as the brief. "occasion" is what you read from the photo in under 8 words, lowercase, plain (e.g. "70s disco night at a bar", "relaxed linen look in cream"). "why" may refer to the photo.` : '"occasion" is an empty string.',
        weather ? `Weather now: ${weather.tempF}°F, ${weather.description}.` : 'Weather: unknown.',
        loved.length ? `Outfits the user loved recently:\n${loved.join('\n')}` : '',
        passed.length ? `Outfits the user marked "not my style":\n${passed.join('\n')}` : '',
        recent.length ? `Pieces you suggested recently (any occasion) — don't lean on them again unless nothing else fits:\n${recent.map(id => `- ${nameOf(id)}`).join('\n')}` : '',
        wildCard ? `A piece chosen by chance for this outfit: "${wildCard.text}" (ID ${wildCard.id}). Include it and build the rest around it, following every rule. Don't mention that it was chosen by chance.` : '',
        exclude.length ? `Already shown for this occasion — pick a genuinely different outfit with a different main piece (the dress or jumpsuit, or the top), not just new shoes or a layer:\n${exclude.map(ids => `- ${ids.map(nameOf).filter(Boolean).join(' + ')}`).join('\n')}` : ''
      ].filter(Boolean).join('\n\n');

      const message = await anthropic.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // a declined request is retried on Anthropic's recommended model
        output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTFIT_SCHEMA } },
        system: [
          { type: 'text', text: STYLIST_RULES },
          { type: 'text', text: `Closet (ID | category | name | details | wear history):\n${inventory}`, cache_control: { type: 'ephemeral' } }
        ],
        messages: [{
          role: 'user',
          content: photo
            ? [{ type: 'image', source: { type: 'base64', media_type: photo.mimeType, data: photo.image } }, { type: 'text', text: request }]
            : request
        }]
      });

      if (message.stop_reason === 'refusal') throw new Error('stylist declined the request');
      const text = message.content.find(b => b.type === 'text');
      const result = JSON.parse(text.text);
      items = result.itemIds.map(id => data.wardrobe.find(i => i.id === id)).filter(Boolean);
      why = typeof result.why === 'string' ? result.why.trim() : '';
      if (photo && typeof result.occasion === 'string') occasion = result.occasion.trim().slice(0, 80);
    } catch (err) {
      console.error('AI outfit suggestion unavailable, falling back to random pick:', friendlyAnthropicError(err));
    }
  }
  // No AI configured, the AI call failed, or it picked nothing usable — random pick,
  // rather than showing an empty "add clothes" result when the wardrobe has items.
  if (!items || items.length === 0) { items = randomOutfitPick(data.wardrobe); why = ''; }
  const outfit = sanitizeOutfit(items);

  // Remember what was suggested (last 10) so the next request can steer away from it.
  // Re-read first: the AI call took seconds, and saving the old copy would undo edits made meanwhile.
  const fresh = readTasks(profile);
  fresh.recentSuggestions.push({ date: getHabitDay(), itemIds: outfit.map(i => i.id) });
  fresh.recentSuggestions = fresh.recentSuggestions.slice(-10);
  writeTasks(fresh, profile);

  res.json({ items: outfit, weather, why, occasion });
});

// ---- Wardrobe history: wear log and stats ----
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

// Records an outfit the user marked "Not my style" — recent ones steer future suggestions away
app.post('/api/wardrobe/pass', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const known = new Set(data.wardrobe.map(i => i.id));
  const itemIds = (Array.isArray(req.body.itemIds) ? req.body.itemIds : []).map(Number).filter(id => known.has(id));
  if (!itemIds.length) return res.status(400).json({ error: 'No known garments in outfit' });
  const pass = {
    id: data.nextId++,
    date: getHabitDay(),
    itemIds,
    prompt: typeof req.body.prompt === 'string' ? req.body.prompt.slice(0, 200) : ''
  };
  data.outfitPasses.push(pass);
  writeTasks(data, profile);
  logEvent('outfit_not_my_style', { itemIds, prompt: pass.prompt }, profile);
  res.json(pass);
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
    ? { id, text, image: saveDreamImage(profile, id, body.image), createdAt }
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

// ---- Shopping: a photo becomes errands ----
// A recipe, a screenshot of a text ("can you grab razors?"), a handwritten list, an empty
// package. Read for this one request and never saved. Oedipa lists what to buy; the review
// card (frontend) lets the user untick what they have before anything is added.

const SHOP_PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          staple: { type: 'boolean' },
          swap: { type: 'string' }
        },
        required: ['text', 'staple', 'swap'],
        additionalProperties: false
      }
    }
  },
  required: ['title', 'items'],
  additionalProperties: false
};

const SHOP_PHOTO_RULES = `You turn photos into a shopping list. A photo may be a recipe, a screenshot of a message asking for something ("can you pick up razors?"), a handwritten or typed list, a product or empty package, or a page of a store. Several photos may belong together (pages of one recipe, a long chat).

- Find everything the photos ask to buy. In a conversation, only what someone is asking to get, not things mentioned in passing. For a recipe, every ingredient, including sub-recipes (sauce, marinade, garnish).
- One line per thing, written the way it's bought. Keep the details given (brand, size, count, kind): "razors (Venus, sensitive)", "2 lemons". For a recipe, give the total it needs ("1 bunch cilantro", "1 lb ground pork") and merge repeats; leave out water and ice.
- "staple" is true only for recipe ingredients that are pantry basics most kitchens already have: salt, black pepper, olive oil, neutral oil, sugar, all-purpose flour, baking soda, baking powder, vinegar, soy sauce, common dried spices. Anything someone explicitly asked for is never a staple.
- "swap" is what to buy instead if the item is hard to find, in under 10 words. For food and groceries, always give one, preferring a product Trader Joe's usually carries, named plainly ("TJ's Gochujang", "TJ's frozen garlic cubes"); if Trader Joe's is unlikely to have anything close, give a common supermarket substitute. For everything else, give a swap only when there's a genuinely useful alternative (another kind or brand that does the same job, or Trader Joe's if it carries one); otherwise "".
- "title" says in a few lowercase words what the photo is: the recipe's name ("pork larb"), or the source ("text from mom", "handwritten list"). "" if unclear.
- If there's nothing to buy, return no items and an empty title.`;

app.post('/api/shopping/read-photo', requireAdmin, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY' });
  const photos = (Array.isArray(req.body.photos) ? req.body.photos : []).map(p => uploadedPhotoFrom({ photo: p })).filter(Boolean).slice(0, 4);
  if (!photos.length) return res.status(400).json({ error: 'No photo provided' });
  try {
    const message = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SHOP_PHOTO_SCHEMA } },
      system: SHOP_PHOTO_RULES,
      messages: [{
        role: 'user',
        content: [
          ...photos.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.image } })),
          { type: 'text', text: 'Make the shopping list from these photos.' }
        ]
      }]
    });
    if (message.stop_reason === 'refusal') throw new Error('declined the request');
    const result = JSON.parse(message.content.find(b => b.type === 'text').text);
    const items = result.items
      .map(i => ({ text: String(i.text).trim().slice(0, 120), staple: !!i.staple, swap: String(i.swap || '').trim().slice(0, 120) }))
      .filter(i => i.text);
    res.json({ title: String(result.title || '').trim().slice(0, 80), items });
  } catch (err) {
    console.error('Shopping photo reading failed:', err);
    res.status(500).json({ error: friendlyAnthropicError(err) });
  }
});

// Adds the reviewed lines to Errands, together at the top, each keeping its swap (if any)
app.post('/api/shopping/from-photo', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const lines = (Array.isArray(req.body.items) ? req.body.items : [])
    .map(i => ({ text: String((i && i.text) || '').trim().slice(0, 120), swap: String((i && i.swap) || '').trim().slice(0, 120) }))
    .filter(i => i.text)
    .slice(0, 60);
  if (!lines.length) return res.status(400).json({ error: 'Nothing to add' });
  const createdAt = new Date().toISOString();
  const added = lines.map(l => ({ id: data.nextId++, text: l.text, done: false, swap: l.swap, createdAt }));
  data.shoppingList.unshift(...added);
  writeTasks(data, profile);
  logEvent('photo_list_added', { title: String(req.body.title || '').slice(0, 80), count: added.length }, profile);
  res.json({ items: added });
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

  const before = { ...task }; // for logging what a garment edit changed
  if (req.body.text !== undefined) task.text = req.body.text;

  if (category === 'dreams') {
    if (req.body.image !== undefined) task.image = saveDreamImage(profile, task.id, req.body.image);
  }

  if (category === 'wishlist') {
    if (req.body.note !== undefined) task.note = String(req.body.note).slice(0, 200);
  }

  // "Use this" on an errand's swap: the swap becomes the item, and there's nothing left to swap
  if (category === 'shoppingList') {
    if (req.body.swap !== undefined) task.swap = String(req.body.swap).slice(0, 120);
  }

  if (category === 'wardrobe') {
    const fields = ['text', 'brand', 'color', 'material', 'pattern', 'occasion', 'season', 'wardrobeCategory', 'subcategory', 'origin', 'acquired', 'memory'];
    const changes = fields
      .filter(f => req.body[f] !== undefined && req.body[f] !== (before[f] ?? ''))
      .map(f => ({ field: f, from: before[f] ?? '', to: req.body[f] }));
    if (changes.length) logEvent('garment_edited', { taskId: task.id, text: task.text, changes }, profile);
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
      const carriedDays = task.createdAt ? Math.floor((Date.now() - new Date(task.createdAt)) / 86400000) : null;
      const reflection = await getProjectReflection(task.text, data, carriedDays);
      // Writing the quote takes seconds, and anything saved meanwhile (a habit checked, a
      // task added) would be overwritten by the copy read before the wait — so re-read now.
      const fresh = readTasks(profile);
      const freshTask = fresh.projects.find(t => t.id === task.id);
      if (freshTask) { // gone means a duplicate tap already ascended it
        logEvent('project_ascended', { taskId: task.id, text: task.text }, profile);
        fresh.olympus.push({
          id: task.id,
          text: freshTask.text,
          completedAt: new Date().toISOString(),
          reflection
        });
        fresh.projects = fresh.projects.filter(t => t.id !== task.id);
        writeTasks(fresh, profile);
      }
      return res.json({ ascended: true, reflection, carriedDays });
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
  // Garments are logged whole, so a deleted one can be rebuilt from the activity log
  if (deletedTask) logEvent('task_deleted', { taskId: deletedTask.id, text: deletedTask.text, category, ...(category === 'wardrobe' ? { item: deletedTask } : {}) }, profile);
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
// Storage status: is the data on the persistent volume, how big it is, and its latest snapshot
app.get('/api/health', (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const snapshots = snapshotsFor(profile);
  res.json({
    persistent: PERSISTENT,
    snapshots: { count: snapshots.length, latest: snapshots[snapshots.length - 1] || null },
    counts: {
      projects: data.projects.length,
      olympus: data.olympus.length,
      garments: data.wardrobe.length,
      wears: data.wearLog.length,
      wishlist: data.wishlist.length
    }
  });
});

app.get('/api/backup', requireAdmin, (req, res) => {
  const profile = profileFrom(req);
  const data = readTasks(profile);
  const date = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Disposition', `attachment; filename="tasks-${profile}-backup-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data, null, 2));
});

sweepAllMedia();
setInterval(sweepAllMedia, 86400000);

app.listen(PORT, () => {
  console.log(`Oedipa (life, day by day) running at http://localhost:${PORT}`);
});
