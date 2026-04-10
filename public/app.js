const API = '/api';

// Auth
let adminPassword = localStorage.getItem('adminPassword') || null;
function isAdmin() { return adminPassword !== null; }
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
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
function unlock(pw) { adminPassword = pw; localStorage.setItem('adminPassword', pw); applyAuthUI(); }
function lock() { adminPassword = null; localStorage.removeItem('adminPassword'); applyAuthUI(); }

const categoryLabels = {
  oneOff: 'One-off',
  habits: 'Habit',
  projects: 'Project',
  treats: 'Treat',
  hardThings: 'Hard thing'
};

// State
let tasks = { oneOff: [], habits: [], projects: [], treats: [], hardThings: [], done: [], olympus: [] };
const expandedProjects = new Set();
let oneOffExpanded = false;
const ONEOFF_LIMIT = 5;
let currentSurpriseTask = null;
let oracleSelectionOrder = []; // sentence texts in selection order, max 2 (FIFO)

// DOM refs
const overlay = document.getElementById('randomizer-overlay');
const overlayTask = document.getElementById('overlay-task');
const overlayLabel = document.getElementById('overlay-label');
const mainView = document.getElementById('main-view');
const olympusView = document.getElementById('olympus-view');
const treatsView = document.getElementById('treats-view');
const hardThingsView = document.getElementById('hard-things-view');

// Fetch and render
async function loadTasks() {
  const res = await fetch(`${API}/tasks`);
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
        <button class="task-action-btn delete" data-id="${task.id}" data-category="${category}" title="Delete">&times;</button>
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
        <span class="step-text${step.done ? ' done' : ''}">${escapeHtml(step.text)}</span>
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
          <button class="task-action-btn delete" data-id="${task.id}" data-category="projects" title="Delete">&times;</button>
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

  const body = category === 'habits'
    ? { doneToday: !task.doneToday }
    : { done: !task.done };

  await apiFetch(`${API}/tasks/${category}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  await loadTasks();
}

// Edit task
function startEdit(category, id) {
  const taskList = (category === 'treats' || category === 'hardThings') ? tasks[category] : tasks[category];
  const task = taskList.find(t => t.id === id);
  if (!task) return;

  const list = document.getElementById(`list-${category}`);
  const items = list.querySelectorAll('.task-item');

  for (const item of items) {
    const editBtn = item.querySelector('.edit');
    if (editBtn && Number(editBtn.dataset.id) === id) {
      const textSpan = item.querySelector('.task-text');
      const currentText = task.text;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'task-text-input';
      input.value = currentText;

      textSpan.replaceWith(input);
      input.focus();
      input.select();

      const save = async () => {
        const newText = input.value.trim();
        if (newText && newText !== currentText) {
          await apiFetch(`${API}/tasks/${category}/${id}`, {
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

      break;
    }
  }
}

// Delete task
async function deleteTask(category, id) {
  await apiFetch(`${API}/tasks/${category}/${id}`, { method: 'DELETE' });
  await loadTasks();
  if (category === 'treats') renderTreats();
  if (category === 'hardThings') renderHardThings();
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
    : `<span class="task-checkbox"></span><input type="text" class="task-text-input" placeholder="New task...">`;
  list.appendChild(li);

  const input = li.querySelector('input');
  input.focus();

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
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });
}

// Randomizer
async function surprise() {
  const res = await fetch(`${API}/random`);
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
      <div class="task-actions" style="opacity:1">
        <button class="task-action-btn edit" data-id="${treat.id}" data-category="treats" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${treat.id}" data-category="treats" title="Delete">&times;</button>
      </div>
    `;
    list.appendChild(li);
  }
  initSortable('list-treats', 'treats');
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
      <div class="task-actions" style="opacity:1">
        <button class="task-action-btn edit" data-id="${item.id}" data-category="hardThings" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${item.id}" data-category="hardThings" title="Delete">&times;</button>
      </div>
    `;
    list.appendChild(li);
  }
  initSortable('list-hardThings', 'hardThings');
}

// View switching
function hideAllViews() {
  mainView.classList.add('hidden');
  olympusView.classList.add('hidden');
  treatsView.classList.add('hidden');
  hardThingsView.classList.add('hidden');
}

function showOlympus() {
  renderOlympus();
  hideAllViews();
  olympusView.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showTreats() {
  renderTreats();
  hideAllViews();
  treatsView.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showHardThings() {
  renderHardThings();
  hideAllViews();
  hardThingsView.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showMain() {
  hideAllViews();
  mainView.classList.remove('hidden');
  window.scrollTo(0, 0);
}

// Double-click to edit one-off or treat task text
document.addEventListener('dblclick', (e) => {
  if (!isAdmin()) return;
  const li = e.target.closest('.task-item');
  if (!li) return;
  e.preventDefault();
  if (!e.target.classList.contains('task-text')) return;
  const editBtn = li.querySelector('.edit[data-category="oneOff"], .edit[data-category="treats"], .edit[data-category="hardThings"]');
  if (editBtn) startEdit(editBtn.dataset.category, Number(editBtn.dataset.id));
});

// Event delegation
document.addEventListener('click', (e) => {
  const target = e.target;

  if (target.classList.contains('task-checkbox')) {
    toggleTask(target.dataset.category, Number(target.dataset.id));
  }
  else if (target.classList.contains('edit')) {
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
  else if (target.classList.contains('step-add-btn')) {
    addStep(Number(target.dataset.projectId));
  }
});

document.getElementById('surprise-btn').addEventListener('click', surprise);
document.getElementById('respin-btn').addEventListener('click', surprise);
document.getElementById('close-overlay-btn').addEventListener('click', async () => {
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

// Close overlay on backdrop click
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) overlay.classList.add('hidden');
});

// Close overlay on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    overlay.classList.add('hidden');
    document.getElementById('oracle-overlay').classList.add('hidden');
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
  document.getElementById('oracle-read-mode').classList.remove('hidden');
  document.getElementById('oracle-edit-mode').classList.add('hidden');
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
    // Deselect
    sentence.classList.remove('selected');
    oracleSelectionOrder = oracleSelectionOrder.filter(s => s !== text);
  } else {
    // Select — enforce max 2 (FIFO: evict oldest if at limit)
    if (oracleSelectionOrder.length >= 2) {
      const oldest = oracleSelectionOrder.shift();
      document.querySelectorAll('#oracle-full-text .oracle-sentence').forEach(span => {
        if (span.textContent.trim() === oldest) span.classList.remove('selected');
      });
    }
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

document.getElementById('lock-btn').addEventListener('click', () => {
  if (isAdmin()) { lock(); }
  else { const pw = prompt('Password:'); if (pw) unlock(pw); }
});
applyAuthUI();

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

// Init — auto-unlock in dev mode (no password required on server)
(async () => {
  const { passwordRequired } = await fetch(`${API}/auth-mode`).then(r => r.json());
  if (!passwordRequired && !isAdmin()) unlock('dev');
  loadTasks();
})();
