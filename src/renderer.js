'use strict';

// Renderer orchestration: tasks, schedule-driven focus, pomodoro, audio,
// the focus pal, clickable links, and click-through.

const api = window.overlay;

const GROUPS = [
  { key: 'priorities', label: 'TOP 5 (yours)', cls: 'group-priorities', primary: true },
  { key: 'active', label: 'ACTIVE', cls: 'group-active', primary: true },
  { key: 'local', label: 'MY TASKS', cls: 'group-local' },
];

const SOURCE_LABEL = {
  local: 'My task',
  doNow: 'Do Now',
  priorities: 'Top Priority',
  active: 'Active',
  doLater: 'Do Later',
  defer: 'Deferred',
};

let settings = { focus: { mode: 'auto' } };
let planData = {
  groups: {},
  local: [],
  all: [],
  schedule: [],
  counts: { total: 0, done: 0 },
};
let collapsed = {};
let pomodoro = null;
let editingFocus = false;
let dragId = null;

const el = (id) => document.getElementById(id);

// ---------------- Time helpers ----------------

function minutesNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function fmtMin(min) {
  if (min == null) return '';
  let h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const mer = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${mer}`;
}

function currentScheduleBlock() {
  const now = minutesNow();
  const blocks = planData.schedule || [];
  return blocks.find((b) => now >= b.startMin && now < b.endMin) || null;
}

function nextScheduleBlock() {
  const now = minutesNow();
  const blocks = (planData.schedule || [])
    .slice()
    .sort((a, b) => a.startMin - b.startMin);
  return blocks.find((b) => b.startMin > now) || null;
}

// ---------------- Link / segment rendering ----------------

function appendSegments(container, segments, fallbackText) {
  if (segments && segments.length) {
    for (const seg of segments) {
      if (seg.type === 'link') {
        const a = document.createElement('a');
        a.className = 'task-link kind-' + (seg.kind || 'link');
        a.textContent =
          (seg.kind === 'pr' ? '🔗 ' : seg.kind === 'work' ? '📋 ' : '') + seg.value;
        a.href = '#';
        a.title = seg.url;
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          api.openLink(seg.url);
        };
        container.appendChild(a);
      } else {
        container.appendChild(document.createTextNode(seg.value));
      }
    }
  } else {
    container.appendChild(document.createTextNode(fallbackText || ''));
  }
}

// ---------------- Focus logic ----------------

// Resolve what to show in the focus card.
// Returns { kind:'task'|'schedule'|'custom', id?, icon, segments, text,
//           sublabel, startMin?, endMin? } or null.
function computeFocus() {
  const focus = settings.focus || { mode: 'auto' };
  const all = planData.all || [];

  if (focus.mode === 'custom' && focus.text) {
    return {
      kind: 'custom',
      icon: '✏️',
      segments: [{ type: 'text', value: focus.text }],
      text: focus.text,
      sublabel: 'Custom focus',
    };
  }

  if (focus.mode === 'task' && focus.taskId) {
    const t = all.find((x) => x.id === focus.taskId && !x.done);
    if (t) {
      return {
        kind: 'task',
        id: t.id,
        icon: t.icon,
        segments: t.segments,
        text: t.text,
        sublabel: 'Pinned · ' + (SOURCE_LABEL[t.source] || 'task'),
      };
    }
    // fall through to auto if the pinned task is gone/done
  }

  // Auto: current schedule block wins.
  const block = currentScheduleBlock();
  if (block) {
    return {
      kind: 'schedule',
      id: block.id,
      icon: block.icon,
      segments: block.segments,
      text: block.text,
      sublabel: `${fmtMin(block.startMin)} – ${fmtMin(block.endMin)}`,
      notes: block.notes,
    };
  }

  // Else first incomplete actionable task.
  const order = ['priorities', 'active', 'local'];
  for (const key of order) {
    const list = key === 'local' ? planData.local : planData.groups[key] || [];
    const hit = (list || []).find((t) => !t.done);
    if (hit) {
      return {
        kind: 'task',
        id: hit.id,
        icon: hit.icon,
        segments: hit.segments,
        text: hit.text,
        sublabel: SOURCE_LABEL[hit.source] || '',
      };
    }
  }
  return null;
}

function renderFocus() {
  if (editingFocus) return;
  const focus = computeFocus();
  const textEl = el('focus-text');
  const metaEl = el('focus-meta');
  const nextEl = el('focus-next');
  const doneBtn = el('focus-done');
  const autoBtn = el('focus-auto');
  const mode = (settings.focus && settings.focus.mode) || 'auto';

  autoBtn.style.display = mode === 'auto' ? 'none' : '';

  textEl.innerHTML = '';

  if (!focus) {
    window.FocusPal.setActive(false);
    window.FocusPal.pickFor('done');
    textEl.textContent = 'All clear — nice work! 🎉';
    metaEl.textContent = '';
    nextEl.textContent = '';
    doneBtn.style.display = 'none';
    window._focusId = null;
    return;
  }

  window.FocusPal.setActive(true);
  window.FocusPal.pickFor(focus.text);

  if (focus.icon) {
    const ic = document.createElement('span');
    ic.className = 'task-icon';
    ic.textContent = focus.icon;
    textEl.appendChild(ic);
  }
  appendSegments(textEl, focus.segments, focus.text);

  metaEl.textContent = focus.sublabel || '';

  // "Next up" hint from the schedule.
  const next = nextScheduleBlock();
  if (next && (focus.kind === 'schedule' || mode === 'auto')) {
    nextEl.textContent = `Next: ${fmtMin(next.startMin)} · ${next.text}`;
  } else {
    nextEl.textContent = '';
  }

  // Mark-done only makes sense for real tasks.
  if (focus.kind === 'task' && focus.id) {
    doneBtn.style.display = '';
    doneBtn.onclick = async () => {
      planData = await api.toggleTask(focus.id);
      rerender();
    };
  } else {
    doneBtn.style.display = 'none';
  }

  window._focusId = focus.id || null;
}

function startFocusEdit() {
  editingFocus = true;
  const textEl = el('focus-text');
  const current =
    settings.focus && settings.focus.mode === 'custom' ? settings.focus.text : '';
  textEl.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'focus-edit-input';
  input.placeholder = 'What are you actually working on?';
  input.value = current;
  textEl.appendChild(input);
  input.focus();
  input.select();

  const commit = async () => {
    const v = input.value.trim();
    editingFocus = false;
    if (v) settings = await api.setFocusMode({ mode: 'custom', text: v });
    rerender();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      editingFocus = false;
      rerender();
    }
  });
  input.addEventListener('blur', commit);
}

// ---------------- Task list ----------------

function taskRow(task, focusId) {
  const row = document.createElement('div');
  row.className =
    'task-item' + (task.done ? ' done' : '') + (task.id === focusId ? ' is-focus' : '');
  row.dataset.id = task.id;

  // Plan tasks can be dragged between sections (Do Now / Priorities / Later /
  // Defer); the move is written straight back into the .md. Drags started from a
  // button, link, or the inline-edit input are ignored so those keep working.
  if (task.origin === 'plan') {
    row.draggable = true;
    row.classList.add('draggable');
    row.addEventListener('dragstart', (e) => {
      if (e.target.closest('button, a, input')) {
        e.preventDefault();
        return;
      }
      dragId = task.id;
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', task.id);
      } catch {}
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      dragId = null;
      row.classList.remove('dragging');
      document
        .querySelectorAll('.drop-target')
        .forEach((n) => n.classList.remove('drop-target'));
    });
  }

  const check = document.createElement('button');
  check.className = 'task-check' + (task.done ? ' checked' : '');
  check.textContent = task.done ? '✓' : '';
  check.title = 'Toggle done';
  check.onclick = async () => {
    planData = await api.toggleTask(task.id);
    rerender();
  };

  const body = document.createElement('div');
  body.className = 'task-body';
  const text = document.createElement('div');
  text.className = 'task-text';
  if (task.icon) {
    const ic = document.createElement('span');
    ic.className = 'task-icon';
    ic.textContent = task.icon;
    text.appendChild(ic);
  }
  appendSegments(text, task.segments, task.text);
  body.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const focusBtn = document.createElement('button');
  focusBtn.className = 'mini-btn focus-set';
  focusBtn.textContent = '★';
  focusBtn.title = 'Pin as current focus';
  focusBtn.onclick = async () => {
    settings = await api.setFocusMode({ mode: 'task', taskId: task.id });
    rerender();
  };
  actions.appendChild(focusBtn);

  if (task.origin === 'local' || task.origin === 'plan') {
    const editBtn = document.createElement('button');
    editBtn.className = 'mini-btn';
    editBtn.textContent = '✎';
    editBtn.title = task.origin === 'plan' ? 'Edit (markdown — links allowed)' : 'Edit';
    editBtn.onclick = () => startInlineEdit(task, text);
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-btn';
    delBtn.textContent = '🗑';
    delBtn.title = task.origin === 'plan' ? 'Delete from plan' : 'Delete';
    delBtn.onclick = async () => {
      planData = await api.removeTask(task.id);
      rerender();
    };
    actions.appendChild(delBtn);
  }

  row.appendChild(check);
  row.appendChild(body);
  row.appendChild(actions);
  return row;
}

function startInlineEdit(task, textEl) {
  const input = document.createElement('input');
  input.type = 'text';
  // Plan tasks edit their raw markdown so embedded PR / work-item links survive
  // the round-trip; local tasks just edit their plain text.
  input.value = task.origin === 'plan' ? task.raw || task.text : task.text;
  input.className = 'inline-edit';
  input.style.cssText =
    'width:100%;background:rgba(0,0,0,0.3);border:1px solid var(--accent);border-radius:8px;color:var(--ink);font-size:12.5px;padding:4px 6px;font-family:inherit;outline:none;';
  textEl.replaceWith(input);
  input.focus();
  input.select();
  const save = async () => {
    const v = input.value.trim();
    if (v) planData = await api.editTask(task.id, v);
    rerender();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') rerender();
  });
  input.addEventListener('blur', save);
}

// Resolve which task a drop should land above (returns its id), or null to
// append at the end of the section, based on the cursor's vertical position.
function dropBeforeId(groupEl, y) {
  const rows = Array.from(groupEl.querySelectorAll('.task-item'));
  for (const r of rows) {
    const rect = r.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return r.dataset.id;
  }
  return null;
}

function renderTasks() {
  const focusId = window._focusId;
  const container = el('task-groups');
  container.innerHTML = '';

  let anything = false;
  const hasPlan = !!planData.planFile;
  for (const g of GROUPS) {
    const list = g.key === 'local' ? planData.local : planData.groups[g.key] || [];
    const isPlanGroup = g.key !== 'local';
    // Keep only the primary sections (Top 5 / Active) visible when empty so a
    // dragged task can always be dropped into them. Legacy Do-Now/Later/Defer
    // sections and local tasks only appear when they actually hold something.
    const keepEmpty = g.primary && hasPlan;
    if ((!list || list.length === 0) && !keepEmpty) continue;
    anything = true;

    const group = document.createElement('div');
    group.className = 'task-group ' + g.cls;

    // Plan sections accept drops so tasks can be dragged in to reorganize them.
    if (isPlanGroup) {
      group.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        group.classList.add('drop-target');
      });
      group.addEventListener('dragleave', (e) => {
        if (!group.contains(e.relatedTarget)) group.classList.remove('drop-target');
      });
      group.addEventListener('drop', async (e) => {
        if (!dragId) return;
        e.preventDefault();
        group.classList.remove('drop-target');
        const id = dragId;
        dragId = null;
        let beforeId = dropBeforeId(group, e.clientY);
        if (beforeId === id) beforeId = null;
        planData = await api.moveTask(id, g.key, beforeId);
        rerender();
      });
    }

    const head = document.createElement('div');
    head.className = 'group-head';
    const isCollapsed = !!collapsed[g.key];
    const remaining = list.filter((t) => !t.done).length;
    head.innerHTML =
      `<span>${isCollapsed ? '▸' : '▾'} ${g.label}</span><span class="chip">${remaining}/${list.length}</span>`;
    head.onclick = () => {
      collapsed[g.key] = !collapsed[g.key];
      renderTasks();
    };
    group.appendChild(head);

    if (!isCollapsed) {
      if (list.length) {
        for (const task of list) group.appendChild(taskRow(task, focusId));
      } else {
        const ph = document.createElement('div');
        ph.className = 'drop-empty';
        ph.textContent = 'Drop a task here';
        group.appendChild(ph);
      }
    }
    container.appendChild(group);
  }

  if (!anything) {
    container.innerHTML =
      '<div class="empty-msg">No tasks yet.<br/>Add one below or generate today\'s plan with <b>planday</b>. 🐾</div>';
  }

  const c = planData.counts || { total: 0, done: 0 };
  el('task-progress').textContent = `${c.done} / ${c.total} done`;
}

// ---------------- Timeline ----------------

// Render the time-blocked schedule as a compact list. The block covering the
// current time is marked NOW; the first future block is NEXT; past blocks dim.
// This is the auto-focus driver — the focus card follows whatever is NOW unless
// the user has pinned a custom/task focus (✎ / ★), which stays respected.
function renderTimeline() {
  const listEl = el('timeline-list');
  const chip = el('timeline-chip');
  if (!listEl) return;
  listEl.innerHTML = '';

  const blocks = (planData.schedule || [])
    .slice()
    .sort((a, b) => a.startMin - b.startMin);

  if (!blocks.length) {
    listEl.innerHTML = '<div class="timeline-empty">No schedule in today\'s plan.</div>';
    if (chip) chip.textContent = '';
    return;
  }

  const now = minutesNow();
  const nowBlock = blocks.find((b) => now >= b.startMin && now < b.endMin) || null;
  const nextBlock = blocks.find((b) => b.startMin > now) || null;
  if (chip) chip.textContent = nowBlock ? 'now ' + fmtMin(nowBlock.startMin) : '';

  for (const b of blocks) {
    const row = document.createElement('div');
    let state = 'upcoming';
    if (b === nowBlock) state = 'now';
    else if (b.endMin <= now) state = 'past';
    else if (b === nextBlock) state = 'next';
    row.className = 'tl-row tl-' + state;

    const time = document.createElement('span');
    time.className = 'tl-time';
    const startEl = document.createElement('span');
    startEl.className = 'tl-start';
    startEl.textContent = fmtMin(b.startMin);
    const endEl = document.createElement('span');
    endEl.className = 'tl-end';
    endEl.textContent = fmtMin(b.endMin);
    time.appendChild(startEl);
    time.appendChild(endEl);

    const label = document.createElement('span');
    label.className = 'tl-label';
    if (b.icon) {
      const ic = document.createElement('span');
      ic.className = 'task-icon';
      ic.textContent = b.icon;
      label.appendChild(ic);
    }
    appendSegments(label, b.segments, b.text);

    row.appendChild(time);
    row.appendChild(label);
    listEl.appendChild(row);
  }
}

// ---------------- Backlog panel ----------------

// Format an aging badge from an item's age (consecutive carried days).
function agingBadge(item) {
  if (item.source === 'learning') {
    return { text: '📘', cls: 'badge-learn', title: 'Learning item' };
  }
  const d = item.age != null ? item.age : item.meta && +item.meta.carried;
  const n = Number.isFinite(d) ? d : 0;
  let cls = 'badge-age';
  if (n >= 7) cls += ' badge-hot';
  else if (n >= 4) cls += ' badge-warm';
  return { text: `⏳${n}d`, cls, title: `Aging ${n} day${n === 1 ? '' : 's'}` };
}

function backlogRow(item) {
  const row = document.createElement('div');
  row.className = 'backlog-item';
  row.dataset.id = item.id;

  const badge = agingBadge(item);
  const b = document.createElement('span');
  b.className = 'backlog-badge ' + badge.cls;
  b.textContent = badge.text;
  b.title = badge.title;
  row.appendChild(b);

  const body = document.createElement('div');
  body.className = 'backlog-body';
  const text = document.createElement('div');
  text.className = 'backlog-text';
  if (item.icon) {
    const ic = document.createElement('span');
    ic.className = 'task-icon';
    ic.textContent = item.icon;
    text.appendChild(ic);
  }
  appendSegments(text, item.segments, item.text);
  body.appendChild(text);

  // Deadline hint when close.
  if (item.deadlineDays != null && item.deadlineDays <= 7) {
    const dl = document.createElement('div');
    dl.className = 'backlog-deadline' + (item.deadlineDays <= 3 ? ' urgent' : '');
    dl.textContent =
      item.deadlineDays < 0
        ? `overdue ${-item.deadlineDays}d`
        : item.deadlineDays === 0
          ? 'due today'
          : `due in ${item.deadlineDays}d`;
    body.appendChild(dl);
  }
  row.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'backlog-actions';

  const promote = document.createElement('button');
  promote.className = 'mini-btn backlog-promote';
  promote.textContent = '↑';
  promote.title = 'Promote into today (Active)';
  promote.onclick = async () => {
    planData = await api.promoteBacklog(item.id, 'active');
    rerender();
  };

  const done = document.createElement('button');
  done.className = 'mini-btn';
  done.textContent = '✓';
  done.title = 'Mark done';
  done.onclick = async () => {
    planData = await api.markBacklogDone(item.id);
    rerender();
  };

  const ignore = document.createElement('button');
  ignore.className = 'mini-btn backlog-ignore';
  ignore.textContent = '🚫';
  ignore.title = 'Ignore (suppress everywhere)';
  ignore.onclick = async () => {
    planData = await api.ignoreBacklog(item.id, 'ignored from overlay');
    rerender();
  };

  actions.appendChild(promote);
  actions.appendChild(done);
  actions.appendChild(ignore);
  row.appendChild(actions);
  return row;
}

function renderBacklog() {
  const listEl = el('backlog-list');
  const chip = el('backlog-chip');
  if (!listEl) return;
  listEl.innerHTML = '';

  // Aging items first (oldest first), then learning items.
  const aging = (planData.backlog || [])
    .slice()
    .sort((a, b) => (b.age || 0) - (a.age || 0));
  const learning = planData.learning || [];
  const total = aging.length + learning.length;
  if (chip) chip.textContent = String(total);

  if (!total) {
    listEl.innerHTML =
      '<div class="backlog-empty">Backlog clear — nothing aging. 🌱</div>';
    return;
  }

  for (const item of aging) listEl.appendChild(backlogRow(item));
  for (const item of learning) listEl.appendChild(backlogRow(item));
}

// ---------------- Week priorities (read-only) ----------------

function weekRow(item) {
  const row = document.createElement('div');
  row.className = 'week-item';
  if (item.id) row.dataset.id = item.id;

  const text = document.createElement('div');
  text.className = 'week-text';
  const ic = document.createElement('span');
  ic.className = 'week-icon';
  ic.textContent = item.icon || '•';
  text.appendChild(ic);
  appendSegments(text, item.segments, item.text);
  row.appendChild(text);

  // Deadline hint when close.
  if (item.deadlineDays != null && item.deadlineDays <= 7) {
    const dl = document.createElement('div');
    dl.className = 'week-deadline' + (item.deadlineDays <= 3 ? ' urgent' : '');
    dl.textContent =
      item.deadlineDays < 0
        ? `overdue ${-item.deadlineDays}d`
        : item.deadlineDays === 0
          ? 'due today'
          : `due in ${item.deadlineDays}d`;
    row.appendChild(dl);
  }
  return row;
}

function renderWeek() {
  const listEl = el('week-list');
  const chip = el('week-chip');
  const section = el('week');
  if (!listEl) return;
  listEl.innerHTML = '';

  const week = planData.week || [];
  if (chip) chip.textContent = String(week.length);

  // Hide the whole panel when there are no weekly priorities to show.
  if (section) section.style.display = week.length ? '' : 'none';
  if (!week.length) return;

  for (const item of week) listEl.appendChild(weekRow(item));
}

// ---------------- Plan / date ----------------

function renderDate() {
  const d = planData.date;
  el('plan-date').textContent = d ? `Plan · ${d}` : 'No plan file found';
}

function rerender() {
  renderDate();
  renderFocus();
  renderTimeline();
  renderTasks();
  renderWeek();
  renderBacklog();
}

// ---------------- Pomodoro UI ----------------

const RING_LEN = 2 * Math.PI * 52;

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setupPomodoro() {
  pomodoro = window.createPomodoro(
    {
      workMin: settings.workMin,
      breakMin: settings.breakMin,
      longBreakMin: settings.longBreakMin,
    },
    {
      onTick(remaining, total) {
        el('pomo-time').textContent = fmt(remaining);
        const ring = el('ring-fg');
        const frac = total > 0 ? remaining / total : 0;
        ring.style.strokeDashoffset = String(RING_LEN * (1 - frac));
      },
      onPhase(phase, roundsDone, roundInCycle) {
        const phaseEl = el('pomo-phase');
        const ring = el('ring-fg');
        phaseEl.textContent = phase === 'work' ? 'WORK' : 'BREAK';
        phaseEl.classList.toggle('break', phase !== 'work');
        ring.classList.toggle('break', phase !== 'work');
        el('pomo-count').textContent = `Round ${roundInCycle} · ${roundsDone} done`;
        updateMood();
      },
      onRunning(running) {
        const btn = el('pomo-start');
        btn.textContent = running ? 'Pause' : 'Start';
        btn.classList.toggle('running', running);
        updateMood();
      },
      onChime(type) {
        chime(type);
        notify(type);
        updateMood();
      },
    }
  );

  el('pomo-start').onclick = () => pomodoro.toggle();
  el('pomo-reset').onclick = () => pomodoro.reset();
  el('pomo-skip').onclick = () => pomodoro.skip();
}

function updateMood() {
  if (!pomodoro) return;
  const st = pomodoro.getState();
  let mood = 'idle';
  if (st.running) mood = st.phase === 'work' ? 'work' : 'break';
  window.FocusPal.setMood(mood);
}

function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const notes = [660, 880, 990];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.45);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}

function notify(type) {
  try {
    const title = type === 'work-done' ? '🌿 Break time!' : '💪 Back to focus!';
    const body =
      type === 'work-done'
        ? 'Work session complete. Stretch and breathe.'
        : 'Break over — your pixel pal is ready to work!';
    new Notification(title, { body, silent: true });
  } catch {}
}

// ---------------- Music UI ----------------

const YT_PRESETS = [
  { id: 'jfKfPfyJRdk', name: 'Lofi Girl — beats to relax/study to' },
  { id: '4xDzrJKXOOY', name: 'Lofi Girl — beats to sleep/chill to' },
  { id: 'rUxyKA_-grg', name: 'Chillhop — jazzy & lofi hip hop beats' },
];

function setupMusic() {
  window.LofiAudio.onState((s) => {
    el('music-toggle').textContent = s.playing ? '⏸ Lofi' : '▶ Lofi';
    el('music-now').textContent = s.name + (s.count > 1 ? ` (${s.count} tracks)` : '');
  });
  window.LofiAudio.init(settings.volume);

  // Register preset + saved YouTube stations so ⏭ Next cycles through them too.
  YT_PRESETS.forEach((p) => window.LofiAudio.registerYouTube(p.id, p.name));
  (settings.ytStations || []).forEach((st) => window.LofiAudio.registerYouTube(st.id, st.name));
  renderYtPresets();

  el('music-toggle').onclick = () => window.LofiAudio.toggle();
  el('music-next').onclick = () => window.LofiAudio.next();
  const vol = el('music-vol');
  vol.value = settings.volume;
  vol.oninput = () => {
    window.LofiAudio.setVolume(parseFloat(vol.value));
    api.setSettings({ volume: parseFloat(vol.value) });
  };

  el('yt-add').onclick = addYtFromInput;
  el('yt-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addYtFromInput();
  });
}

function renderYtPresets() {
  const wrap = el('yt-presets');
  if (!wrap) return;
  wrap.innerHTML = '';
  const stations = [
    ...YT_PRESETS,
    ...(settings.ytStations || []).filter(
      (st) => !YT_PRESETS.some((p) => p.id === st.id)
    ),
  ];
  stations.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'yt-chip';
    b.textContent = p.name.split('—')[0].trim();
    b.title = `Play: ${p.name}`;
    b.onclick = () => window.LofiAudio.playYouTube(p.id, p.name);
    wrap.appendChild(b);
  });
}

function addYtFromInput() {
  const inp = el('yt-url');
  const v = inp.value.trim();
  if (!v) return;
  const res = window.LofiAudio.playYouTube(v);
  if (!res) {
    inp.classList.add('bad');
    inp.value = '';
    inp.placeholder = 'Not a valid YouTube link…';
    setTimeout(() => {
      inp.classList.remove('bad');
      inp.placeholder = 'Paste a YouTube lofi link…';
    }, 1600);
    return;
  }
  inp.value = '';
  const stations = (settings.ytStations || []).slice();
  if (!stations.some((st) => st.id === res.id)) {
    stations.push({ id: res.id, name: res.name });
    settings.ytStations = stations;
    api.setSettings({ ytStations: stations });
    renderYtPresets();
  }
}

// ---------------- Click-through ----------------

function setupClickThrough() {
  const btn = el('btn-clickthrough');
  function reflect() {
    btn.classList.toggle('active', !!settings.clickThrough);
    btn.title = settings.clickThrough
      ? 'Click-through ON (Ctrl+Alt+P)'
      : 'Click-through OFF (Ctrl+Alt+P)';
    if (settings.clickThrough) api.setMouseIgnore(true);
    else api.setMouseIgnore(false);
  }
  btn.onclick = async () => {
    settings = await api.setSettings({ clickThrough: !settings.clickThrough });
    reflect();
  };

  let over = false;
  window.addEventListener('mousemove', (e) => {
    if (!settings.clickThrough) return;
    const elem = document.elementFromPoint(e.clientX, e.clientY);
    const interactive = elem && elem.closest('.interactive');
    if (!!interactive !== over) {
      over = !!interactive;
      api.setMouseIgnore(!over);
    }
  });

  reflect();
  window._reflectClickThrough = reflect;
}

// ---------------- Boot ----------------

async function boot() {
  settings = await api.getSettings();
  planData = await api.getPlan();

  if (window.Starfield) window.Starfield.init(el('starfield'));
  window.FocusPal.init(el('focus-pal'));

  setupPomodoro();
  setupMusic();
  setupClickThrough();

  el('btn-hide').onclick = () => api.hideOverlay();
  el('btn-reload').onclick = async () => {
    const btn = el('btn-reload');
    btn.classList.add('spin');
    btn.disabled = true;
    try {
      planData = await api.reloadPlan();
      rerender();
    } finally {
      setTimeout(() => {
        btn.classList.remove('spin');
        btn.disabled = false;
      }, 600);
    }
  };
  el('focus-edit').onclick = () => startFocusEdit();
  el('focus-auto').onclick = async () => {
    settings = await api.setFocusMode({ mode: 'auto' });
    rerender();
  };

  const input = el('task-input');
  const add = async () => {
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    planData = await api.addTask(v);
    rerender();
  };
  el('task-add').onclick = add;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add();
  });

  api.onPlanUpdate((data) => {
    planData = data;
    rerender();
  });
  api.onSettingsUpdate((s) => {
    settings = { ...settings, ...s };
    if (window._reflectClickThrough) window._reflectClickThrough();
    rerender();
  });

  // Re-evaluate the schedule-driven focus periodically while in auto mode.
  setInterval(() => {
    const mode = (settings.focus && settings.focus.mode) || 'auto';
    renderTimeline();
    if (mode === 'auto' && !editingFocus) {
      renderFocus();
      renderTasks();
    }
  }, 30000);

  rerender();
  updateMood();
}

boot();
