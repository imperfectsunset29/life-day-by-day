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
  const isWrite = options.method && options.method !== 'GET';
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    if (isWrite) {
      showSaveFailed(); // quiet design: saving is silent, only a failure speaks
      loadTasks().catch(() => {}); // undo any optimistic check-off that didn't stick
    }
    throw err;
  }
  if (res.status === 401) { lock(); alert('Wrong password — locked.'); throw new Error('Unauthorized'); }
  if (isWrite && res.status >= 500) showSaveFailed();
  return res;
}

let saveFailedTimer = null;
function showSaveFailed() {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = "Didn't save. Try again.";
  el.classList.remove('hidden');
  clearTimeout(saveFailedTimer);
  saveFailedTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// Quiet design: only what can't be undone asks first. Resolves true to go ahead.
function askConfirm(text, okLabel) {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-text').textContent = text;
  const ok = document.getElementById('confirm-ok-btn');
  const cancel = document.getElementById('confirm-cancel-btn');
  ok.textContent = okLabel;
  overlay.classList.remove('hidden');
  return new Promise(resolve => {
    const done = (answer) => {
      overlay.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      resolve(answer);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === overlay) done(false); };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
  });
}

// Quiet design: a few hints, each shown once (for the rest of that visit), then never again.
const HINTS = {
  reorder: 'Hold a row to move it.',
  garment: 'Tap a piece to see its story.',
  step: 'Tap a step to edit it.'
};
const hintsThisVisit = new Set();
function hintFor(key) {
  if (hintsThisVisit.has(key)) return true;
  try {
    if (localStorage.getItem(`hint-${key}`)) return false;
    localStorage.setItem(`hint-${key}`, '1');
  } catch { return false; }
  hintsThisVisit.add(key);
  return true;
}
function hintHTML(key) {
  return hintFor(key) ? `<p class="hint-line">${HINTS[key]}</p>` : '';
}
// Places (or removes) a one-time hint right after an element
function placeHint(afterEl, key, show) {
  if (!afterEl) return;
  const next = afterEl.nextElementSibling;
  if (next && next.dataset.hint === key) next.remove();
  if (!show || !hintFor(key)) return;
  const p = document.createElement('p');
  p.className = 'hint-line';
  p.dataset.hint = key;
  p.textContent = HINTS[key];
  afterEl.after(p);
}

// Quiet design: a soft haptic on small finishes. Android has vibrate(); iOS Safari has no
// haptics API, but toggling a native switch input gives its system tick.
let hapticSwitch = null;
function haptic() {
  if (navigator.vibrate) { navigator.vibrate(12); return; }
  if (!hapticSwitch) {
    const label = document.createElement('label');
    label.className = 'haptic-switch';
    label.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    hapticSwitch = label;
  }
  hapticSwitch.click();
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
  shoppingList: 'Errand',
  wishlist: 'Wish',
  dreams: 'Dream'
};

// State
let tasks = { oneOff: [], habits: [], projects: [], treats: [], hardThings: [], shoppingList: [], wishlist: [], acquired: [], wardrobe: [], dreams: [], done: [], olympus: [] };
const expandedProjects = new Set();
let oneOffExpanded = false;
const ONEOFF_LIMIT = 5;
let currentSurpriseTask = null;
let oracleSelectionOrder = []; // sentence texts in selection order, max 2 (FIFO)
let capturedPhotos = []; // [{ image: base64, mimeType }] — cleared after each wardrobe save
let editingWardrobeId = null; // set while the add/edit modal is editing an existing item, else null
let lastOutfitPrompt = '';
let outfitPhoto = null;     // { image: base64, mimeType } attached to the outfit request; kept for Re-spin, never saved
// Principle 2 (off the hook): re-spins are free, but after a few in a row a plain line
// suggests going with what life picked. Counts reset whenever a fresh spin starts.
const SPIN_NUDGE_AFTER = 3;
let surpriseRespins = 0;
let outfitRespins = 0;

function updateSpinNudge(el, respins) {
  const show = respins >= SPIN_NUDGE_AFTER;
  el.textContent = show ? `Life has picked ${respins + 1} times. Maybe this one?` : '';
  el.classList.toggle('hidden', !show);
}

