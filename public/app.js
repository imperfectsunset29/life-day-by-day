const API = '/api';

function scrollToInput(input) {
  setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
}

// Profile
let currentProfile = null; // 'vc' | 'fg' | null
function getProfile() { return currentProfile || 'vc'; }

// Auth
let adminPassword = null;
function isAdmin() { return adminPassword !== null; }
function authKey() { return `adminPassword-${getProfile()}`; }
function authHeaders() {
  const h = { 'Content-Type': 'application/json', 'X-Profile': getProfile() };
  if (adminPassword) h['X-Admin-Password'] = adminPassword;
  return h;
}
async function apiFetch(url, options = {}) {
  options.headers = authHeaders();
  const res = await fetch(url, options);
  if (res.status === 401) { lock(); alert('Wrong password — locked.'); throw new Error('Unauthorized'); }
  return res;
}
function applyAuthUI() {
  const btn = document.getElementById('lock-btn');
  if (isAdmin()) {
    document.body.classList.add('admin-mode');
    btn.textContent = '🔓'; btn.title = 'Click to lock';
  } else {
    document.body.classList.remove('admin-mode');
    btn.textContent = '🔒'; btn.title = 'Click to unlock';
  }
}
function unlock(pw) { adminPassword = pw; localStorage.setItem(authKey(), pw); applyAuthUI(); }
function lock() { adminPassword = null; localStorage.removeItem(authKey()); applyAuthUI(); }

const categoryLabels = {
  oneOff: 'One-off',
  habits: 'Habit',
  projects: 'Project',
  treats: 'Treat',
  hardThings: 'Hard thing',
  shoppingList: 'Shopping item'
};

// State
let tasks = { oneOff: [], habits: [], projects: [], treats: [], hardThings: [], shoppingList: [], wardrobe: [], done: [], olympus: [] };
const expandedProjects = new Set();
let oneOffExpanded = false;
const ONEOFF_LIMIT = 5;
let currentSurpriseTask = null;
let oracleSelectionOrder = []; // sentence texts in selection order, max 2 (FIFO)
let capturedPhotos = []; // [{ image: base64, mimeType }] — cleared after each wardrobe save
let lastOutfitPrompt = '';


// DOM refs
const overlay = document.getElementById('randomizer-overlay');
const overlayTask = document.getElementById('overlay-task');
const overlayLabel = document.getElementById('overlay-label');
const mainView = document.getElementById('main-view');
const olympusView = document.getElementById('olympus-view');
const treatsView = document.getElementById('treats-view');
const hardThingsView = document.getElementById('hard-things-view');
const shoppingListView = document.getElementById('shopping-list-view');
const wardrobeView = document.getElementById('wardrobe-view');
const wardrobeAddOverlay = document.getElementById('wardrobe-add-overlay');
const outfitOverlay = document.getElementById('outfit-overlay');
const wardrobePhotoInput = document.getElementById('wardrobe-photo-input');
const profileSelectorView = document.getElementById('profile-selector');
const appHeader = document.getElementById('header');

// Fetch and render
async function loadTasks() {
  const res = await fetch(`${API}/tasks`, { headers: authHeaders() });
  tasks = await res.json();
  render();
}

function render() {
  renderCategory('oneOff', tasks.oneOff);
  renderCategory('habits', tasks.habits);
  renderProjects();
  renderDone();
  renderOracle();
  initSortable('list-oneOff', 'oneOff');
  initSortable('list-habits', 'habits');
  initSortable('list-projects', 'projects');
}

function splitSentences(text) {
  return text.split(/(?<=[.!?;])\s+/).filter(s => s.trim()).map((s, i, arr) =>
    i < arr.length - 1 ? s + ' ' : s
  );
}

function buildSentenceSpans(container, text, isSelected) {
  container.innerHTML = '';
  const paragraphs = text.split(/\n\n+/);
  paragraphs.forEach(para => {
    const paraDiv = document.createElement('div');
    paraDiv.className = 'oracle-para';
    para.split(/\n/).forEach((line, li, lines) => {
      splitSentences(line.trim()).forEach(sentence => {
        if (!sentence.trim()) return;
        const span = document.createElement('span');
        span.className = 'oracle-sentence';
        span.textContent = sentence;
        if (isSelected(sentence)) span.classList.add('selected');
        paraDiv.appendChild(span);
      });
      if (li < lines.length - 1) paraDiv.appendChild(document.createElement('br'));
    });
    container.appendChild(paraDiv);
  });
}

function renderOracle() {
  const block = document.getElementById('oracle-block');
  const oracle = tasks.oracle;
  if (!oracle || !oracle.text) {
    if (isAdmin()) {
      block.classList.remove('hidden');
      document.getElementById('oracle-source-display').textContent = '';
      document.getElementById('oracle-preview-text').textContent = 'add oracle';
      document.getElementById('oracle-more-hint').classList.add('hidden');
    } else {
      block.classList.add('hidden');
    }
    return;
  }
  block.classList.remove('hidden');
  document.getElementById('oracle-source-display').textContent = oracle.source || '';
  document.getElementById('oracle-preview-text').textContent = oracle.preview || oracle.text;
  document.getElementById('oracle-more-hint').classList.remove('hidden');
}

function renderOracleSentences() {
  const oracle = tasks.oracle;
  const preview = oracle.preview || '';
  const previewSet = preview
    ? new Set(splitSentences(preview).map(s => s.trim()))
    : new Set();
  buildSentenceSpans(
    document.getElementById('oracle-full-text'),
    oracle.text,
    s => previewSet.has(s.trim())
  );
}

function openOracleOverlay() {
  const oracle = tasks.oracle;
  const isEmpty = !oracle || !oracle.text;
  if (isEmpty && isAdmin()) {
    document.getElementById('oracle-source-input').value = '';
    document.getElementById('oracle-text-input').value = '';
    document.getElementById('oracle-read-mode').classList.add('hidden');
    document.getElementById('oracle-edit-mode').classList.remove('hidden');
  } else {
    document.getElementById('oracle-overlay-source').textContent = oracle.source || '';
    renderOracleSentences();
    // Populate selection order from saved preview (up to 2)
    oracleSelectionOrder = [...document.querySelectorAll('#oracle-full-text .oracle-sentence.selected')]
      .map(s => s.textContent.trim()).slice(0, 2);
    document.getElementById('oracle-read-mode').classList.remove('hidden');
    document.getElementById('oracle-edit-mode').classList.add('hidden');
    document.getElementById('oracle-edit-btn').classList.toggle('hidden', !isAdmin());
    document.getElementById('oracle-save-preview-btn').classList.toggle('hidden', false);
    document.getElementById('oracle-select-hint').classList.toggle('hidden', !isAdmin());
    updateOracleActionBtn();
  }
  document.getElementById('oracle-overlay').classList.remove('hidden');
}

