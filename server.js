const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : __dirname;
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD not set — all writes will fail.');

function requireAdmin(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (!pw || pw !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const DONE_RETENTION_DAYS = 7;

const pynchonQuotes = [
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
  done: [],
  olympus: [],
  nextId: 500
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

function readTasks() {
  if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(defaultTasks, null, 2));
    return defaultTasks;
  }
  const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));

  // Ensure new fields exist for migration
  if (!data.done) data.done = [];
  if (!data.olympus) data.olympus = [];
  if (!data.treats) data.treats = [];
  for (const project of data.projects) {
    if (!project.steps) project.steps = [];
  }

  let changed = false;

  // Reset habits if the habit-day has changed (rolls over at 5 AM PT)
  const today = getHabitDay();
  for (const habit of data.habits) {
    if (habit.lastDoneDate !== today && habit.doneToday) {
      habit.doneToday = false;
      changed = true;
    }
  }

  // Auto-clear done items older than 7 days
  const cutoff = Date.now() - DONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const before = data.done.length;
  data.done = data.done.filter(t => new Date(t.completedAt).getTime() > cutoff);
  if (data.done.length !== before) changed = true;

  if (changed) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
  }
  return data;
}

function writeTasks(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

function getRandomPynchon() {
  return pynchonQuotes[Math.floor(Math.random() * pynchonQuotes.length)];
}

// Add a step to a project
app.post('/api/tasks/projects/:id/steps', requireAdmin, (req, res) => {
  const data = readTasks();
  const { id } = req.params;
  const { text } = req.body;
  const project = data.projects.find(t => t.id === Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.steps) project.steps = [];
  const stepId = data.nextId++;
  project.steps.push({ id: stepId, text, done: false });
  writeTasks(data);
  res.json(project);
});

// Update a step (toggle done or rename)
app.put('/api/tasks/projects/:id/steps/:stepId', requireAdmin, (req, res) => {
  const data = readTasks();
  const { id, stepId } = req.params;
  const project = data.projects.find(t => t.id === Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const step = project.steps && project.steps.find(s => s.id === Number(stepId));
  if (!step) return res.status(404).json({ error: 'Step not found' });

  if (req.body.text !== undefined) step.text = req.body.text;
  if (req.body.done !== undefined) step.done = req.body.done;

  writeTasks(data);
  res.json(project);
});

// Delete a step
app.delete('/api/tasks/projects/:id/steps/:stepId', requireAdmin, (req, res) => {
  const data = readTasks();
  const { id, stepId } = req.params;
  const project = data.projects.find(t => t.id === Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.steps) return res.status(404).json({ error: 'Step not found' });
  project.steps = project.steps.filter(s => s.id !== Number(stepId));

  writeTasks(data);
  res.json({ success: true });
});

// Get all tasks
app.get('/api/tasks', (req, res) => {
  res.json(readTasks());
});

// Add a task
app.post('/api/tasks/:category', requireAdmin, (req, res) => {
  const data = readTasks();
  const { category } = req.params;
  const { text } = req.body;
  if (!['oneOff', 'habits', 'projects', 'treats'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const id = data.nextId++;
  const task = category === 'habits'
    ? { id, text, doneToday: false, lastDoneDate: null }
    : category === 'treats'
    ? { id, text }
    : category === 'projects'
    ? { id, text, progress: 0 }
    : { id, text, done: false };
  data[category].push(task);
  writeTasks(data);
  res.json(task);
});

// Reorder tasks within a category
app.put('/api/tasks/:category/reorder', requireAdmin, (req, res) => {
  const data = readTasks();
  const { category } = req.params;
  const { ids } = req.body;
  if (!['oneOff', 'habits', 'projects', 'treats'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const items = data[category];
  data[category] = ids.map(id => items.find(t => t.id === Number(id))).filter(Boolean);
  writeTasks(data);
  res.json({ success: true });
});

// Update a task
app.put('/api/tasks/:category/:id', requireAdmin, (req, res) => {
  const data = readTasks();
  const { category, id } = req.params;
  if (!['oneOff', 'habits', 'projects', 'treats'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const task = data[category].find(t => t.id === Number(id));
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (req.body.text !== undefined) task.text = req.body.text;

  if (category === 'habits') {
    if (req.body.doneToday !== undefined) {
      task.doneToday = req.body.doneToday;
      task.lastDoneDate = req.body.doneToday
        ? getHabitDay()
        : task.lastDoneDate;
    }
  } else if (category === 'projects' && req.body.progress !== undefined) {
    task.progress = Math.max(0, Math.min(100, req.body.progress));

    // Auto-ascend at 100%
    if (task.progress >= 100) {
      data.olympus.push({
        id: task.id,
        text: task.text,
        completedAt: new Date().toISOString(),
        reflection: getRandomPynchon()
      });
      data.projects = data.projects.filter(t => t.id !== task.id);
    }
  } else if (req.body.done !== undefined) {
    const wasDone = task.done;
    task.done = req.body.done;

    // Move to done when one-off checked
    if (req.body.done && !wasDone && category === 'oneOff') {
      data.done.push({
        id: task.id,
        text: task.text,
        completedAt: new Date().toISOString()
      });
      data.oneOff = data.oneOff.filter(t => t.id !== task.id);
    }
  }

  writeTasks(data);
  res.json(task);
});

// Delete a task
app.delete('/api/tasks/:category/:id', requireAdmin, (req, res) => {
  const data = readTasks();
  const { category, id } = req.params;
  if (!['oneOff', 'habits', 'projects', 'treats', 'done', 'olympus'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  data[category] = data[category].filter(t => t.id !== Number(id));
  writeTasks(data);
  res.json({ success: true });
});

// Restore a done/olympus task back to its original category
app.post('/api/restore/:category/:id', requireAdmin, (req, res) => {
  const data = readTasks();
  const { category, id } = req.params;
  const numId = Number(id);

  if (category === 'done') {
    const idx = data.done.findIndex(t => t.id === numId);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    const task = data.done.splice(idx, 1)[0];
    data.oneOff.push({ id: task.id, text: task.text, done: false });
  } else if (category === 'olympus') {
    const idx = data.olympus.findIndex(t => t.id === numId);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    const task = data.olympus.splice(idx, 1)[0];
    data.projects.push({ id: task.id, text: task.text, progress: 0 });
  } else {
    return res.status(400).json({ error: 'Can only restore from done or olympus' });
  }

  writeTasks(data);
  res.json({ success: true });
});

// Get a random uncompleted task (20% chance of a treat instead)
app.get('/api/random', (req, res) => {
  const data = readTasks();
  const treats = (data.treats || []).map(t => ({ ...t, category: 'treats' }));
  const isTreat = treats.length > 0 && Math.random() < 0.2;

  if (isTreat) {
    const pick = treats[Math.floor(Math.random() * treats.length)];
    return res.json(pick);
  }

  const pool = [
    ...data.oneOff.filter(t => !t.done).map(t => ({ ...t, category: 'oneOff' })),
    ...data.habits.filter(t => !t.doneToday).map(t => ({ ...t, category: 'habits' }))
  ];
  if (pool.length === 0) {
    // If no tasks left, give a treat
    if (treats.length > 0) {
      return res.json(treats[Math.floor(Math.random() * treats.length)]);
    }
    return res.json(null);
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  res.json(pick);
});

// Backup — download tasks.json as a file (admin only)
app.get('/api/backup', requireAdmin, (req, res) => {
  const data = readTasks();
  const date = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Disposition', `attachment; filename="tasks-backup-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data, null, 2));
});

app.listen(PORT, () => {
  console.log(`LIFE (day by day) running at http://localhost:${PORT}`);
});