let shownOutfits = [];     // garment-ID sets already shown for the current prompt, so Re-spin avoids them
let currentOutfit = null;  // { itemIds, prompt, weather } for the outfit on screen — "Love it" records it as worn
let wardrobeStats = null;  // from /api/wardrobe/stats: per-garment wear history + closet summary
let editingDreamId = null; // set while the dream modal is editing an existing dream, else null
let pendingDreamImage = ''; // data URI of the photo attached in the dream modal, '' if none


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
const dreamsView = document.getElementById('dreams-view');
const dreamAddOverlay = document.getElementById('dream-add-overlay');
const dreamPhotoInput = document.getElementById('dream-photo-input');
const wardrobeAddOverlay = document.getElementById('wardrobe-add-overlay');
const wardrobeGlobalAddBtn = document.getElementById('wardrobe-global-add-btn');
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
  placeHint(document.getElementById('list-oneOff'), 'reorder', isAdmin() && tasks.oneOff.length > 1);
  hydrateLinkPreviews();
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
    li.textContent = 'Nothing here.';
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
      <span class="task-text">${renderTaskText(task.text)}</span>
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
  if (steps.length && isAdmin()) html += hintHTML('step');

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
    li.textContent = 'Nothing here.';
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
        <span class="task-text">${renderTaskText(task.text)}</span>
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
  if (done) haptic();
  await apiFetch(`${API}/tasks/projects/${projectId}/steps/${stepId}`, {
    method: 'PUT',
    body: JSON.stringify({ done })
  });
  await loadTasks();
  playBeat(`.step-checkbox[data-step-id="${stepId}"]`, done ? 'finish-beat' : 'undo-beat');
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

  // At 100% the server writes a fresh quote, which takes a moment — open the
  // overlay now so the finish feels instant, and let the quote fill in when it lands.
  if (newProgress >= 100) openCelebrationOverlay();

  const putRes = await apiFetch(`${API}/tasks/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ progress: newProgress })
  });

  if (newProgress >= 100) {
    let reflection = 'It is finished, which is more than most things can say.';
    let carriedDays = null;
    try {
      const result = await putRes.json();
      if (result.reflection) reflection = result.reflection;
      if (typeof result.carriedDays === 'number') carriedDays = result.carriedDays;
    } catch {
      // keep the default line above
    }
    loadTasks(); // fire without await — re-renders in background behind overlay
    showCelebration(reflection, ceremonyTierFor(carriedDays));
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
      <span class="task-text">${renderTaskText(task.text)}</span>
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
        <span class="olympus-card-title">${renderTaskText(entry.text)}</span>
        <span class="olympus-card-date">${date}</span>
      </div>
      <p class="olympus-card-reflection">"${escapeHtml(entry.reflection)}"</p>
      <button class="task-action-btn restore olympus-restore" data-id="${entry.id}" data-category="olympus">undo</button>
    `;

    list.appendChild(card);
  }
  hydrateLinkPreviews();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Renders item text as plain escaped text, unless the whole thing is a URL (e.g. a
// pasted product/ad link with tracking params) — then it renders as a compact,
// truncated link with a favicon instead of an unwrappable wall of text.
// Cache of fetched link previews for this session — url -> { title, image } | null.
// Keeps repeated re-renders of the same link from re-fetching it every time.
const linkPreviewCache = new Map();

// Best-effort description pulled straight from the URL's path when the page's real
// title isn't available (fetch blocked, no AI/paid API used) — e.g. a Farfetch link
// like /shopping/prada-nylon-tote-bag-item-12345.aspx becomes "Prada Nylon Tote Bag Item".
function urlSlugTitle(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  let last = decodeURIComponent(segments[segments.length - 1]);
  last = last.replace(/\.(html?|aspx|php|asp|jsp)$/i, '');
  last = last.replace(/[-_+]+/g, ' ').trim();
  last = last.replace(/\b\w*\d\w*\b/g, '').replace(/\s+/g, ' ').trim(); // drop SKU/ID-looking tokens ("Wo11", "Kp228")
  if (!last || last.length < 3) return null;
  if (!last.includes(' ') && !/[aeiouy]/i.test(last)) return null; // a lone code like "Srgr" isn't a name
  return last.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// opts.title: a name already settled (your words, or one saved on a wish), so the live
// lookup must not overwrite it. opts.image: the product's photo, shown in place of the
// shop's icon; if the shop won't serve it, the icon comes back.
function renderLinkChip(url, opts = {}) {
  const hostname = url.hostname.replace(/^www\./, '');
  const favicon = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
  const cached = linkPreviewCache.get(url.href);
  const title = opts.title || (cached && cached.title) || urlSlugTitle(url) || '';
  const showDomain = title && title.toLowerCase() !== hostname.toLowerCase();
  const icon = opts.image
    ? `<img class="task-link-thumb" src="${escapeHtml(opts.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.className='task-link-favicon';this.src='${favicon}'">`
    : `<img class="task-link-favicon" src="${favicon}" alt="" loading="lazy" onerror="this.remove()">`;

  return `<a class="task-link" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title || url.href)}"${opts.title ? '' : ` data-link-url="${escapeHtml(url.href)}"`}>
    ${icon}
    <span class="task-link-text">
      <span class="task-link-title">${escapeHtml(title || hostname)}</span>
      ${showDomain ? `<span class="task-link-domain">${escapeHtml(hostname)}</span>` : ''}
    </span>
  </a>`;
}

// Renders item text as plain escaped text, except any URL found *anywhere* in it (not
// just text that's nothing but a URL — e.g. a pasted "Product Name https://..." share)
// which renders as a compact chip instead of an unwrappable raw link.
function renderTaskText(text) {
  const urlPattern = /https?:\/\/[^\s<]+/g;
  const matches = [...text.matchAll(urlPattern)];
  if (matches.length === 0) return escapeHtml(text);

  let html = '';
  let lastIndex = 0;
  for (const match of matches) {
    const rawUrl = match[0];
    const cleanUrl = rawUrl.replace(/[.,;:!?)\]]+$/, ''); // strip likely trailing punctuation
    const trailing = rawUrl.slice(cleanUrl.length);

    let url;
    try { url = new URL(cleanUrl); } catch { continue; } // not actually a valid URL — leave as plain text

    html += escapeHtml(text.slice(lastIndex, match.index));
    html += renderLinkChip(url);
    html += escapeHtml(trailing);
    lastIndex = match.index + rawUrl.length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

// Fetches the real page title for any not-yet-cached link chip currently in the DOM,
// then updates it in place. Call after any render that might have added a .task-link.
function hydrateLinkPreviews() {
  document.querySelectorAll('.task-link[data-link-url]').forEach(async (el) => {
    const url = el.dataset.linkUrl;
    if (linkPreviewCache.has(url)) {
      applyLinkPreview(el, url, linkPreviewCache.get(url));
      return;
    }
    if (el.dataset.hydrating) return;
    el.dataset.hydrating = '1';
    let data = null;
    try {
      const res = await apiFetch(`${API}/link-preview?url=${encodeURIComponent(url)}`);
      data = res.ok ? await res.json() : null;
    } catch (err) {
      console.error('Link preview failed for', url, err);
    }
    linkPreviewCache.set(url, data);
    applyLinkPreview(el, url, data);
  });
}

function applyLinkPreview(el, url, data) {
  if (!data || !data.title) return;
  const titleEl = el.querySelector('.task-link-title');
  if (titleEl) titleEl.textContent = data.title;
  el.title = data.title;
  if (!el.querySelector('.task-link-domain')) {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const span = document.createElement('span');
    span.className = 'task-link-domain';
    span.textContent = hostname;
    el.querySelector('.task-link-text').appendChild(span);
  }
}

// Toggle task done
async function toggleTask(category, id) {
  const taskList = tasks[category];
  const task = taskList.find(t => t.id === id);
  if (!task) return;

  const wasDone = category === 'habits' ? task.doneToday : task.done;
  const nowDone = !wasDone;
  if (nowDone) haptic();

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
  if (SHOPPING_CATS.includes(category)) renderShoppingList();

  if (category === 'oneOff' && !wasDone && tasks.oneOff.length === 0) {
    showOneOffCelebration(); // the big moment replaces the small beat
  } else {
    playBeat(`li.task-item[data-id="${id}"]`, nowDone ? 'finish-beat' : 'undo-beat');
  }
}

// ---- Principle 3 (scaled ceremony) ----
// Small finishes get a calm, wordless beat on their row; undoing gets a quieter sage one.
// Big finishes (a project ascending, the whole list cleared) get a Pynchon quote performed by
// one of several ceremonies, never the same one twice in a row, grander the longer it was carried.
function playBeat(selector, kind) {
  requestAnimationFrame(() => {
    document.querySelectorAll(selector).forEach(el => {
      el.classList.remove('finish-beat', 'undo-beat');
      void el.offsetWidth; // restart the animation if it's already running
      el.classList.add(kind);
      el.addEventListener('animationend', () => el.classList.remove(kind), { once: true });
    });
  });
}

const CEREMONIES = ['sand', 'ink', 'type', 'rise'];
const CEREMONY_TIERS = ['ceremony-base', 'ceremony-long', 'ceremony-epic'];
const CEREMONY_SPEED = { 'ceremony-base': 1, 'ceremony-long': 1.35, 'ceremony-epic': 1.7 };
let ceremonyTimers = [];

function ceremonyTierFor(carriedDays) {
  if (carriedDays == null || carriedDays < 30) return 'ceremony-base';
  if (carriedDays < 180) return 'ceremony-long';
  return 'ceremony-epic';
}

function pickCeremony() {
  let last = null;
  try { last = localStorage.getItem('lastCeremony'); } catch {}
  const options = CEREMONIES.filter(c => c !== last);
  const pick = options[Math.floor(Math.random() * options.length)];
  try { localStorage.setItem('lastCeremony', pick); } catch {}
  return pick;
}

function playCeremony(quote, tier = 'ceremony-base') {
  const el = document.getElementById('oneoff-celebration-overlay');
  const content = el.querySelector('.celebration-content');
  const canvas = el.querySelector('.celebration-canvas');
  const textEl = el.querySelector('.celebration-text');
  content.classList.remove(...CEREMONY_TIERS);
  content.classList.add(tier);
  const speed = CEREMONY_SPEED[tier] || 1;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ceremony = reduced ? 'still' : pickCeremony();

  if (ceremony === 'sand') {
    textEl.classList.add('hidden');
    canvas.classList.remove('hidden');
    animateSandText(canvas, quote, speed);
    return;
  }

  canvas.classList.add('hidden');
  textEl.classList.remove('hidden');
  textEl.className = `celebration-text ceremony-${ceremony}`;
  textEl.textContent = '';

  if (ceremony === 'still') {
    textEl.textContent = quote;
    return;
  }

  if (ceremony === 'type') {
    // Typed out letter by letter, with a soft caret
    const typed = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'ceremony-caret';
    textEl.append(typed, caret);
    [...quote].forEach((ch, i) => {
      ceremonyTimers.push(setTimeout(() => { typed.textContent += ch; }, i * 32 * speed));
    });
    ceremonyTimers.push(setTimeout(() => caret.remove(), quote.length * 32 * speed + 1200));
    return;
  }

  // ink: words sharpen out of a blur; rise: words float up into place
  quote.split(' ').forEach((word, i, all) => {
    const span = document.createElement('span');
    span.className = 'ceremony-word';
    span.textContent = word + (i < all.length - 1 ? ' ' : '');
    textEl.appendChild(span);
    ceremonyTimers.push(setTimeout(() => span.classList.add('in'), (ceremony === 'ink' ? 110 : 70) * i * speed));
  });
}

function openCelebrationOverlay() {
  const el = document.getElementById('oneoff-celebration-overlay');
  // Wipe the previous quote so it doesn't flash while the new one is on its way
  ceremonyTimers.forEach(clearTimeout);
  ceremonyTimers = [];
  const canvas = el.querySelector('.celebration-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  el.querySelector('.celebration-text').textContent = '';
  el.classList.remove('hidden');
}

async function showCelebration(quote, tier = 'ceremony-base') {
  const el = document.getElementById('oneoff-celebration-overlay');
  el.classList.remove('hidden');
  await document.fonts.ready;
  requestAnimationFrame(() => playCeremony(quote, tier));
}

async function showOneOffCelebration() {
  // Open the overlay immediately rather than waiting on the quote round-trip first —
  // the panel appears right away, and the sand-text animation fills in once it arrives.
  const el = document.getElementById('oneoff-celebration-overlay');
  openCelebrationOverlay();
  await document.fonts.ready;

  let quote = 'The list is empty. The world, improbably, persists.';
  try {
    const res = await apiFetch(`${API}/quote/celebration`);
    if (res.ok) {
      const data = await res.json();
      if (data.quote) quote = data.quote;
    }
  } catch {
    // network/auth failure — fall back to the default quote above
  }

  requestAnimationFrame(() => playCeremony(quote, 'ceremony-base'));
}

function animateSandText(canvas, text, speed = 1) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  if (!W) return;

  const fontSize = 20;
  const lineHeight = fontSize * 1.85;

  // Word-wrap first so we can compute the required canvas height
  const measure = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
  measure.font = `italic ${fontSize}px "Instrument Serif", serif`;
  const maxLineW = W - 48;
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (measure.measureText(test).width > maxLineW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  const totalTextH = lines.length * lineHeight;
  const H = totalTextH + lineHeight; // one line of vertical padding
  canvas.style.height = H + 'px';

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
  octx.font = `italic ${fontSize}px "Instrument Serif", serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'alphabetic';
  octx.fillStyle = '#fff';

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
    delay: ((yMax - t.y) / ySpan) * 700 * speed,   // bottom-first; slower for longer-carried work
    dur: (850 + Math.random() * 400) * speed,
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
  if (category === 'wardrobe') {
    openWardrobeEditModal(id);
    return;
  }
  if (category === 'wishlist') {
    openWishEditModal(id);
    return;
  }

  const task = tasks[category] && tasks[category].find(t => t.id === id);
  if (!task) return;

  let li;
  const list = document.getElementById(`list-${category}`);
  if (!list) return;
  for (const item of list.querySelectorAll('.task-item')) {
    const editBtn = item.querySelector('.edit');
    if (editBtn && Number(editBtn.dataset.id) === id) { li = item; break; }
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
const CONFIRM_DELETE = ['projects', 'wardrobe', 'dreams'];
async function deleteTask(category, id) {
  if (CONFIRM_DELETE.includes(category)) {
    const item = (tasks[category] || []).find(t => t.id === id);
    const name = item ? (item.text || item.title || '').trim() : '';
    const ok = await askConfirm(name ? `Delete “${name}”? This can't be undone.` : "Delete this? This can't be undone.", 'Delete');
    if (!ok) return;
  }
  await apiFetch(`${API}/tasks/${category}/${id}`, { method: 'DELETE' });
  await loadTasks();
  if (category === 'treats') renderTreats();
  if (category === 'hardThings') renderHardThings();
  if (SHOPPING_CATS.includes(category)) renderShoppingList();
  if (category === 'wardrobe') renderWardrobe();
  if (category === 'dreams') renderDreams();
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
    ? `<input type="text" class="task-text-input" placeholder="New errand...">`
    : category === 'wishlist'
    ? `<input type="text" class="task-text-input" placeholder="Something you want, or paste a link...">`
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
    if (SHOPPING_CATS.includes(category)) renderShoppingList();
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
  if (category === 'olympus') {
    const entry = tasks.olympus.find(t => t.id === id);
    const name = entry ? entry.text : 'this project';
    const ok = await askConfirm(`Bring “${name}” back? It starts again at 0%, and its quote is let go.`, 'Bring it back');
    if (!ok) return;
  }
  await apiFetch(`${API}/restore/${category}/${id}`, { method: 'POST' });
  await loadTasks();
  if (category === 'olympus') renderOlympus();
  playBeat(`li.task-item[data-id="${id}"]`, 'undo-beat');
}

// Render treats
function renderTreats() {
  const list = document.getElementById('list-treats');
  list.innerHTML = '';

  if (!tasks.treats || tasks.treats.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Nothing here.';
    list.appendChild(li);
    return;
  }

  for (const treat of tasks.treats) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = treat.id;
    li.dataset.category = 'treats';
    li.innerHTML = `
      <span class="task-text">${renderTaskText(treat.text)}</span>
      <div class="task-actions">
        <button class="task-action-btn edit" data-id="${treat.id}" data-category="treats" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${treat.id}" data-category="treats" title="Delete">delete</button>
      </div>
    `;
    list.appendChild(li);
  }
  initSortable('list-treats', 'treats');
  hydrateLinkPreviews();
}

// Dreams render as a dated feed (Journal-app style), grouped by month, newest first —
// so they're always sorted by createdAt rather than relying on stored array order.
function formatDreamMonth(iso) {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  const opts = d.getFullYear() === new Date().getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' };
  return d.toLocaleDateString('en-US', opts);
}

function formatDreamDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Render dreams
function renderDreams() {
  const list = document.getElementById('list-dreams');
  list.innerHTML = '';

  if (!tasks.dreams || tasks.dreams.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Nothing here.';
    list.appendChild(li);
    return;
  }

  const sorted = [...tasks.dreams].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  let currentMonth = null;
  for (const dream of sorted) {
    const monthLabel = formatDreamMonth(dream.createdAt);
    if (monthLabel !== currentMonth) {
      currentMonth = monthLabel;
      const header = document.createElement('li');
      header.className = 'dream-month-header';
      header.textContent = monthLabel;
      list.appendChild(header);
    }

    const li = document.createElement('li');
    li.className = 'task-item dream-card';
    li.dataset.id = dream.id;
    li.dataset.category = 'dreams';
    li.innerHTML = `
      ${dream.image ? `<img class="dream-card-image" src="${dream.image}" alt="">` : ''}
      <span class="task-text dream-card-title">${renderTaskText(dream.text)}</span>
      <div class="dream-card-footer">
        <span class="dream-card-date">${formatDreamDate(dream.createdAt)}</span>
        <button class="task-action-btn edit dream-menu-btn" data-id="${dream.id}" data-category="dreams" title="More">⋯</button>
      </div>
    `;
    list.appendChild(li);
  }
  hydrateLinkPreviews();
}

// Resizes/compresses an image file before it's stored as a data URI on a dream,
// so a multi-MB phone photo doesn't bloat tasks.json.
function resizeImageForStorage(file, maxDim = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function setDreamPhotoPreview(dataUri) {
  const preview = document.getElementById('dream-photo-preview');
  const removeBtn = document.getElementById('dream-photo-remove-btn');
  pendingDreamImage = dataUri || '';
  if (pendingDreamImage) {
    preview.src = pendingDreamImage;
    preview.classList.remove('hidden');
    removeBtn.classList.remove('hidden');
  } else {
    preview.src = '';
    preview.classList.add('hidden');
    removeBtn.classList.add('hidden');
  }
}

function openDreamAddModal() {
  editingDreamId = null;
  dreamPhotoInput.value = '';
  document.getElementById('dream-text-input').value = '';
  setDreamPhotoPreview('');
  document.getElementById('dream-modal-label').textContent = 'Add dream';
  document.getElementById('dream-save-btn').textContent = 'Save';
  dreamAddOverlay.classList.remove('hidden');
}

function openDreamEditModal(id) {
  const dream = tasks.dreams.find(d => d.id === id);
  if (!dream) return;

  editingDreamId = id;
  dreamPhotoInput.value = '';
  document.getElementById('dream-text-input').value = dream.text;
  setDreamPhotoPreview(dream.image || '');
  document.getElementById('dream-modal-label').textContent = 'Edit dream';
  document.getElementById('dream-save-btn').textContent = 'Update';
  dreamAddOverlay.classList.remove('hidden');
}

async function saveDream() {
  const text = document.getElementById('dream-text-input').value.trim();
  if (!text) return;

  const payload = { text, image: pendingDreamImage };

  if (editingDreamId) {
    await apiFetch(`${API}/tasks/dreams/${editingDreamId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  } else {
    await apiFetch(`${API}/tasks/dreams`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  editingDreamId = null;
  dreamAddOverlay.classList.add('hidden');
  await loadTasks();
  renderDreams();
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
    li.textContent = 'Nothing here.';
    list.appendChild(li);
  } else {
    for (const item of active) {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.id = item.id;
      li.dataset.category = 'shoppingList';
      // Lines read from a photo may carry a swap (what to buy if it's hard to find); "swap?" reveals it
      const swapOpen = item.swap && openSwaps.has(item.id);
      li.innerHTML = `
        <button class="task-checkbox" data-id="${item.id}" data-category="shoppingList"></button>
        <div class="errand-main">
          <span class="task-text">${renderTaskText(item.text)}</span>
          ${swapOpen ? `<p class="errand-swap">${escapeHtml(item.swap)}<button class="task-action-btn use-swap" data-id="${item.id}">use this</button></p>` : ''}
        </div>
        <div class="task-actions">
          ${item.swap ? `<button class="task-action-btn swap" data-id="${item.id}" title="If it's hard to find">${swapOpen ? 'hide' : 'swap?'}</button>` : ''}
          <button class="task-action-btn move" data-id="${item.id}" data-category="shoppingList" title="Move to wishlist">→ wishlist</button>
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
        <span class="task-text">${renderTaskText(item.text)}</span>
      `;
      doneList.appendChild(li);
    }
  }
  renderWishlist();
  renderAcquired();
  hydrateLinkPreviews();
}

// ---- Wishlist (longer-term wants) and the Acquired archive ----

const SHOPPING_CATS = ['shoppingList', 'wishlist', 'acquired'];
const openSwaps = new Set(); // errand ids whose swap line is showing (this visit only)

function toggleSwap(id) {
  if (openSwaps.has(id)) openSwaps.delete(id); else openSwaps.add(id);
  renderShoppingList();
}

// "Use this": the swap becomes the errand, and there's nothing left to swap
async function useSwap(id) {
  const item = tasks.shoppingList.find(i => i.id === id);
  if (!item || !item.swap) return;
  item.text = item.swap;
  item.swap = '';
  openSwaps.delete(id);
  renderShoppingList();
  await apiFetch(`${API}/tasks/shoppingList/${id}`, { method: 'PUT', body: JSON.stringify({ text: item.text, swap: '' }) });
}

// ---- Photo → Errands ----
// A photo (a recipe, a screenshot of a text asking for razors, a handwritten list; up to 4)
// is read into lines to buy. The review card shows them ticked, pantry staples (recipes only)
// unticked below; only ticked lines are added. Photos are never saved.
let shopTitle = '';
let shopLines = []; // [{ text, staple, swap, chosen }]

async function readShopPhoto(files) {
  if (!files.length) return;
  shopTitle = '';
  shopLines = [];
  const addBtn = document.getElementById('shop-photo-add-btn');
  const errorEl = document.getElementById('shop-photo-error');
  errorEl.classList.add('hidden');
  renderShopReview();
  document.getElementById('shop-photo-overlay').classList.remove('hidden');
  addBtn.classList.add('is-waiting'); // waiting is wordless: the button keeps its label
  addBtn.disabled = true;

  try {
    const photos = await Promise.all([...files].slice(0, 4).map(async f => {
      const dataUri = await resizeImageForStorage(f, 1568, 0.85); // sharp enough for small print
      return { image: dataUri.split(',')[1], mimeType: 'image/jpeg' };
    }));
    const res = await apiFetch(`${API}/shopping/read-photo`, { method: 'POST', body: JSON.stringify({ photos }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reading failed');
    shopTitle = data.title || '';
    shopLines = (data.items || []).map(i => ({ ...i, chosen: !i.staple }));
    if (!shopLines.length) {
      errorEl.textContent = "Couldn't find anything to buy in that photo.";
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Shopping photo reading failed:', err);
    errorEl.textContent = "Couldn't read that. Try another photo.";
    errorEl.classList.remove('hidden');
  } finally {
    addBtn.classList.remove('is-waiting');
    renderShopReview();
  }
}

function renderShopReview() {
  document.getElementById('shop-photo-title').textContent = shopTitle;
  const row = (line, i) => `
    <li><button class="shop-photo-item${line.chosen ? ' chosen' : ''}" data-shop-index="${i}">
      <span class="task-checkbox${line.chosen ? ' checked' : ''}"></span>
      <span class="shop-photo-item-text">${escapeHtml(line.text)}</span>
    </button></li>`;
  const toBuy = shopLines.map((l, i) => [l, i]).filter(([l]) => !l.staple);
  const pantry = shopLines.map((l, i) => [l, i]).filter(([l]) => l.staple);
  document.getElementById('shop-photo-items').innerHTML = toBuy.map(([l, i]) => row(l, i)).join('');
  document.getElementById('shop-photo-pantry').innerHTML = pantry.map(([l, i]) => row(l, i)).join('');
  document.getElementById('shop-photo-pantry-label').classList.toggle('hidden', !pantry.length);
  const addBtn = document.getElementById('shop-photo-add-btn');
  if (!addBtn.classList.contains('is-waiting')) addBtn.disabled = !shopLines.some(l => l.chosen);
}

async function addShopLinesToErrands() {
  const chosen = shopLines.filter(l => l.chosen).map(({ text, swap }) => ({ text, swap }));
  if (!chosen.length) return;
  document.getElementById('shop-photo-overlay').classList.add('hidden');
  await apiFetch(`${API}/shopping/from-photo`, { method: 'POST', body: JSON.stringify({ title: shopTitle, items: chosen }) });
  shopLines = [];
  await loadTasks();
  renderShoppingList();
}
let acquiredExpanded = false;
let openWishId = null;       // wish shown in the wish card
let lastAcquired = null;     // the wish just bought, for "Add to wardrobe"

function renderWishlist() {
  const list = document.getElementById('list-wishlist');
  list.innerHTML = '';
  const wishes = tasks.wishlist || [];
  if (wishes.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Nothing here.';
    list.appendChild(li);
    return;
  }
  wishes.forEach((wish, i) => {
    const li = document.createElement('li');
    li.className = 'task-item wish-row';
    // Calm list: the first few show, the rest wait behind "— N more"
    if (i >= WISH_VISIBLE && !wishlistExpanded) li.classList.add('list-hidden');
    li.dataset.id = wish.id;
    li.dataset.category = 'wishlist';
    const { noteUsed } = wishName(wish);
    li.innerHTML = `
      <div class="wish-row-body">
        <span class="task-text">${wishTextHTML(wish)}</span>
        ${wish.note && !noteUsed ? `<span class="wish-row-note">${escapeHtml(wish.note)}</span>` : ''}
      </div>
      <div class="task-actions">
        <button class="task-action-btn move" data-id="${wish.id}" data-category="wishlist" title="Move to errands">→ errands</button>
        <button class="task-action-btn edit" data-id="${wish.id}" data-category="wishlist" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${wish.id}" data-category="wishlist" title="Delete">delete</button>
      </div>
    `;
    list.appendChild(li);
  });
  initSortable('list-wishlist', 'wishlist');

  const section = list.parentElement;
  const existingMore = section.querySelector('.show-more-btn');
  if (existingMore) existingMore.remove();
  if (wishes.length > WISH_VISIBLE && !wishlistExpanded) {
    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.textContent = `— ${wishes.length - WISH_VISIBLE} more`;
    btn.addEventListener('click', () => { wishlistExpanded = true; renderWishlist(); hydrateLinkPreviews(); });
    section.appendChild(btn);
  }
  lookUpWishNames();
}

const WISH_VISIBLE = 3;           // wishes shown before the fold
const WISH_RELOOK_DAYS = 7;       // a shop that gave nothing is asked again after a week
let wishlistExpanded = false;     // this visit only
const wishLookups = new Set();    // wish ids already looked up this visit

// The clearest name for a wish, in order: words you typed with the link, your note
// (when the wish is only a link), the name saved from the shop's page. null = let the
// chip fall back to a live lookup, the link's own words, then the shop's name.
function wishName(wish) {
  const link = wish.text.match(/https?:\/\/[^\s<]+/);
  if (!link) return { title: wish.text, noteUsed: false };
  const words = wish.text.replace(link[0], '').trim();
  if (words) return { title: words, noteUsed: false };
  if (wish.note) return { title: wish.note, noteUsed: true };
  if (wish.name) return { title: wish.name, noteUsed: false };
  return { title: null, noteUsed: false };
}

// A wish (or acquired item) as one chip: its name, the shop beneath, the photo if there is one
function wishTextHTML(wish) {
  const link = wish.text.match(/https?:\/\/[^\s<]+/);
  if (!link) return escapeHtml(wish.text);
  let url;
  try { url = new URL(link[0].replace(/[.,;:!?)\]]+$/, '')); } catch { return escapeHtml(wish.text); }
  return renderLinkChip(url, { title: wishName(wish).title, image: wish.image });
}

// Each wish's link is looked up once on the server and the name and photo are saved on
// the wish, so the list reads the same on every visit. Admin only (it writes).
function lookUpWishNames() {
  if (!isAdmin()) return;
  const weekAgo = Date.now() - WISH_RELOOK_DAYS * 86400000;
  for (const wish of tasks.wishlist || []) {
    if (wish.name || wishLookups.has(wish.id) || !/https?:\/\//.test(wish.text)) continue;
    if (wish.resolvedAt && new Date(wish.resolvedAt).getTime() > weekAgo) continue;
    wishLookups.add(wish.id);
    apiFetch(`${API}/wishlist/${wish.id}/resolve`, { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const w = data && (tasks.wishlist || []).find(x => x.id === wish.id);
        if (!w) return;
        w.resolvedAt = data.resolvedAt || w.resolvedAt;
        if ((data.name && data.name !== w.name) || (data.image && data.image !== w.image)) {
          w.name = data.name || w.name;
          w.image = data.image || w.image;
          renderWishlist();
          hydrateLinkPreviews();
        }
      })
      .catch(err => console.error('Wish lookup failed:', err));
  }
}

function renderAcquired() {
  const section = document.getElementById('acquired-section');
  const list = document.getElementById('list-acquired');
  const items = (tasks.acquired || []).slice().reverse(); // newest first
  section.classList.toggle('hidden', items.length === 0);
  document.getElementById('count-acquired').textContent = `(${items.length})`;
  document.getElementById('acquired-chevron').textContent = acquiredExpanded ? '▾' : '▸';
  list.classList.toggle('hidden', !acquiredExpanded);
  list.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'task-item acquired-row';
    li.dataset.id = item.id;
    li.dataset.category = 'acquired';
    li.innerHTML = `
      <span class="task-text">${wishTextHTML(item)}</span>
      <span class="acquired-row-meta">${escapeHtml(`wanted ${wantedFor(item.createdAt, item.acquiredAt)} · ${formatShortDate(item.acquiredAt)}`)}</span>
      <div class="task-actions">
        <button class="task-action-btn delete" data-id="${item.id}" data-category="acquired" title="Delete">delete</button>
      </div>
    `;
    list.appendChild(li);
  }
}

function wantedFor(fromIso, toIso) {
  const days = Math.max(0, Math.round((new Date(toIso) - new Date(fromIso)) / 86400000));
  if (days === 0) return 'less than a day';
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}

function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A readable name for a wish: its link's page title if we have one, else the text
function wishDisplayName(text) {
  const match = text.match(/https?:\/\/[^\s<]+/);
  if (!match) return text;
  const rest = text.replace(match[0], '').trim();
  if (rest) return rest;
  const cached = linkPreviewCache.get(match[0].replace(/[.,;:!?)\]]+$/, ''));
  if (cached && cached.title) return cached.title;
  try { return urlSlugTitle(new URL(match[0])) || new URL(match[0]).hostname.replace(/^www\./, ''); }
  catch { return text; }
}

function openWishCard(id) {
  const wish = (tasks.wishlist || []).find(w => w.id === id);
  if (!wish) return;
  openWishId = id;
  document.getElementById('wish-label').textContent = 'Wishlist';
  // Title is a plain name; the link (if any) sits beneath it as a normal chip
  const named = wishName(wish);
  document.getElementById('wish-title').textContent = named.title || wishDisplayName(wish.text);
  const link = wish.text.match(/https?:\/\/[^\s<]+/);
  document.getElementById('wish-link').innerHTML = link ? renderTaskText(link[0]) : '';
  const note = document.getElementById('wish-note');
  note.textContent = wish.note || '';
  note.classList.toggle('hidden', !wish.note || named.noteUsed); // already the title
  document.getElementById('wish-since').textContent = `On your list since ${formatShortDate(wish.createdAt)}`;
  document.getElementById('wish-actions').classList.toggle('hidden', !isAdmin());
  document.getElementById('wish-acquired-actions').classList.add('hidden');
  wishOverlay.classList.remove('hidden');
  hydrateLinkPreviews();
}

async function markWishBought() {
  const wish = (tasks.wishlist || []).find(w => w.id === openWishId);
  if (!wish) return;
  const res = await apiFetch(`${API}/wishlist/${wish.id}/acquire`, { method: 'POST' });
  if (!res.ok) return;
  lastAcquired = await res.json();

  // The card becomes the moment of acquiring: how long it was wanted, and a door to the Wardrobe
  document.getElementById('wish-label').textContent = 'Acquired';
  document.getElementById('wish-since').textContent = `Wanted for ${wantedFor(lastAcquired.createdAt, lastAcquired.acquiredAt)}.` // plain fact: shopping rewards itself (principle 3);
  document.getElementById('wish-actions').classList.add('hidden');
  document.getElementById('wish-acquired-actions').classList.remove('hidden');
  await loadTasks();
  renderShoppingList();
}

function addAcquiredToWardrobe() {
  if (!lastAcquired) return;
  wishOverlay.classList.add('hidden');
  openWardrobeAddModal();
  const match = lastAcquired.text.match(/https?:\/\/[^\s<]+/);
  let origin = 'from the wishlist';
  if (match) {
    try { origin = new URL(match[0]).hostname.replace(/^www\./, ''); } catch {}
  }
  document.getElementById('wf-name').value = wishName(lastAcquired).title || wishDisplayName(lastAcquired.text);
  document.getElementById('wf-origin').value = origin;
  document.getElementById('wf-acquired').value = new Date(lastAcquired.acquiredAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (lastAcquired.note) document.getElementById('wf-memory').value = lastAcquired.note;
}

function openWishEditModal(id) {
  const wish = (tasks.wishlist || []).find(w => w.id === id);
  if (!wish) return;
  openWishId = id;
  document.getElementById('we-text').value = wish.text;
  document.getElementById('we-note').value = wish.note || '';
  wishEditOverlay.classList.remove('hidden');
}

async function saveWishEdit() {
  const text = document.getElementById('we-text').value.trim();
  const note = document.getElementById('we-note').value.trim();
  if (!text) return;
  await apiFetch(`${API}/tasks/wishlist/${openWishId}`, {
    method: 'PUT',
    body: JSON.stringify({ text, note })
  });
  wishEditOverlay.classList.add('hidden');
  await loadTasks();
  renderShoppingList();
}

async function moveShoppingItem(id, to) {
  await apiFetch(`${API}/shopping/move`, { method: 'POST', body: JSON.stringify({ id, to }) });
  await loadTasks();
  renderShoppingList();
}

// Render hard things
function renderHardThings() {
  const list = document.getElementById('list-hardThings');
  list.innerHTML = '';

  if (!tasks.hardThings || tasks.hardThings.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Nothing here.';
    list.appendChild(li);
    return;
  }

  for (const item of tasks.hardThings) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = item.id;
    li.dataset.category = 'hardThings';
    li.innerHTML = `
      <span class="task-text">${renderTaskText(item.text)}</span>
      <div class="task-actions">
        <button class="task-action-btn edit" data-id="${item.id}" data-category="hardThings" title="Edit">edit</button>
        <button class="task-action-btn delete" data-id="${item.id}" data-category="hardThings" title="Delete">delete</button>
      </div>
    `;
    list.appendChild(li);
  }
  initSortable('list-hardThings', 'hardThings');
  hydrateLinkPreviews();
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
  dreamsView.classList.add('hidden');
  floatingNavDock.classList.add('hidden');
}

function hideProfileSelector() {
  profileSelectorView.classList.add('hidden');
  appHeader.classList.remove('hidden');
  floatingNavDock.classList.remove('hidden');
}

async function selectProfile(profile) {
  currentProfile = profile;
  localStorage.setItem('currentProfile', profile);
  // Reset per-session state so previous profile doesn't bleed through
  adminPassword = localStorage.getItem(`adminPassword-${profile}`) || null;
  oneOffExpanded = false;
  expandedProjects.clear();
  collapsedWardrobeCats.clear();
  wardrobeStats = null;
  currentOutfit = null;
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
  dreamsView.classList.add('hidden');
}

function showOlympus() {
  renderOlympus();
  hideAllViews();
  olympusView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  setActiveNav('olympus');
  window.scrollTo(0, 0);
}

function showTreats() {
  renderTreats();
  hideAllViews();
  treatsView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  setActiveNav(null);
  window.scrollTo(0, 0);
}

function showHardThings() {
  renderHardThings();
  hideAllViews();
  hardThingsView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  setActiveNav(null);
  window.scrollTo(0, 0);
}

function showShoppingList() {
  renderShoppingList();
  hideAllViews();
  shoppingListView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  setActiveNav('shopping');
  window.scrollTo(0, 0);
}

function showMain() {
  hideAllViews();
  mainView.classList.remove('hidden');
  document.body.classList.remove('secondary-view');
  setActiveNav('home');
  window.scrollTo(0, 0);
}

function showWardrobe() {
  // Every visit starts fully collapsed; expanding only lasts for the current visit
  WARDROBE_CATS.forEach(cat => collapsedWardrobeCats.add(cat));
  renderWardrobe();
  refreshWardrobeStats();
  hideAllViews();
  wardrobeView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  setActiveNav('wardrobe');
  window.scrollTo(0, 0);
}

function showDreams() {
  renderDreams();
  hideAllViews();
  dreamsView.classList.remove('hidden');
  document.body.classList.add('secondary-view');
  setActiveNav('dreams');
  window.scrollTo(0, 0);
}

// ============ Floating collapsible nav ============
//
// The nav is a glass pill that lives at the bottom of every screen. Expanded it
// shows all five destinations; collapsed it folds down to a single circle
// showing the icon of wherever you currently are. It collapses on its own once
// you stop touching it, and as soon as you start scrolling, so it stays out of
// the way of the content. Tapping the circle opens it back up.

const floatingNavDock = document.getElementById('floating-nav-dock');
const floatingNav = document.getElementById('floating-nav');
const NAV_IDLE_MS = 2600;      // how long an untouched open pill stays open
const NAV_SETTLE_MS = 450;     // pause after a jump before folding away

let navCollapseTimer = null;

const NAV_DESTINATIONS = {
  home: showMain,
  olympus: showOlympus,
  wardrobe: showWardrobe,
  shopping: showShoppingList,
  dreams: showDreams,
};

function collapseNav() {
  clearTimeout(navCollapseTimer);
  navCollapseTimer = null;
  floatingNav.classList.add('collapsed');
}

// delay = ms of inactivity before it folds itself back up; null keeps it open.
function expandNav(delay = NAV_IDLE_MS) {
  clearTimeout(navCollapseTimer);
  floatingNav.classList.remove('collapsed');
  navCollapseTimer = delay === null ? null : setTimeout(collapseNav, delay);
}

// `key` is a NAV_DESTINATIONS key, or null for views that aren't in the nav
// (Treats, Hard Things) — those show no highlight, and the collapsed circle
// falls back to Home so there's always a way back.
function setActiveNav(key) {
  const items = floatingNav.querySelectorAll('.floating-nav-item');
  items.forEach(item => {
    const isActive = item.dataset.nav === key;
    item.classList.toggle('active', isActive);
    item.classList.toggle('collapsed-face', key ? isActive : item.dataset.nav === 'home');
    item.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

floatingNav.addEventListener('click', e => {
  // While collapsed the pill is a single button: any tap just opens it.
  if (floatingNav.classList.contains('collapsed')) {
    expandNav();
    return;
  }
  const item = e.target.closest('.floating-nav-item');
  if (!item) { expandNav(); return; }
  const go = NAV_DESTINATIONS[item.dataset.nav];
  if (go) go();
  expandNav(NAV_SETTLE_MS);
});

// Scrolling means you're reading, not navigating — get out of the way.
window.addEventListener('scroll', () => {
  if (!floatingNav.classList.contains('collapsed')) collapseNav();
}, { passive: true });

// Tapping anywhere else closes it too.
document.addEventListener('click', e => {
  if (floatingNav.classList.contains('collapsed')) return;
  if (!e.target.closest('#floating-nav')) collapseNav();
});

// ============ Wardrobe ============

const WARDROBE_CATS = ['tops', 'bottoms', 'dresses', 'jumpsuitsRompers', 'shoes', 'outerwear', 'accessories'];
const WARDROBE_CAT_LABELS = { tops: 'Top', bottoms: 'Bottom', dresses: 'Dress', jumpsuitsRompers: 'Jumpsuit/Romper', shoes: 'Shoes', outerwear: 'Outerwear', accessories: 'Accessory' };
const WARDROBE_SUBCATS = {
  tops: ['T-shirts', 'Blouses & Shirts', 'Sweaters & Knits', 'Cardigans', 'Tanks & Camisoles', 'Other'],
  bottoms: ['Jeans', 'Trousers & Pants', 'Skirts', 'Shorts', 'Leggings', 'Other'],
  dresses: ['Casual Dresses', 'Cocktail & Party', 'Formal & Evening', 'Maxi Dresses', 'Wrap Dresses', 'Other'],
  jumpsuitsRompers: ['Jumpsuits', 'Rompers', 'Overalls', 'Other'],
  shoes: ['Sneakers', 'Boots', 'Heels', 'Flats & Loafers', 'Sandals', 'Other'],
  outerwear: ['Coats', 'Jackets', 'Blazers', 'Vests', 'Other'],
  accessories: ['Bags', 'Jewelry', 'Scarves', 'Belts', 'Hats', 'Other']
};

// Keyword fallback so items saved before subcategories existed (no item.subcategory)
// still group sensibly, inferred from their name instead of all dumping into "Other".
const WARDROBE_SUBCAT_KEYWORDS = {
  tops: [
    ['Cardigans', ['cardigan']],
    ['T-shirts', ['t-shirt', 'tshirt', 'tee']],
    ['Tanks & Camisoles', ['tank', 'cami']],
    ['Sweaters & Knits', ['sweater', 'knit', 'turtleneck', 'pullover']],
    ['Blouses & Shirts', ['blouse', 'shirt']]
  ],
  bottoms: [
    ['Jeans', ['jean']],
    ['Trousers & Pants', ['trouser', 'pant', 'slack']],
    ['Skirts', ['skirt']],
    ['Shorts', ['short']],
    ['Leggings', ['legging']]
  ],
  dresses: [
    ['Cocktail & Party', ['cocktail', 'party']],
    ['Formal & Evening', ['formal', 'evening', 'gown']],
    ['Maxi Dresses', ['maxi']],
    ['Wrap Dresses', ['wrap']]
  ],
  jumpsuitsRompers: [
    ['Jumpsuits', ['jumpsuit']],
    ['Rompers', ['romper']],
    ['Overalls', ['overall']]
  ],
  shoes: [
    ['Sneakers', ['sneaker', 'trainer']],
    ['Boots', ['boot']],
    ['Heels', ['heel', 'pump']],
    ['Flats & Loafers', ['flat', 'loafer']],
    ['Sandals', ['sandal']]
  ],
  outerwear: [
    ['Coats', ['coat']],
    ['Jackets', ['jacket']],
    ['Blazers', ['blazer']],
    ['Vests', ['vest']]
  ],
  accessories: [
    ['Bags', ['bag', 'purse', 'tote', 'clutch']],
    ['Jewelry', ['earring', 'necklace', 'ring', 'bracelet', 'jewelry']],
    ['Scarves', ['scarf']],
    ['Belts', ['belt']],
    ['Hats', ['hat', 'cap', 'beanie']]
  ]
};

function guessWardrobeSubcat(cat, text) {
  const rules = WARDROBE_SUBCAT_KEYWORDS[cat];
  if (!rules) return 'Other';
  const lower = text.toLowerCase();
  for (const [subcat, keywords] of rules) {
    if (keywords.some(k => lower.includes(k))) return subcat;
  }
  return 'Other';
}

function populateSubcatOptions(cat, selected) {
  const select = document.getElementById('wf-subcat');
  const options = WARDROBE_SUBCATS[cat] || [];
  select.innerHTML = '<option value="">Subcategory</option>' +
    options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  select.value = options.includes(selected) ? selected : '';
}

const collapsedWardrobeCats = new Set();

function renderWardrobe() {
  for (const cat of WARDROBE_CATS) {
    const list = document.getElementById(`list-wardrobe-${cat}`);
    const count = document.getElementById(`count-wardrobe-${cat}`);
    const header = document.querySelector(`.wardrobe-cat-header[data-wardrobe-cat="${cat}"]`);
    if (!list) continue;
    list.innerHTML = '';
    const items = (tasks.wardrobe || []).filter(i => i.wardrobeCategory === cat);
    const collapsed = collapsedWardrobeCats.has(cat);

    if (count) count.textContent = `(${items.length})`;
    if (header) {
      const chevron = header.querySelector('.wardrobe-cat-chevron');
      if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
    }
    list.classList.toggle('hidden', collapsed);

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = 'Nothing here.';
      list.appendChild(li);
      continue;
    }

    const subcats = WARDROBE_SUBCATS[cat] || [];
    const grouped = new Map(subcats.map(sc => [sc, []]));
    for (const item of items) {
      const sc = subcats.includes(item.subcategory) ? item.subcategory : guessWardrobeSubcat(cat, item.text);
      if (!grouped.has(sc)) grouped.set(sc, []);
      grouped.get(sc).push(item);
    }

    for (const [sc, groupItems] of grouped) {
      if (!groupItems.length) continue;

      const subHeader = document.createElement('li');
      subHeader.className = 'wardrobe-subcat-label';
      subHeader.textContent = sc;
      list.appendChild(subHeader);

      for (const item of groupItems) {
        const li = document.createElement('li');
        li.className = 'task-item wardrobe-row';
        li.dataset.id = item.id;
        li.dataset.category = 'wardrobe';
        const st = wardrobeStats && wardrobeStats.items[item.id];
        // A kind mirror: show how many times it's been worn; an unworn piece just shows its color
        const meta = (st && st.timesWorn) ? wornLabel(st) : (item.color || item.brand || '');
        const metaClass = 'wardrobe-row-meta';
        li.innerHTML = `
          <span class="task-text">${renderTaskText(item.text)}</span>
          ${meta ? `<span class="${metaClass}">${escapeHtml(meta)}</span>` : ''}
          <div class="task-actions">
            <button class="task-action-btn edit" data-id="${item.id}" data-category="wardrobe" title="Edit">edit</button>
            <button class="task-action-btn delete" data-id="${item.id}" data-category="wardrobe" title="Delete">delete</button>
          </div>
        `;
        list.appendChild(li);
      }
    }
  }
  renderClosetLine();
  hydrateLinkPreviews();
}

// ---- Wardrobe history (wear log, garment card) ----

async function refreshWardrobeStats() {
  try {
    const res = await fetch(`${API}/wardrobe/stats`, { headers: authHeaders() });
    if (!res.ok) return;
    wardrobeStats = await res.json();
    renderWardrobe();
  } catch {
    // stats are decoration — rows fall back to color/brand without them
  }
}

// Totals only, never time-since or absence (first principle: a kind mirror)
function wornLabel(st) {
  return `worn ${st.timesWorn} time${st.timesWorn === 1 ? '' : 's'}`;
}

function formatWearDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderClosetLine() {
  const el = document.getElementById('wardrobe-closet-line');
  if (!el) return;
  const pieces = (tasks.wardrobe || []).length;
  if (!pieces) { el.textContent = ''; placeHint(el, 'garment', false); return; }
  const parts = [`${pieces} piece${pieces === 1 ? '' : 's'}`];
  if (wardrobeStats) {
    const { colors, mostLoyal } = wardrobeStats.summary;
    if (colors) parts.push(`${colors} color${colors === 1 ? '' : 's'}`);
    if (mostLoyal) parts.push(`most loyal: ${mostLoyal.text}`);
  }
  el.textContent = parts.join(' · ');
  placeHint(el, 'garment', true);
}

function openGarmentCard(id) {
  const item = (tasks.wardrobe || []).find(i => i.id === id);
  if (!item) return;
  const st = wardrobeStats && wardrobeStats.items[id];
  const nameOf = otherId => ((tasks.wardrobe || []).find(i => i.id === otherId) || {}).text;

  document.getElementById('garment-cat').textContent = WARDROBE_CAT_LABELS[item.wardrobeCategory] || item.wardrobeCategory;
  document.getElementById('garment-title').textContent = item.text;
  document.getElementById('garment-meta').textContent = [item.brand, item.color, item.material, item.pattern].filter(Boolean).join(' · ');

  const sections = document.getElementById('garment-sections');
  sections.innerHTML = '';
  const addSection = (label, html) => {
    const div = document.createElement('div');
    div.className = 'garment-section';
    div.innerHTML = `<p class="garment-section-label">${label}</p>${html}`;
    sections.appendChild(div);
  };

  if (st) {
    // Only what happened: a count when there is one, nothing when there isn't
    if (st.timesWorn) {
      addSection('Wear', `<p class="garment-section-text">Worn ${st.timesWorn} time${st.timesWorn === 1 ? '' : 's'}</p>`);
    }
    if (st.friends.length) {
      addSection('Usually seen with', st.friends
        .map(f => `<p class="garment-section-text">${escapeHtml(nameOf(f.id) || 'something since given away')} <span class="garment-count">${f.count}×</span></p>`).join(''));
    }
    if (st.story.length) {
      addSection('Its story', st.story.map(w => `
        <p class="garment-story-row">
          <span class="garment-story-date">${escapeHtml(formatWearDate(w.date))}</span>
          <span class="garment-story-text">${w.prompt ? `“${escapeHtml(w.prompt)}”` : 'an unrecorded occasion'}${w.weather ? ` <span class="garment-story-weather">${escapeHtml(w.weather)}</span>` : ''}</span>
        </p>`).join(''));
    }
  }

  const origin = [item.origin, item.acquired].filter(Boolean).join(' · ');
  if (origin || item.memory) {
    addSection('Origin', `${origin ? `<p class="garment-section-text">${escapeHtml(origin)}</p>` : ''}${item.memory ? `<p class="garment-memory">${escapeHtml(item.memory)}</p>` : ''}`);
  }

  const editBtn = document.getElementById('garment-edit-btn');
  editBtn.dataset.id = id;
  editBtn.parentElement.classList.toggle('hidden', !isAdmin());

  garmentOverlay.classList.remove('hidden');
}

// "Not my style": note the outfit as a dislike (admin only), then spin a new one right away
async function passOnOutfit() {
  const outfit = currentOutfit;
  currentOutfit = null;
  if (outfit && isAdmin()) {
    try {
      await apiFetch(`${API}/wardrobe/pass`, { method: 'POST', body: JSON.stringify({ itemIds: outfit.itemIds, prompt: outfit.prompt }) });
    } catch {
      // the new spin matters more than the note — carry on
    }
  }
  suggestOutfit();
}

async function recordOutfitWorn() {
  if (!currentOutfit || !isAdmin()) return;
  const outfit = currentOutfit;
  currentOutfit = null; // one "Love it" = one wear
  try {
    await apiFetch(`${API}/wardrobe/wear`, { method: 'POST', body: JSON.stringify(outfit) });
    await refreshWardrobeStats();
  } catch {
    // not worth interrupting the moment over — the outfit just isn't logged
  }
}

function toggleWardrobeCat(cat) {
  if (collapsedWardrobeCats.has(cat)) collapsedWardrobeCats.delete(cat);
  else collapsedWardrobeCats.add(cat);
  renderWardrobe();
}

// wardrobeCat: a category to preset (from a category's own + button), or null/undefined
// to leave it for photo analysis to auto-detect (from the global "+ Add Garment" button).
function openWardrobeAddModal(wardrobeCat) {
  editingWardrobeId = null;
  capturedPhotos = [];
  wardrobePhotoInput.value = '';
  document.getElementById('wf-name').value = '';
  document.getElementById('wf-brand').value = '';
  document.getElementById('wf-color').value = '';
  document.getElementById('wf-material').value = '';
  document.getElementById('wf-pattern').value = '';
  document.getElementById('wf-occasion').value = '';
  document.getElementById('wf-season').value = 'all';
  document.getElementById('wf-origin').value = '';
  document.getElementById('wf-acquired').value = '';
  document.getElementById('wf-memory').value = '';
  document.getElementById('wf-cat').value = wardrobeCat || '';
  populateSubcatOptions(wardrobeCat || '');
  document.getElementById('wardrobe-photo-count').textContent = '';
  document.getElementById('wardrobe-analyze-btn').classList.add('hidden');
  setWardrobeCameraBtn(false);
  document.getElementById('wardrobe-modal-label').textContent = 'Add item';
  document.getElementById('wardrobe-save-btn').textContent = 'Save';
  wardrobeAddOverlay.classList.remove('hidden');
}

function openWardrobeEditModal(id) {
  const item = tasks.wardrobe.find(i => i.id === id);
  if (!item) return;

  editingWardrobeId = id;
  capturedPhotos = [];
  wardrobePhotoInput.value = '';
  document.getElementById('wf-name').value = item.text;
  document.getElementById('wf-brand').value = item.brand || '';
  document.getElementById('wf-color').value = item.color || '';
  document.getElementById('wf-material').value = item.material || '';
  document.getElementById('wf-pattern').value = item.pattern || '';
  document.getElementById('wf-occasion').value = item.occasion || '';
  document.getElementById('wf-season').value = item.season || 'all';
  document.getElementById('wf-origin').value = item.origin || '';
  document.getElementById('wf-acquired').value = item.acquired || '';
  document.getElementById('wf-memory').value = item.memory || '';
  document.getElementById('wf-cat').value = item.wardrobeCategory || 'tops';
  populateSubcatOptions(item.wardrobeCategory || 'tops', item.subcategory);
  document.getElementById('wardrobe-photo-count').textContent = '';
  document.getElementById('wardrobe-analyze-btn').classList.add('hidden');
  setWardrobeCameraBtn(false);
  document.getElementById('wardrobe-modal-label').textContent = 'Edit item';
  document.getElementById('wardrobe-save-btn').textContent = 'Update';
  wardrobeAddOverlay.classList.remove('hidden');
}

// Max two buttons per group: once a photo is in, Analyze (button) + Save (button) lead, and
// "Add photo" becomes a text action. Reset to a button whenever the modal opens fresh.
function setWardrobeCameraBtn(hasPhotos) {
  const btn = document.getElementById('wardrobe-camera-btn');
  btn.className = hasPhotos ? 'btn-text' : 'btn-secondary';
  btn.textContent = hasPhotos ? 'Add another photo' : 'Add photo';
}

function capturePhoto(file, { analyze = false } = {}) {
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
    setWardrobeCameraBtn(true);
    wardrobePhotoInput.value = '';
    if (analyze) analyzePhotos();
  };
  reader.readAsDataURL(file);
}

async function analyzePhotos() {
  if (!capturedPhotos.length) return;
  const analyzeBtn = document.getElementById('wardrobe-analyze-btn');
  analyzeBtn.classList.add('is-waiting');
  analyzeBtn.disabled = true;

  try {
    const res = await apiFetch(`${API}/wardrobe/analyze-photo`, {
      method: 'POST',
      body: JSON.stringify({ images: capturedPhotos })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');
    if (data.text)     document.getElementById('wf-name').value     = data.text;
    if (data.brand)    document.getElementById('wf-brand').value    = data.brand;
    if (data.color)    document.getElementById('wf-color').value    = data.color;
    if (data.material) document.getElementById('wf-material').value = data.material;
    if (data.pattern)  document.getElementById('wf-pattern').value  = data.pattern;
    if (data.occasion) document.getElementById('wf-occasion').value = data.occasion;
    if (data.season)   document.getElementById('wf-season').value   = data.season;
    if (data.category) document.getElementById('wf-cat').value      = data.category;
    populateSubcatOptions(document.getElementById('wf-cat').value, data.subcategory);
  } catch (err) {
    console.error('Photo analysis failed:', err);
    alert(`Couldn't analyze photos: ${err.message}`);
  } finally {
    analyzeBtn.classList.remove('is-waiting');
    analyzeBtn.disabled = false;
  }
}

async function saveWardrobeItem() {
  const text = document.getElementById('wf-name').value.trim();
  if (!text) return;

  const payload = {
    text,
    brand:           document.getElementById('wf-brand').value.trim(),
    color:           document.getElementById('wf-color').value.trim(),
    material:        document.getElementById('wf-material').value.trim(),
    pattern:         document.getElementById('wf-pattern').value,
    occasion:        document.getElementById('wf-occasion').value,
    season:          document.getElementById('wf-season').value,
    wardrobeCategory: document.getElementById('wf-cat').value,
    subcategory:     document.getElementById('wf-subcat').value,
    origin:          document.getElementById('wf-origin').value.trim(),
    acquired:        document.getElementById('wf-acquired').value.trim(),
    memory:          document.getElementById('wf-memory').value.trim()
  };

  if (editingWardrobeId) {
    await apiFetch(`${API}/tasks/wardrobe/${editingWardrobeId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  } else {
    await apiFetch(`${API}/tasks/wardrobe`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  editingWardrobeId = null;
  capturedPhotos = [];
  wardrobeAddOverlay.classList.add('hidden');
  // Open the saved garment's category so it doesn't disappear into a collapsed list
  collapsedWardrobeCats.delete(payload.wardrobeCategory);
  await loadTasks();
  renderWardrobe();
  refreshWardrobeStats();
}

// Resolves to { lat, lon } or null if geolocation is unavailable, denied, or times out.
// Races an explicit timeout alongside getCurrentPosition's own `timeout` option — some
// browsers don't reliably fire it while a permission prompt is stuck unresolved.
function getUserLocation() {
  const geo = new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 10 * 60 * 1000 }
    );
  });
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 6000));
  return Promise.race([geo, timeout]);
}

// The label is fixed rather than read back from the button: a second request started
// mid-flight (e.g. a quick Re-spin) once read "Asking…" and restored that instead.
const SUGGEST_OUTFIT_LABEL = 'What should I wear?';
let outfitRequestInFlight = false;

// A photo for the outfit (a party flier, an outfit to echo). Resized like dream photos, but
// sharper (1568px is what the model reads best), so small print on a flier stays legible.
async function attachOutfitPhoto(file) {
  if (!file) return;
  try {
    const dataUri = await resizeImageForStorage(file, 1568, 0.85);
    setOutfitPhoto({ image: dataUri.split(',')[1], mimeType: 'image/jpeg' }, dataUri);
  } catch (err) {
    console.error('Outfit photo failed to load:', err);
  }
}

function setOutfitPhoto(photo, dataUri) {
  outfitPhoto = photo;
  shownOutfits = []; // a new photo is a new occasion: a fresh set of spins
  const preview = document.getElementById('outfit-photo-preview');
  if (dataUri) preview.src = dataUri; else preview.removeAttribute('src');
  preview.classList.toggle('hidden', !photo);
  document.getElementById('outfit-photo-remove-btn').classList.toggle('hidden', !photo);
  document.getElementById('outfit-photo-btn').classList.toggle('hidden', !!photo); // Remove, then add another
}

async function suggestOutfit() {
  if (outfitRequestInFlight) return; // one request at a time — Re-spin taps while asking are ignored
  const promptEl = document.getElementById('outfit-prompt-input');
  const prompt = (promptEl && promptEl.value.trim()) || lastOutfitPrompt;
  if (!prompt && !outfitPhoto) return; // words, a photo, or both
  if (prompt !== lastOutfitPrompt) shownOutfits = []; // a new occasion starts a fresh set of spins
  lastOutfitPrompt = prompt;

  outfitRequestInFlight = true;
  const btn = document.getElementById('suggest-outfit-btn');
  const respinBtn = document.getElementById('outfit-respin-btn');
  const passBtn = document.getElementById('outfit-pass-btn');
  btn.classList.add('is-waiting');
  btn.disabled = true;
  respinBtn.disabled = true;
  passBtn.disabled = true;

  try {
    const location = await getUserLocation();
    const res = await fetch(`${API}/wardrobe/suggest-outfit`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prompt, photo: outfitPhoto, lat: location && location.lat, lon: location && location.lon, exclude: shownOutfits })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Outfit suggestion failed');
    const { items, weather, wardrobeEmpty, why, occasion } = data;
    // With only a photo, the stylist's reading of it ("70s disco night at a bar") stands in for the words
    const label = prompt || occasion || 'from a photo';
    if (items && items.length) shownOutfits.push(items.map(i => i.id));
    const whyEl = document.getElementById('outfit-why');
    whyEl.textContent = why || '';
    whyEl.classList.toggle('hidden', !why);
    currentOutfit = items && items.length
      ? { itemIds: items.map(i => i.id), prompt: label, weather: weather ? `${weather.tempF}°F, ${weather.description}` : '' }
      : null;

    document.getElementById('outfit-prompt-echo').textContent = prompt ? `"${prompt}"` : label;
    const weatherEl = document.getElementById('outfit-weather');
    weatherEl.textContent = weather ? `${weather.tempF}°F, ${weather.description}` : '';
    weatherEl.classList.toggle('hidden', !weather);

    const container = document.getElementById('outfit-items');
    container.innerHTML = '';

    if (!items || items.length === 0) {
      const p = document.createElement('p');
      p.className = 'outfit-empty';
      p.textContent = wardrobeEmpty
        ? 'Your closet is empty.'
        : "Couldn't put together an outfit for that — try a different prompt";
      container.appendChild(p);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'outfit-item-row';
        const meta = [item.brand, item.color, item.material].filter(Boolean).join(' · ');
        row.innerHTML = `
          <span class="outfit-cat-label">${escapeHtml(WARDROBE_CAT_LABELS[item.wardrobeCategory] || item.wardrobeCategory)}</span>
          <div class="outfit-item-info">
            <span class="outfit-item-text">${renderTaskText(item.text)}</span>
            ${meta ? `<span class="outfit-item-meta">${escapeHtml(meta)}</span>` : ''}
          </div>
        `;
        container.appendChild(row);
      }
    }

    outfitOverlay.classList.remove('hidden');
  } catch (err) {
    console.error('Outfit suggestion failed:', err);
    alert(`Couldn't get an outfit suggestion: ${err.message}`);
  } finally {
    btn.textContent = SUGGEST_OUTFIT_LABEL;
    btn.classList.remove('is-waiting');
    btn.disabled = false;
    respinBtn.disabled = false;
    passBtn.disabled = false;
    outfitRequestInFlight = false;
  }
}

// Double-click to edit one-off or treat task text
document.addEventListener('dblclick', (e) => {
  if (!isAdmin()) return;
  const li = e.target.closest('.task-item');
  if (!li) return;
  e.preventDefault();
  if (!e.target.closest('.task-text')) return;
  const editBtn = li.querySelector('.edit[data-category="oneOff"], .edit[data-category="treats"], .edit[data-category="hardThings"], .edit[data-category="shoppingList"], .edit[data-category="dreams"]');
  if (!editBtn) return;
  if (editBtn.dataset.category === 'dreams') openDreamEditModal(Number(editBtn.dataset.id));
  else startEdit(editBtn.dataset.category, Number(editBtn.dataset.id));
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
  doEdit.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActionDropdown();
    if (category === 'dreams') openDreamEditModal(id);
    else startEdit(category, id);
  });

  const doDelete = document.createElement('button');
  doDelete.textContent = 'delete';
  doDelete.className = 'dropdown-delete';
  doDelete.addEventListener('click', (e) => { e.stopPropagation(); closeActionDropdown(); deleteTask(category, id); });

  dropdown.appendChild(doEdit);
  if (category === 'shoppingList' || category === 'wishlist') {
    const to = category === 'shoppingList' ? 'wishlist' : 'shoppingList';
    const doMove = document.createElement('button');
    doMove.textContent = to === 'wishlist' ? 'move to wishlist' : 'move to errands';
    doMove.addEventListener('click', (e) => { e.stopPropagation(); closeActionDropdown(); moveShoppingItem(id, to); });
    dropdown.appendChild(doMove);
  }
  dropdown.appendChild(doDelete);
  document.body.appendChild(dropdown);
}

// The rule for adding: wherever something can be added either by typing or by reading a
// photo (Errands, Wardrobe), its + opens this small menu, "type it" / "from a photo", the
// same .action-dropdown as a row's edit menu on phones, opening under the +. Lists with
// nothing to read from a photo keep a + that goes straight to typing.
function openAddMenu(addBtn, { onType, onPhoto }) {
  closeActionDropdown();
  const rect = addBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'action-dropdown';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';

  const type = document.createElement('button');
  type.textContent = 'type it';
  type.addEventListener('click', (e) => { e.stopPropagation(); closeActionDropdown(); onType(); });

  const photo = document.createElement('button');
  photo.textContent = 'from a photo';
  // onPhoto opens the picker, which must happen inside the tap itself, or phones block it
  photo.addEventListener('click', (e) => { e.stopPropagation(); closeActionDropdown(); onPhoto(); });

  menu.append(type, photo);
  document.body.appendChild(menu);
}

function openAddErrandMenu(addBtn) {
  openAddMenu(addBtn, {
    onType: () => addTask('shoppingList'),
    onPhoto: () => document.getElementById('shop-photo-input').click()
  });
}

// Wardrobe: "from a photo" goes straight to the camera / library; once a photo is picked the
// add-garment form opens with it in and already being read, so the fields fill themselves.
let wardrobePhotoFirstCat = undefined; // set while the picker is open from the menu
function openAddGarmentMenu(addBtn, wardrobeCat) {
  openAddMenu(addBtn, {
    onType: () => openWardrobeAddModal(wardrobeCat),
    onPhoto: () => { wardrobePhotoFirstCat = wardrobeCat || null; wardrobePhotoInput.click(); }
  });
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
  else if (target.classList.contains('dream-menu-btn')) {
    openActionDropdown(target);
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
  else if (target.id === 'dreams-fab') {
    openDreamAddModal();
  }
  else if (target.classList.contains('add-btn')) {
    if (target.dataset.category === 'shoppingList') openAddErrandMenu(target);
    else addTask(target.dataset.category);
  }
  else if (target.classList.contains('wardrobe-add-btn')) {
    openAddGarmentMenu(target, target.dataset.wardrobeCat);
  }
  else if (target.classList.contains('swap')) {
    toggleSwap(Number(target.dataset.id));
  }
  else if (target.classList.contains('use-swap')) {
    useSwap(Number(target.dataset.id));
  }
  else if (target.classList.contains('move')) {
    moveShoppingItem(Number(target.dataset.id), target.dataset.category === 'shoppingList' ? 'wishlist' : 'shoppingList');
  }
  else if (target.closest('.wish-row') && !target.closest('.task-actions') && !target.closest('a')) {
    openWishCard(Number(target.closest('.wish-row').dataset.id));
  }
  else if (target.closest('.acquired-header')) {
    acquiredExpanded = !acquiredExpanded;
    renderAcquired();
  }
  else if (target.closest('.wardrobe-row') && !target.closest('.task-actions') && !target.closest('a')) {
    openGarmentCard(Number(target.closest('.wardrobe-row').dataset.id));
  }
  else if (target.closest('.wardrobe-cat-header')) {
    toggleWardrobeCat(target.closest('.wardrobe-cat-header').dataset.wardrobeCat);
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
document.getElementById('surprise-btn').addEventListener('click', async () => {
  surpriseRespins = 0;
  await surprise();
  updateSpinNudge(document.getElementById('spin-nudge'), surpriseRespins);
});
document.getElementById('respin-btn').addEventListener('click', async () => {
  surpriseRespins++;
  await surprise();
  updateSpinNudge(document.getElementById('spin-nudge'), surpriseRespins);
});
document.getElementById('close-overlay-btn').addEventListener('click', async () => {
  await logSurpriseOutcome('acted');
  if (currentSurpriseTask && currentSurpriseTask.category === 'hardThings') {
    // Pleasures need no applause, but a hard thing done gets the small beat
    haptic();
    playBeat('#randomizer-overlay .overlay-content', 'finish-beat');
    await new Promise(r => setTimeout(r, 750));
  }
  overlay.classList.add('hidden');
  if (currentSurpriseTask && (currentSurpriseTask.category === 'oneOff' || currentSurpriseTask.category === 'habits')) {
    await toggleTask(currentSurpriseTask.category, currentSurpriseTask.id);
  }
  currentSurpriseTask = null;
});
document.getElementById('home-title').addEventListener('click', showMain);
document.getElementById('olympus-back').addEventListener('click', showMain);
document.getElementById('treats-btn').addEventListener('click', showTreats);
document.getElementById('treats-back').addEventListener('click', showMain);
document.getElementById('hard-things-btn').addEventListener('click', showHardThings);
document.getElementById('hard-things-back').addEventListener('click', showMain);
document.getElementById('shopping-list-back').addEventListener('click', showMain);
document.getElementById('dreams-back').addEventListener('click', showMain);
document.getElementById('dream-photo-btn').addEventListener('click', () => dreamPhotoInput.click());
dreamPhotoInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  setDreamPhotoPreview(await resizeImageForStorage(file));
  dreamPhotoInput.value = '';
});
document.getElementById('dream-photo-remove-btn').addEventListener('click', () => setDreamPhotoPreview(''));
document.getElementById('dream-save-btn').addEventListener('click', saveDream);
document.getElementById('dream-add-x-btn').addEventListener('click', () => dreamAddOverlay.classList.add('hidden'));
dreamAddOverlay.addEventListener('click', e => { if (e.target === dreamAddOverlay) dreamAddOverlay.classList.add('hidden'); });

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

// Fresh starts: each habit-day (turning over at 5 AM PT) gets one of DAWN_VARIANTS
// background moods. Wordless; consecutive days always differ.
const DAWN_VARIANTS = 8;
function habitDayNumber() {
  const shifted = new Date(Date.now() - 5 * 3600 * 1000);
  const ymd = shifted.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  return Math.floor(Date.parse(ymd + 'T00:00:00Z') / 86400000);
}
function applyDawn() {
  const variant = (habitDayNumber() * 5) % DAWN_VARIANTS;
  for (let i = 0; i < DAWN_VARIANTS; i++) document.body.classList.toggle(`dawn-${i}`, i === variant);
}
applyDawn();
document.addEventListener('visibilitychange', () => { if (!document.hidden) applyDawn(); });

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
document.getElementById('wardrobe-back').addEventListener('click', showMain);
// stopPropagation: the page's click handler closes open menus, and would close this one at once
wardrobeGlobalAddBtn.addEventListener('click', e => { e.stopPropagation(); openAddGarmentMenu(wardrobeGlobalAddBtn, null); });
document.getElementById('wardrobe-camera-btn').addEventListener('click', () => { wardrobePhotoFirstCat = undefined; wardrobePhotoInput.click(); });
wardrobePhotoInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (wardrobePhotoFirstCat !== undefined) {
    // Picked from the + menu: open a fresh form, then read the photo straight away
    openWardrobeAddModal(wardrobePhotoFirstCat);
    wardrobePhotoFirstCat = undefined;
    capturePhoto(file, { analyze: true });
  } else {
    capturePhoto(file);
  }
});
document.getElementById('wardrobe-analyze-btn').addEventListener('click', analyzePhotos);
document.getElementById('wardrobe-save-btn').addEventListener('click', saveWardrobeItem);
document.getElementById('wf-cat').addEventListener('change', e => populateSubcatOptions(e.target.value));
document.getElementById('wardrobe-add-x-btn').addEventListener('click', () => wardrobeAddOverlay.classList.add('hidden'));
wardrobeAddOverlay.addEventListener('click', e => { if (e.target === wardrobeAddOverlay) wardrobeAddOverlay.classList.add('hidden'); });

document.getElementById('suggest-outfit-btn').addEventListener('click', async () => {
  outfitRespins = 0;
  await suggestOutfit();
  updateSpinNudge(document.getElementById('outfit-spin-nudge'), outfitRespins);
});
document.getElementById('outfit-x-btn').addEventListener('click', () => outfitOverlay.classList.add('hidden'));
document.getElementById('outfit-respin-btn').addEventListener('click', async () => {
  if (outfitRequestInFlight) return;
  outfitRespins++;
  await suggestOutfit();
  updateSpinNudge(document.getElementById('outfit-spin-nudge'), outfitRespins);
});
document.getElementById('outfit-pass-btn').addEventListener('click', passOnOutfit);
document.getElementById('outfit-close-btn').addEventListener('click', () => {
  outfitOverlay.classList.add('hidden');
  recordOutfitWorn();
  // "Love it" ends the flow: clear the prompt so the box is ready for the next occasion.
  // (Closing with × keeps the text, so it can be tweaked and asked again.)
  document.getElementById('outfit-prompt-input').value = '';
  lastOutfitPrompt = '';
  setOutfitPhoto(null); // also resets shownOutfits
});
document.getElementById('shop-photo-input').addEventListener('change', e => {
  readShopPhoto([...e.target.files]);
  e.target.value = ''; // so the same photo can be picked again
});
document.getElementById('shop-photo-items').parentElement.addEventListener('click', e => {
  const btn = e.target.closest('.shop-photo-item');
  if (!btn) return;
  const line = shopLines[Number(btn.dataset.shopIndex)];
  line.chosen = !line.chosen;
  renderShopReview();
});
document.getElementById('shop-photo-add-btn').addEventListener('click', addShopLinesToErrands);
document.getElementById('shop-photo-x-btn').addEventListener('click', () => document.getElementById('shop-photo-overlay').classList.add('hidden'));
document.getElementById('outfit-photo-btn').addEventListener('click', () => document.getElementById('outfit-photo-input').click());
document.getElementById('outfit-photo-input').addEventListener('change', e => {
  attachOutfitPhoto(e.target.files[0]);
  e.target.value = ''; // so picking the same file again still fires
});
document.getElementById('outfit-photo-remove-btn').addEventListener('click', () => setOutfitPhoto(null));

const wishOverlay = document.getElementById('wish-overlay');
const wishEditOverlay = document.getElementById('wish-edit-overlay');
document.getElementById('wish-x-btn').addEventListener('click', () => wishOverlay.classList.add('hidden'));
document.getElementById('wish-done-btn').addEventListener('click', () => wishOverlay.classList.add('hidden'));
wishOverlay.addEventListener('click', (e) => { if (e.target === wishOverlay) wishOverlay.classList.add('hidden'); });
document.getElementById('wish-bought-btn').addEventListener('click', markWishBought);
document.getElementById('wish-to-wardrobe-btn').addEventListener('click', addAcquiredToWardrobe);
document.getElementById('wish-edit-btn').addEventListener('click', () => {
  wishOverlay.classList.add('hidden');
  openWishEditModal(openWishId);
});
document.getElementById('wish-edit-x-btn').addEventListener('click', () => wishEditOverlay.classList.add('hidden'));
wishEditOverlay.addEventListener('click', (e) => { if (e.target === wishEditOverlay) wishEditOverlay.classList.add('hidden'); });
document.getElementById('we-save-btn').addEventListener('click', saveWishEdit);
document.getElementById('we-move-btn').addEventListener('click', () => {
  wishEditOverlay.classList.add('hidden');
  moveShoppingItem(openWishId, 'shoppingList');
});

const garmentOverlay = document.getElementById('garment-overlay');
document.getElementById('garment-x-btn').addEventListener('click', () => garmentOverlay.classList.add('hidden'));
garmentOverlay.addEventListener('click', (e) => {
  if (e.target === garmentOverlay) garmentOverlay.classList.add('hidden');
});
document.getElementById('garment-edit-btn').addEventListener('click', (e) => {
  garmentOverlay.classList.add('hidden');
  openWardrobeEditModal(Number(e.currentTarget.dataset.id));
});
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