function renderCategory(category, items) {
  const list = document.getElementById(`list-${category}`);
  list.innerHTML = '';

  // Always clean up the show-more button (it lives on the section, not the list)
  if (category === 'oneOff') {
    const existing = list.parentElement.querySelector('.show-more-btn');
    if (existing) existing.remove();
  }

  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No tasks yet';
    list.appendChild(li);
    return;
  }

  for (let i = 0; i < items.length; i++) {
    const task = items[i];
    const isDone = category === 'habits' ? task.doneToday : task.done;
    const li = document.createElement('li');
    li.className = `task-item${isDone ? ' done' : ''}`;
    li.dataset.id = task.id;
    li.dataset.category = category;

    if (category === 'oneOff' && i >= ONEOFF_LIMIT && !oneOffExpanded) {
      li.classList.add('list-hidden');
    }

    li.innerHTML = `
      <button class="task-checkbox${isDone ? ' checked' : ''}" data-id="${task.id}" data-category="${category}"></button>
      <span class="task-text">${escapeHtml(task.text)}</span>
      <div class="task-actions">
        <button class="task-action-btn edit" data-id="${task.id}" data-category="${category}" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${task.id}" data-category="${category}" title="Delete">delete</button>
      </div>
    `;

    list.appendChild(li);
  }

  if (category === 'oneOff' && items.length > ONEOFF_LIMIT) {
    const hidden = items.length - ONEOFF_LIMIT;
    const section = list.parentElement;
    const existing = section.querySelector('.show-more-btn');
    if (existing) existing.remove();

    if (!oneOffExpanded) {
      const btn = document.createElement('button');
      btn.className = 'show-more-btn';
      btn.textContent = `— ${hidden} more`;
      btn.addEventListener('click', () => { oneOffExpanded = true; render(); });
      section.appendChild(btn);
    }
  }
}

function renderStepsHTML(task) {
  const steps = task.steps || [];
  let html = `<div class="steps-section">`;

  for (const step of steps) {
    html += `
      <div class="step-item">
        <button class="step-checkbox${step.done ? ' checked' : ''}" data-project-id="${task.id}" data-step-id="${step.id}"></button>
        <span class="step-text${step.done ? ' done' : ''}" data-project-id="${task.id}" data-step-id="${step.id}">${escapeHtml(step.text)}</span>
        <button class="step-delete" data-project-id="${task.id}" data-step-id="${step.id}" title="Delete step">&times;</button>
      </div>`;
  }

  html += `
    <div class="step-add-row">
      <button class="step-add-btn" data-project-id="${task.id}">+ step</button>
    </div>
  </div>`;

  return html;
}

function renderProjects() {
  const list = document.getElementById('list-projects');
  list.innerHTML = '';

  if (tasks.projects.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No tasks yet';
    list.appendChild(li);
    return;
  }

  for (const task of tasks.projects) {
    const li = document.createElement('li');
    li.className = 'task-item project-item';
    li.dataset.id = task.id;
    li.dataset.category = 'projects';
    const hasSteps = task.steps && task.steps.length > 0;
    const isExpanded = expandedProjects.has(task.id);
    li.innerHTML = `
      <div class="project-top">
        <button class="step-toggle" data-id="${task.id}" title="${isExpanded ? 'Collapse steps' : 'Expand steps'}">${isExpanded ? '▾' : '▸'}</button>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <div class="task-actions">
          <button class="task-action-btn edit" data-id="${task.id}" data-category="projects" title="Edit">edit</button>
          <button class="task-action-btn delete" data-id="${task.id}" data-category="projects" title="Delete">delete</button>
        </div>
      </div>
      <div class="progress-row">
        <button class="progress-btn" data-id="${task.id}" data-delta="-10">&minus;</button>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${task.progress}%"></div>
        </div>
        <span class="progress-label">${task.progress}%</span>
        <button class="progress-btn" data-id="${task.id}" data-delta="10">+</button>
      </div>
      ${isExpanded ? renderStepsHTML(task) : ''}
    `;

    list.appendChild(li);
  }
}

async function toggleStep(projectId, stepId, done) {
  await apiFetch(`${API}/tasks/projects/${projectId}/steps/${stepId}`, {
    method: 'PUT',
    body: JSON.stringify({ done })
  });
  await loadTasks();
}

async function deleteStep(projectId, stepId) {
  await apiFetch(`${API}/tasks/projects/${projectId}/steps/${stepId}`, { method: 'DELETE' });
  await loadTasks();
}

async function addStep(projectId) {
  const btn = document.querySelector(`.step-add-btn[data-project-id="${projectId}"]`);
  if (!btn) return;
  const addRow = btn.closest('.step-add-row');
  if (!addRow || addRow.querySelector('.step-text-input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'step-text-input';
  input.placeholder = 'New step...';
  addRow.insertBefore(input, btn);
  input.focus();
  scrollToInput(input);

  const save = async () => {
    const text = input.value.trim();
    if (text) {
      expandedProjects.add(projectId);
      await apiFetch(`${API}/tasks/projects/${projectId}/steps`, {
        method: 'POST',
        body: JSON.stringify({ text })
      });
    }
    await loadTasks();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });
}

function startEditStep(projectId, stepId) {
  const project = tasks.projects.find(p => p.id === projectId);
  const step = project && project.steps && project.steps.find(s => s.id === stepId);
  if (!step) return;

  const textSpan = document.querySelector(`.step-text[data-project-id="${projectId}"][data-step-id="${stepId}"]`);
  if (!textSpan) return;

  const currentText = step.text;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'step-text-input';
  input.value = currentText;

  textSpan.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newText = input.value.trim();
    expandedProjects.add(projectId);
    if (newText && newText !== currentText) {
      await apiFetch(`${API}/tasks/projects/${projectId}/steps/${stepId}`, {
        method: 'PUT',
        body: JSON.stringify({ text: newText })
      });
    }
    await loadTasks();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = currentText; input.blur(); }
  });
}

