'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let storePath = null;
let store = { completed: {}, local: [], order: {} };
let lastParsed = { date: null, priorities: [], active: [], doNow: [], doLater: [], defer: [], schedule: [] };
let lastFile = null;
let cache = new Map(); // id -> effective task

function init(userDataDir) {
  storePath = path.join(userDataDir, 'tasks.json');
  load();
}

function load() {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    store = {
      completed: parsed.completed || {},
      local: Array.isArray(parsed.local) ? parsed.local : [],
      order: parsed.order || {},
    };
  } catch {
    store = { completed: {}, local: [], order: {} };
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist tasks:', err);
  }
}

// Local ("My tasks") only — plan tasks are toggled in the .md by the main
// process via planWriter, not here.
function toggleComplete(id) {
  const idx = store.local.findIndex((t) => t.id === id);
  if (idx >= 0) {
    store.local[idx].done = !store.local[idx].done;
    persist();
  }
  return remerge();
}

function merge(parsed, file) {
  if (parsed) lastParsed = parsed;
  if (file !== undefined) lastFile = file;

  const parsedGroups = { priorities: [], active: [], doNow: [], doLater: [], defer: [] };
  cache = new Map();

  for (const key of Object.keys(parsedGroups)) {
    for (const t of lastParsed[key] || []) {
      // Plan tasks are backed by the .md file, which is the source of truth for
      // their done-state, so trust the parsed value directly.
      const task = { ...t, done: !!t.done };
      parsedGroups[key].push(task);
      cache.set(task.id, task);
    }
  }

  // New layout: Timeline -> Top 5 -> Active -> Backlog. The legacy Do-Now /
  // Do-Later / Defer-Monitor sections are folded into Active so older plans that
  // still use those headings don't lose their tasks; new plans only emit Top 5 +
  // Active. Each task keeps its own `source`, so its badge still reads correctly.
  const groups = {
    priorities: parsedGroups.priorities,
    active: [
      ...parsedGroups.active,
      ...parsedGroups.doNow,
      ...parsedGroups.doLater,
      ...parsedGroups.defer,
    ],
  };

  const local = store.local.map((t) => {
    const task = { ...t, done: !!t.done, origin: 'local', source: 'local' };
    cache.set(task.id, task);
    return task;
  });

  const all = [
    ...local,
    ...groups.priorities,
    ...groups.active,
  ];

  return {
    date: lastParsed.date,
    planFile: lastFile,
    groups,
    local,
    all,
    schedule: lastParsed.schedule || [],
    counts: {
      total: all.length,
      done: all.filter((t) => t.done).length,
    },
  };
}

function remerge() {
  return merge(lastParsed, lastFile);
}

function addLocal(title) {
  const text = String(title || '').trim();
  if (text) {
    store.local.unshift({
      id: 'local:' + crypto.randomUUID(),
      text,
      done: false,
      origin: 'local',
      source: 'local',
      icon: '✏️',
    });
    persist();
  }
  return remerge();
}

function editLocal(id, title) {
  const idx = store.local.findIndex((t) => t.id === id);
  if (idx >= 0) {
    store.local[idx].text = String(title || '').trim() || store.local[idx].text;
    persist();
  }
  return remerge();
}

function removeLocal(id) {
  const before = store.local.length;
  store.local = store.local.filter((t) => t.id !== id);
  if (store.local.length !== before) persist();
  // also clear any completion override for plan tasks
  if (Object.prototype.hasOwnProperty.call(store.completed, id)) {
    delete store.completed[id];
    persist();
  }
  return remerge();
}

module.exports = {
  init,
  merge,
  toggleComplete,
  addLocal,
  editLocal,
  removeLocal,
};