async function updateProgress(id, delta) {
  const task = tasks.projects.find(t => t.id === id);
  if (!task) return;
  const newProgress = Math.max(0, Math.min(100, task.progress + delta));

  // Optimistic DOM update — avoids full re-render blip
  task.progress = newProgress;
  const li = document.querySelector(`#list-projects li[data-id="${id}"]`);
  if (li) {
    li.querySelector('.progress-fill').style.width = `${newProgress}%`;
    li.querySelector('.progress-label').textContent = `${newProgress}%`;
  }

  await apiFetch(`${API}/tasks/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ progress: newProgress })
  });

  // Full reload only needed if ascension may have fired
  if (newProgress >= 100) {
    await loadTasks();
    const ascended = tasks.olympus.find(t => t.id === id);
    if (ascended) showCelebration(ascended.reflection);
  }
}

function renderDone() {
  const section = document.getElementById('done-section');
  const list = document.getElementById('list-done');
  list.innerHTML = '';

  if (tasks.done.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  for (const task of tasks.done) {
    const li = document.createElement('li');
    li.className = 'task-item';

    const daysAgo = Math.floor((Date.now() - new Date(task.completedAt).getTime()) / (1000 * 60 * 60 * 24));
    const dateLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;

    li.innerHTML = `
      <span class="task-text">${escapeHtml(task.text)}</span>
      <span class="done-date">${dateLabel}</span>
      <button class="task-action-btn restore" data-id="${task.id}" data-category="done" title="Restore">undo</button>
    `;

    list.appendChild(li);
  }
}

function renderOlympus() {
  const list = document.getElementById('olympus-list');
  const empty = document.getElementById('olympus-empty');
  list.innerHTML = '';

  if (tasks.olympus.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  // Show newest first
  const sorted = [...tasks.olympus].reverse();

  for (const entry of sorted) {
    const date = new Date(entry.completedAt).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    });

    const card = document.createElement('div');
    card.className = 'olympus-card';
    card.innerHTML = `
      <div class="olympus-card-header">
        <span class="olympus-card-title">${escapeHtml(entry.text)}</span>
        <span class="olympus-card-date">${date}</span>
      </div>
      <p class="olympus-card-reflection">"${escapeHtml(entry.reflection)}"</p>
      <button class="task-action-btn restore olympus-restore" data-id="${entry.id}" data-category="olympus">undo</button>
    `;

    list.appendChild(card);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toggle task done
async function toggleTask(category, id) {
  const taskList = tasks[category];
  const task = taskList.find(t => t.id === id);
  if (!task) return;

  const wasDone = category === 'habits' ? task.doneToday : task.done;
  const nowDone = !wasDone;

  // Optimistic DOM update — instant feedback before network round-trip
  if (category === 'shoppingList') {
    // Items move between sections, so update local state and re-render immediately
    const t = tasks.shoppingList.find(t => t.id === id);
    if (t) t.done = nowDone;
    renderShoppingList();
  } else {
    const li = document.querySelector(`#list-${category} li[data-id="${id}"]`);
    if (li) {
      const checkbox = li.querySelector('.task-checkbox');
      if (nowDone) {
        li.classList.add('done');
        checkbox && checkbox.classList.add('checked');
      } else {
        li.classList.remove('done');
        checkbox && checkbox.classList.remove('checked');
      }
    }
  }

  const body = category === 'habits'
    ? { doneToday: nowDone }
    : { done: nowDone };

  await apiFetch(`${API}/tasks/${category}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  await loadTasks();
  if (category === 'shoppingList') renderShoppingList();

  if (category === 'oneOff' && !wasDone && tasks.oneOff.length === 0) {
    showOneOffCelebration();
  }
}

async function showCelebration(quote) {
  const el = document.getElementById('oneoff-celebration-overlay');
  el.classList.remove('hidden');
  await document.fonts.ready;
  requestAnimationFrame(() => {
    animateSandText(el.querySelector('.celebration-canvas'), quote);
  });
}

async function showOneOffCelebration() {
  try {
    const data = await apiFetch(`${API}/quote/celebration`);
    showCelebration(data.quote);
  } catch {
    showCelebration('The list is empty. The world, improbably, persists.');
  }
}

function animateSandText(canvas, text) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!W || !H) return;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Render text offscreen to sample pixel positions
  const off = document.createElement('canvas');
  off.width = W * dpr;
  off.height = H * dpr;
  const octx = off.getContext('2d');
  octx.scale(dpr, dpr);

  const fontSize = 20;
  const lineHeight = fontSize * 1.85;
  octx.font = `italic ${fontSize}px "Instrument Serif", serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'alphabetic';
  octx.fillStyle = '#fff';

  // Word-wrap
  const words = text.split(' ');
  const maxLineW = W - 48;
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (octx.measureText(test).width > maxLineW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  const totalTextH = lines.length * lineHeight;
  const topPad = (H - totalTextH) / 2;
  for (let i = 0; i < lines.length; i++) {
    octx.fillText(lines[i], W / 2, topPad + (i + 1) * lineHeight - fontSize * 0.2);
  }

  // Sample filled pixels
  const imgData = octx.getImageData(0, 0, W * dpr, H * dpr).data;
  const targets = [];
  const step = Math.ceil(dpr * 2);
  for (let py = 0; py < H * dpr; py += step) {
    for (let px = 0; px < W * dpr; px += step) {
      if (imgData[(py * Math.round(W * dpr) + px) * 4 + 3] > 60) {
        targets.push({ x: px / dpr, y: py / dpr });
      }
    }
  }
  if (!targets.length) return;

  // y range for stagger (bottom rows start first)
  let yMin = Infinity, yMax = -Infinity;
  for (const t of targets) {
    if (t.y < yMin) yMin = t.y;
    if (t.y > yMax) yMax = t.y;
  }
  const ySpan = yMax - yMin || 1;

  const particles = targets.map(t => ({
    tx: t.x,
    ty: t.y,
    sx: t.x + (Math.random() - 0.5) * 60,
    delay: ((yMax - t.y) / ySpan) * 700,   // bottom-first
    dur: 850 + Math.random() * 400,
    color: Math.random() < 0.6 ? '#f0e8e0' : '#c8a87a',
    r: 0.3 + Math.random() * 0.5,
  }));

  let t0 = null;

  function frame(ts) {
    if (!t0) t0 = ts;
    const elapsed = ts - t0;
    ctx.clearRect(0, 0, W, H);

    let allDone = true;
    for (const p of particles) {
      const local = elapsed - p.delay;
      if (local <= 0) { allDone = false; continue; }

      const prog = Math.min(1, local / p.dur);
      if (prog < 1) allDone = false;

      // ease-out cubic: fast fall, gentle settle
      const ease = 1 - Math.pow(1 - prog, 3);

      const x = p.sx + (p.tx - p.sx) * ease;
      const y = -10 + (p.ty + 10) * ease;

      ctx.globalAlpha = Math.min(1, local / 120);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    if (!allDone) {
      requestAnimationFrame(frame);
    } else {
      // Cross-fade: particles dissolve out as text materialises in (~250ms)
      const fadeDur = 500;
      let f0 = null;
      function fadeFrame(ts) {
        if (!f0) f0 = ts;
        const prog = Math.min(1, (ts - f0) / fadeDur);
        const ease = 1 - Math.pow(1 - prog, 3);
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
          ctx.globalAlpha = (1 - ease);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.tx, p.ty, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = ease;
        ctx.font = `italic ${fontSize}px "Instrument Serif", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#f0e8e0';
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], W / 2, topPad + (i + 1) * lineHeight - fontSize * 0.2);
        }
        ctx.globalAlpha = 1;
        if (prog < 1) requestAnimationFrame(fadeFrame);
      }
      requestAnimationFrame(fadeFrame);
    }
  }

  requestAnimationFrame(frame);
}

// Edit task
function startEdit(category, id) {
  const task = tasks[category] && tasks[category].find(t => t.id === id);
  if (!task) return;

  // Wardrobe items live in per-category sublists — find the <li> by data attribute
  let li;
  if (category === 'wardrobe') {
    li = document.querySelector(`.task-item[data-id="${id}"][data-category="wardrobe"]`);
  } else {
    const list = document.getElementById(`list-${category}`);
    if (!list) return;
    for (const item of list.querySelectorAll('.task-item')) {
      const editBtn = item.querySelector('.edit');
      if (editBtn && Number(editBtn.dataset.id) === id) { li = item; break; }
    }
  }

  if (!li) return;

  const textSpan = li.querySelector('.task-text');
  const currentText = task.text;

  const input = document.createElement('textarea');
  input.className = 'task-text-input';
  input.value = currentText;
  input.rows = 1;

  li.classList.add('editing');
  textSpan.replaceWith(input);

  // Auto-size to show the full text
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });

  input.focus();
  input.select();
  scrollToInput(input);

  const save = async () => {
    li.classList.remove('editing');
    const newText = input.value.trim();
    if (newText && newText !== currentText) {
      await apiFetch(`${API}/tasks/${category}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ text: newText })
      });
    }
    await loadTasks();
    if (category === 'wardrobe') renderWardrobe();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = currentText; input.blur(); }
  });
}

// Delete task
async function deleteTask(category, id) {
  await apiFetch(`${API}/tasks/${category}/${id}`, { method: 'DELETE' });
  await loadTasks();
  if (category === 'treats') renderTreats();
  if (category === 'hardThings') renderHardThings();
  if (category === 'shoppingList') renderShoppingList();
  if (category === 'wardrobe') renderWardrobe();
}

// Add task
async function addTask(category) {
  const list = document.getElementById(`list-${category}`);

  // Check if there's already an input
  if (list.querySelector('.task-text-input')) return;

  const li = document.createElement('li');
  li.className = 'task-item';
  li.innerHTML = category === 'treats'
    ? `<input type="text" class="task-text-input" placeholder="New treat...">`
    : category === 'hardThings'
    ? `<input type="text" class="task-text-input" placeholder="New hard thing...">`
    : category === 'shoppingList'
    ? `<input type="text" class="task-text-input" placeholder="New item...">`
    : `<span class="task-checkbox"></span><input type="text" class="task-text-input" placeholder="New task...">`;
  list.appendChild(li);

  const input = li.querySelector('input');
  input.focus();
  scrollToInput(input);

  const save = async () => {
    const text = input.value.trim();
    if (text) {
      await apiFetch(`${API}/tasks/${category}`, {
        method: 'POST',
        body: JSON.stringify({ text })
      });
    }
    await loadTasks();
    if (category === 'treats') renderTreats();
    if (category === 'hardThings') renderHardThings();
    if (category === 'shoppingList') renderShoppingList();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });
}

// Randomizer
async function logSurpriseOutcome(outcome) {
  if (!currentSurpriseTask) return;
  await apiFetch(`${API}/surprise/outcome`, {
    method: 'POST',
    body: JSON.stringify({ taskId: currentSurpriseTask.id, text: currentSurpriseTask.text, category: currentSurpriseTask.category, outcome })
  });
}

async function surprise() {
  if (currentSurpriseTask) await logSurpriseOutcome('skipped');
  const excludeParam = currentSurpriseTask ? `?exclude=${currentSurpriseTask.id}` : '';
  const res = await fetch(`${API}/random${excludeParam}`, { headers: authHeaders() });
  const task = await res.json();
  const closeBtn = document.getElementById('close-overlay-btn');

  if (!task) {
    currentSurpriseTask = null;
    overlayLabel.textContent = '';
    overlayTask.textContent = 'All done for today!';
    overlayTask.classList.remove('spinning');
    void overlayTask.offsetWidth;
    overlayTask.classList.add('spinning');
    closeBtn.textContent = 'Got it';
    overlay.classList.remove('hidden');
    return;
  }

  currentSurpriseTask = task;
  overlayLabel.textContent = categoryLabels[task.category] || '';
  overlayLabel.classList.toggle('treat-label', task.category === 'treats');
  overlayLabel.classList.toggle('hardthing-label', task.category === 'hardThings');
  overlayTask.textContent = task.text;
  overlayTask.classList.remove('spinning');
  void overlayTask.offsetWidth; // force reflow
  overlayTask.classList.add('spinning');
  closeBtn.textContent = 'I\'ll do it';
  overlay.classList.remove('hidden');
}

// Restore a done/olympus task
async function restoreTask(category, id) {
  await apiFetch(`${API}/restore/${category}/${id}`, { method: 'POST' });
  await loadTasks();
  if (category === 'olympus') renderOlympus();
}

// Render treats
function renderTreats() {
  const list = document.getElementById('list-treats');
  list.innerHTML = '';

  if (!tasks.treats || tasks.treats.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No treats yet — add something nice';
    list.appendChild(li);
    return;
  }

  for (const treat of tasks.treats) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = treat.id;
    li.dataset.category = 'treats';
    li.innerHTML = `
      <span class="task-text">${escapeHtml(treat.text)}</span>
      <div class="task-actions">
        <button class="task-action-btn edit" data-id="${treat.id}" data-category="treats" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${treat.id}" data-category="treats" title="Delete">delete</button>
      </div>
    `;
    list.appendChild(li);
  }
  initSortable('list-treats', 'treats');
}

// Render shopping list
function renderShoppingList() {
  const list = document.getElementById('list-shoppingList');
  const doneSection = document.getElementById('shopping-done-section');
  const doneList = document.getElementById('list-shoppingListDone');
  list.innerHTML = '';
  doneList.innerHTML = '';

  const all = tasks.shoppingList || [];
  const active = all.filter(i => !i.done);
  const done = all.filter(i => i.done);

  if (active.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Nothing here yet — add something to pick up';
    list.appendChild(li);
  } else {
    for (const item of active) {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.id = item.id;
      li.dataset.category = 'shoppingList';
      li.innerHTML = `
        <button class="task-checkbox" data-id="${item.id}" data-category="shoppingList"></button>
        <span class="task-text">${escapeHtml(item.text)}</span>
        <div class="task-actions">
          <button class="task-action-btn edit" data-id="${item.id}" data-category="shoppingList" title="Edit">edit</button>
          <button class="task-action-btn delete" data-id="${item.id}" data-category="shoppingList" title="Delete">delete</button>
        </div>
      `;
      list.appendChild(li);
    }
    initSortable('list-shoppingList', 'shoppingList');
  }

  if (done.length === 0) {
    doneSection.classList.add('hidden');
  } else {
    doneSection.classList.remove('hidden');
    for (const item of done) {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.id = item.id;
      li.dataset.category = 'shoppingList';
      li.innerHTML = `
        <button class="task-checkbox checked" data-id="${item.id}" data-category="shoppingList"></button>
        <span class="task-text">${escapeHtml(item.text)}</span>
      `;
      doneList.appendChild(li);
    }
  }
}

// Render hard things
function renderHardThings() {
  const list = document.getElementById('list-hardThings');
  list.innerHTML = '';

  if (!tasks.hardThings || tasks.hardThings.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = "Nothing here yet — add something you've been avoiding";
    list.appendChild(li);
    return;
  }

  for (const item of tasks.hardThings) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = item.id;
    li.dataset.category = 'hardThings';
    li.innerHTML = `
      <span class="task-text">${escapeHtml(item.text)}</span>
      <div class="task-actions">
        <button class="task-action-btn edit" data-id="${item.id}" data-category="hardThings" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${item.id}" data-category="hardThings" title="Delete">delete</button>
      </div>
    `;
    list.appendChild(li);
  }
  initSortable('list-hardThings', 'hardThings');
}

// Profile selector
function showProfileSelector() {
  profileSelectorView.classList.remove('hidden');
  appHeader.classList.add('hidden');
  mainView.classList.add('hidden');
  olympusView.classList.add('hidden');
  treatsView.classList.add('hidden');
  hardThingsView.classList.add('hidden');
  shoppingListView.classList.add('hidden');
  wardrobeView.classList.add('hidden');
}

function hideProfileSelector() {
  profileSelectorView.classList.add('hidden');
  appHeader.classList.remove('hidden');
}

async function selectProfile(profile) {
  currentProfile = profile;
  localStorage.setItem('currentProfile', profile);
  // Reset per-session state so previous profile doesn't bleed through
  adminPassword = localStorage.getItem(`adminPassword-${profile}`) || null;
  oneOffExpanded = false;
  expandedProjects.clear();
  document.getElementById('profile-btn').textContent = profile.toUpperCase();
  hideProfileSelector();
  applyAuthUI();
  const { passwordRequired } = await fetch(`${API}/auth-mode`, { headers: authHeaders() }).then(r => r.json());
  if (!passwordRequired && !isAdmin()) unlock('dev');
  await loadTasks();
  apiFetch(`${API}/ping`, { method: 'POST' });
  showMain();
  document.body.classList.add('loaded');
}

// View switching
function hideAllViews() {
  mainView.classList.add('hidden');
  olympusView.classList.add('hidden');
  treatsView.classList.add('hidden');
  hardThingsView.classList.add('hidden');
  shoppingListView.classList.add('hidden');
  wardrobeView.classList.add('hidden');
}

function showOlympus() {
  renderOlympus();
  hideAllViews();
  olympusView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  window.scrollTo(0, 0);
}

function showTreats() {
  renderTreats();
  hideAllViews();
  treatsView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  window.scrollTo(0, 0);
}

function showHardThings() {
  renderHardThings();
  hideAllViews();
  hardThingsView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  window.scrollTo(0, 0);
}

function showShoppingList() {
  renderShoppingList();
  hideAllViews();
  shoppingListView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  window.scrollTo(0, 0);
}

function showMain() {
  hideAllViews();
  mainView.classList.remove('hidden');
  document.body.classList.remove('secondary-view');
  window.scrollTo(0, 0);
}

function showWardrobe() {
  renderWardrobe();
  hideAllViews();
  wardrobeView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  window.scrollTo(0, 0);
}

// ============ Wardrobe ============

const WARDROBE_CATS = ['tops', 'bottoms', 'shoes', 'outerwear', 'accessories'];
const WARDROBE_CAT_LABELS = { tops: 'Top', bottoms: 'Bottom', shoes: 'Shoes', outerwear: 'Outerwear', accessories: 'Accessory' };

function renderWardrobe() {
  for (const cat of WARDROBE_CATS) {
    const list = document.getElementById(`list-wardrobe-${cat}`);
    if (!list) continue;
    list.innerHTML = '';
    const items = (tasks.wardrobe || []).filter(i => i.wardrobeCategory === cat);

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = 'Nothing here yet';
      list.appendChild(li);
      continue;
    }

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'task-item wardrobe-item';
      li.dataset.id = item.id;
      li.dataset.category = 'wardrobe';
      const meta = [item.brand, item.color, item.occasion].filter(Boolean).join(' · ');
      li.innerHTML = `
        <div class="wardrobe-item-body">
          <span class="task-text">${escapeHtml(item.text)}</span>
          ${meta ? `<span class="wardrobe-item-meta">${escapeHtml(meta)}</span>` : ''}
        </div>
        <div class="task-actions">
          <button class="task-action-btn edit" data-id="${item.id}" data-category="wardrobe" title="Edit">edit</button>
          <button class="task-action-btn delete" data-id="${item.id}" data-category="wardrobe" title="Delete">delete</button>
        </div>
      `;
      list.appendChild(li);
    }
  }
}

function openWardrobeAddModal(wardrobeCat) {
  capturedPhotos = [];
  wardrobePhotoInput.value = '';
  document.getElementById('wf-name').value = '';
  document.getElementById('wf-brand').value = '';
  document.getElementById('wf-color').value = '';
  document.getElementById('wf-material').value = '';
  document.getElementById('wf-pattern').value = '';
  document.getElementById('wf-occasion').value = '';
  document.getElementById('wf-season').value = 'all';
  document.getElementById('wf-cat').value = wardrobeCat;
  document.getElementById('wardrobe-photo-count').textContent = '';
  document.getElementById('wardrobe-analyze-btn').classList.add('hidden');
  document.getElementById('wardrobe-analyzing-msg').classList.add('hidden');
  wardrobeAddOverlay.classList.remove('hidden');
}

function capturePhoto(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    capturedPhotos.push({
      image: e.target.result.split(',')[1],
      mimeType: file.type || 'image/jpeg'
    });
    const count = capturedPhotos.length;
    document.getElementById('wardrobe-photo-count').textContent = `${count} photo${count > 1 ? 's' : ''}`;
    document.getElementById('wardrobe-analyze-btn').classList.remove('hidden');
    wardrobePhotoInput.value = '';
  };
  reader.readAsDataURL(file);
}

async function analyzePhotos() {
  if (!capturedPhotos.length) return;
  const analyzeBtn = document.getElementById('wardrobe-analyze-btn');
  const analyzingMsg = document.getElementById('wardrobe-analyzing-msg');
  analyzeBtn.classList.add('hidden');
  analyzingMsg.classList.remove('hidden');

  try {
    const res = await apiFetch(`${API}/wardrobe/analyze-photo`, {
      method: 'POST',
      body: JSON.stringify({ images: capturedPhotos })
    });
    const data = await res.json();
    if (data.text)     document.getElementById('wf-name').value     = data.text;
    if (data.brand)    document.getElementById('wf-brand').value    = data.brand;
    if (data.color)    document.getElementById('wf-color').value    = data.color;
    if (data.material) document.getElementById('wf-material').value = data.material;
    if (data.pattern)  document.getElementById('wf-pattern').value  = data.pattern;
    if (data.occasion) document.getElementById('wf-occasion').value = data.occasion;
    if (data.season)   document.getElementById('wf-season').value   = data.season;
    if (data.category) document.getElementById('wf-cat').value      = data.category;
  } catch (err) {
    console.error('Photo analysis failed:', err);
  } finally {
    analyzingMsg.classList.add('hidden');
    analyzeBtn.classList.remove('hidden');
  }
}

async function saveWardrobeItem() {
  const text = document.getElementById('wf-name').value.trim();
  if (!text) return;

  await apiFetch(`${API}/tasks/wardrobe`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      brand:           document.getElementById('wf-brand').value.trim(),
      color:           document.getElementById('wf-color').value.trim(),
      material:        document.getElementById('wf-material').value.trim(),
      pattern:         document.getElementById('wf-pattern').value,
      occasion:        document.getElementById('wf-occasion').value,
      season:          document.getElementById('wf-season').value,
      wardrobeCategory: document.getElementById('wf-cat').value
    })
  });

  capturedPhotos = [];
  wardrobeAddOverlay.classList.add('hidden');
  await loadTasks();
  renderWardrobe();
}

async function suggestOutfit() {
  const promptEl = document.getElementById('outfit-prompt-input');
  const prompt = (promptEl && promptEl.value.trim()) || lastOutfitPrompt;
  if (!prompt) return;
  lastOutfitPrompt = prompt;

  const btn = document.getElementById('suggest-outfit-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Asking…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/wardrobe/suggest-outfit`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prompt })
    });
    const { items } = await res.json();

    document.getElementById('outfit-prompt-echo').textContent = `"${prompt}"`;

    const container = document.getElementById('outfit-items');
    container.innerHTML = '';

    if (!items || items.length === 0) {
      const p = document.createElement('p');
      p.className = 'outfit-empty';
      p.textContent = 'Add some clothes first — or try a different prompt';
      container.appendChild(p);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'outfit-item-row';
        const meta = [item.brand, item.color, item.material].filter(Boolean).join(' · ');
        row.innerHTML = `
          <span class="outfit-cat-label">${escapeHtml(WARDROBE_CAT_LABELS[item.wardrobeCategory] || item.wardrobeCategory)}</span>
          <div class="outfit-item-info">
            <span class="outfit-item-text">${escapeHtml(item.text)}</span>
            ${meta ? `<span class="outfit-item-meta">${escapeHtml(meta)}</span>` : ''}
          </div>
        `;
        container.appendChild(row);
      }
    }

    outfitOverlay.classList.remove('hidden');
  } catch (err) {
    console.error('Outfit suggestion failed:', err);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Double-click to edit one-off or treat task text
document.addEventListener('dblclick', (e) => {
  if (!isAdmin()) return;
  const li = e.target.closest('.task-item');
  if (!li) return;
  e.preventDefault();
  if (!e.target.classList.contains('task-text')) return;
  const editBtn = li.querySelector('.edit[data-category="oneOff"], .edit[data-category="treats"], .edit[data-category="hardThings"], .edit[data-category="shoppingList"], .edit[data-category="wardrobe"]');
  if (editBtn) startEdit(editBtn.dataset.category, Number(editBtn.dataset.id));
});

function closeActionDropdown() {
  const existing = document.querySelector('.action-dropdown');
  if (existing) existing.remove();
}

function openActionDropdown(editBtn) {
  closeActionDropdown();
  const category = editBtn.dataset.category;
  const id = Number(editBtn.dataset.id);
  const rect = editBtn.getBoundingClientRect();

  const dropdown = document.createElement('div');
  dropdown.className = 'action-dropdown';
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.right = (window.innerWidth - rect.right) + 'px';

  const doEdit = document.createElement('button');
  doEdit.textContent = 'edit';
  doEdit.addEventListener('click', (e) => { e.stopPropagation(); closeActionDropdown(); startEdit(category, id); });

  const doDelete = document.createElement('button');
  doDelete.textContent = 'delete';
  doDelete.className = 'dropdown-delete';
  doDelete.addEventListener('click', (e) => { e.stopPropagation(); closeActionDropdown(); deleteTask(category, id); });

  dropdown.appendChild(doEdit);
  dropdown.appendChild(doDelete);
  document.body.appendChild(dropdown);
}

// Event delegation
document.addEventListener('click', (e) => {
  const target = e.target;

  if (!target.closest('.action-dropdown') && !target.classList.contains('edit')) {
    closeActionDropdown();
  }

  if (target.classList.contains('task-checkbox')) {
    toggleTask(target.dataset.category, Number(target.dataset.id));
  }
  else if (target.classList.contains('edit')) {
    if (window.innerWidth <= 480) {
      openActionDropdown(target);
      return;
    }
    startEdit(target.dataset.category, Number(target.dataset.id));
  }
  else if (target.classList.contains('delete')) {
    deleteTask(target.dataset.category, Number(target.dataset.id));
  }
  else if (target.classList.contains('restore')) {
    restoreTask(target.dataset.category, Number(target.dataset.id));
  }
  else if (target.classList.contains('progress-btn') && !target.disabled) {
    updateProgress(Number(target.dataset.id), Number(target.dataset.delta));
  }
  else if (target.classList.contains('add-btn')) {
    addTask(target.dataset.category);
  }
  else if (target.classList.contains('wardrobe-add-btn')) {
    openWardrobeAddModal(target.dataset.wardrobeCat);
  }
  else if (target.classList.contains('step-toggle')) {
    const id = Number(target.dataset.id);
    if (expandedProjects.has(id)) expandedProjects.delete(id);
    else expandedProjects.add(id);
    renderProjects();
  }
  else if (target.classList.contains('step-checkbox')) {
    if (!isAdmin()) return;
    const projectId = Number(target.dataset.projectId);
    const stepId = Number(target.dataset.stepId);
    const project = tasks.projects.find(p => p.id === projectId);
    const step = project && project.steps && project.steps.find(s => s.id === stepId);
    if (step) toggleStep(projectId, stepId, !step.done);
  }
  else if (target.classList.contains('step-delete')) {
    deleteStep(Number(target.dataset.projectId), Number(target.dataset.stepId));
  }
  else if (target.classList.contains('step-text') && target.closest('.step-item')) {
    if (!isAdmin()) return;
    startEditStep(Number(target.dataset.projectId), Number(target.dataset.stepId));
  }
  else if (target.classList.contains('step-add-btn')) {
    addStep(Number(target.dataset.projectId));
  }
});

document.getElementById('randomizer-x-btn').addEventListener('click', async () => {
  await logSurpriseOutcome('dismissed');
  overlay.classList.add('hidden');
  currentSurpriseTask = null;
});
document.getElementById('surprise-btn').addEventListener('click', surprise);
document.getElementById('respin-btn').addEventListener('click', surprise);
document.getElementById('close-overlay-btn').addEventListener('click', async () => {
  await logSurpriseOutcome('acted');
  overlay.classList.add('hidden');
  if (currentSurpriseTask && (currentSurpriseTask.category === 'oneOff' || currentSurpriseTask.category === 'habits')) {
    await toggleTask(currentSurpriseTask.category, currentSurpriseTask.id);
  }
  currentSurpriseTask = null;
});
document.getElementById('home-title').addEventListener('click', showMain);
document.getElementById('olympus-btn').addEventListener('click', showOlympus);
document.getElementById('olympus-back').addEventListener('click', showMain);
document.getElementById('treats-btn').addEventListener('click', showTreats);
document.getElementById('treats-back').addEventListener('click', showMain);
document.getElementById('hard-things-btn').addEventListener('click', showHardThings);
document.getElementById('hard-things-back').addEventListener('click', showMain);
document.getElementById('shopping-list-btn').addEventListener('click', showShoppingList);
document.getElementById('shopping-list-back').addEventListener('click', showMain);

// Close overlay on backdrop click
overlay.addEventListener('click', async (e) => {
  if (e.target === overlay) {
    await logSurpriseOutcome('dismissed');
    overlay.classList.add('hidden');
    currentSurpriseTask = null;
  }
});

// Close overlay on Escape
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    await logSurpriseOutcome('dismissed');
    overlay.classList.add('hidden');
    currentSurpriseTask = null;
    document.getElementById('oracle-overlay').classList.add('hidden');
    outfitOverlay.classList.add('hidden');
    wardrobeAddOverlay.classList.add('hidden');
  }
});

// Oracle
function renderEditSentences() {
  const text = document.getElementById('oracle-text-input').value.trim();
  const container = document.getElementById('oracle-edit-sentence-list');
  const section = document.getElementById('oracle-edit-sentences');
  if (!text) { section.classList.add('hidden'); return; }
  const prevSelected = new Set(
    [...container.querySelectorAll('.oracle-sentence.selected')].map(s => s.textContent.trim())
  );
  const currentPreview = tasks.oracle ? (tasks.oracle.preview || '') : '';
  section.classList.remove('hidden');
  buildSentenceSpans(container, text, s =>
    prevSelected.has(s.trim()) || (currentPreview && currentPreview.includes(s.trim()))
  );
}

function updateOracleActionBtn() {
  const anySelected = document.querySelectorAll('#oracle-full-text .oracle-sentence.selected').length > 0;
  document.getElementById('oracle-save-preview-btn').textContent = anySelected ? 'Save preview' : 'Close';
}

document.getElementById('oracle-block').addEventListener('click', openOracleOverlay);
document.getElementById('oracle-x-btn').addEventListener('click', () => {
  document.getElementById('oracle-overlay').classList.add('hidden');
});
document.getElementById('oracle-edit-btn').addEventListener('click', () => {
  document.getElementById('oracle-source-input').value = tasks.oracle.source || '';
  document.getElementById('oracle-text-input').value = tasks.oracle.text || '';
  document.getElementById('oracle-read-mode').classList.add('hidden');
  document.getElementById('oracle-edit-mode').classList.remove('hidden');
  renderEditSentences();
});
document.getElementById('oracle-cancel-btn').addEventListener('click', () => {
  document.getElementById('oracle-edit-mode').classList.add('hidden');
  document.getElementById('oracle-read-mode').classList.remove('hidden');
  document.getElementById('oracle-overlay').classList.add('hidden');
});
document.getElementById('oracle-save-btn').addEventListener('click', async () => {
  const text = document.getElementById('oracle-text-input').value.trim();
  const source = document.getElementById('oracle-source-input').value.trim();
  const preview = [...document.querySelectorAll('#oracle-edit-sentence-list .oracle-sentence.selected')]
    .map(s => s.textContent.trim()).join(' ');
  await apiFetch(`${API}/oracle`, {
    method: 'PUT',
    body: JSON.stringify({ text, source, preview })
  });
  await loadTasks();
  document.getElementById('oracle-overlay').classList.add('hidden');
});
let editSentenceTimer;
document.getElementById('oracle-text-input').addEventListener('input', () => {
  clearTimeout(editSentenceTimer);
  editSentenceTimer = setTimeout(renderEditSentences, 300);
});
document.getElementById('oracle-text-input').addEventListener('paste', () => {
  setTimeout(renderEditSentences, 50);
});
document.getElementById('oracle-edit-sentence-list').addEventListener('click', (e) => {
  const sentence = e.target.closest('.oracle-sentence');
  if (sentence) sentence.classList.toggle('selected');
});
document.getElementById('oracle-full-text').addEventListener('click', (e) => {
  if (!isAdmin()) return;
  const sentence = e.target.closest('.oracle-sentence');
  if (!sentence) return;
  const text = sentence.textContent.trim();

  if (sentence.classList.contains('selected')) {
    // Tap selected sentence → deselect it
    sentence.classList.remove('selected');
    oracleSelectionOrder = oracleSelectionOrder.filter(s => s !== text);
  } else if (oracleSelectionOrder.length >= 2) {
    // Already have 2 — deselect all, start fresh with this one
    document.querySelectorAll('#oracle-full-text .oracle-sentence').forEach(s => s.classList.remove('selected'));
    sentence.classList.add('selected');
    oracleSelectionOrder = [text];
  } else {
    // 0 or 1 selected — add this one
    sentence.classList.add('selected');
    oracleSelectionOrder.push(text);
  }
  updateOracleActionBtn();
});
document.getElementById('oracle-save-preview-btn').addEventListener('click', async () => {
  if (oracleSelectionOrder.length === 0) {
    // Nothing selected — just close
    document.getElementById('oracle-overlay').classList.add('hidden');
    return;
  }
  // Build preview in document order (not tap order) so it reads naturally
  const selected = [...document.querySelectorAll('#oracle-full-text .oracle-sentence.selected')]
    .map(s => s.textContent.trim()).join(' ');
  await apiFetch(`${API}/oracle`, {
    method: 'PUT',
    body: JSON.stringify({ preview: selected })
  });
  await loadTasks();
  document.getElementById('oracle-overlay').classList.add('hidden');
});
document.getElementById('oracle-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('oracle-overlay'))
    document.getElementById('oracle-overlay').classList.add('hidden');
});

const celebrationOverlay = document.getElementById('oneoff-celebration-overlay');
celebrationOverlay.addEventListener('click', (e) => {
  if (e.target === celebrationOverlay || e.target.classList.contains('celebration-dismiss'))
    celebrationOverlay.classList.add('hidden');
});

document.getElementById('lock-btn').addEventListener('click', () => {
  if (isAdmin()) { lock(); }
  else { const pw = prompt('Password:'); if (pw) unlock(pw); }
});

applyAuthUI();

// Profile selector buttons
document.querySelectorAll('.profile-btn').forEach(btn => {
  btn.addEventListener('click', () => selectProfile(btn.dataset.profile));
});
document.getElementById('profile-btn').addEventListener('click', () => {
  showProfileSelector();
});

// Drag to reorder (SortableJS — works on touch and desktop)
function initSortable(listId, category) {
  const el = document.getElementById(listId);
  if (!el || typeof Sortable === 'undefined') return;
  const existing = Sortable.get(el);
  if (existing) existing.destroy();
  new Sortable(el, {
    animation: 150,
    delay: 300,
    delayOnTouchOnly: true,
    disabled: !isAdmin(),
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onChoose: () => {
      if (navigator.vibrate) navigator.vibrate(10);
    },
    onEnd: async () => {
      const ids = Array.from(el.querySelectorAll('.task-item'))
        .map(li => Number(li.dataset.id))
        .filter(id => id > 0);
      if (!ids.length) return;
      tasks[category] = ids.map(id => (tasks[category] || []).find(t => t.id === id)).filter(Boolean);
      await apiFetch(`${API}/tasks/${category}/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ ids })
      });
    }
  });
}

// Wardrobe listeners
document.getElementById('wardrobe-btn').addEventListener('click', showWardrobe);
document.getElementById('wardrobe-back').addEventListener('click', showMain);
document.getElementById('wardrobe-camera-btn').addEventListener('click', () => wardrobePhotoInput.click());
wardrobePhotoInput.addEventListener('change', e => capturePhoto(e.target.files[0]));
document.getElementById('wardrobe-analyze-btn').addEventListener('click', analyzePhotos);
document.getElementById('wardrobe-save-btn').addEventListener('click', saveWardrobeItem);
document.getElementById('wardrobe-add-x-btn').addEventListener('click', () => wardrobeAddOverlay.classList.add('hidden'));
wardrobeAddOverlay.addEventListener('click', e => { if (e.target === wardrobeAddOverlay) wardrobeAddOverlay.classList.add('hidden'); });

document.getElementById('suggest-outfit-btn').addEventListener('click', suggestOutfit);
document.getElementById('outfit-x-btn').addEventListener('click', () => outfitOverlay.classList.add('hidden'));
document.getElementById('outfit-respin-btn').addEventListener('click', suggestOutfit);
document.getElementById('outfit-close-btn').addEventListener('click', () => outfitOverlay.classList.add('hidden'));
outfitOverlay.addEventListener('click', e => { if (e.target === outfitOverlay) outfitOverlay.classList.add('hidden'); });

// Init — show profile selector or resume stored profile
(async () => {
  // Clean up old single-key format (harmless if absent)
  localStorage.removeItem('adminPassword');
  const stored = localStorage.getItem('currentProfile');
  if (stored === 'vc' || stored === 'fg') {
    await selectProfile(stored);
  } else {
    showProfileSelector();
    document.body.classList.add('loaded');
  }
})();
