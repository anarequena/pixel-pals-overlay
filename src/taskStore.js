'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let storePath = null;
let store = { completed: {}, local: [], order: {} };
let lastParsed = { date: null, priorities: [], doNow: [], doLater: [], defer: [], schedule: [] };
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

  const groups = { priorities: [], doNow: [], doLater: [], defer: [] };
  cache = new Map();

  for (const key of Object.keys(groups)) {
    for (const t of lastParsed[key] || []) {
      // Plan tasks are backed by the .md file, which is the source of truth for
      // their done-state, so trust the parsed value directly.
      const task = { ...t, done: !!t.done };
      groups[key].push(task);
      cache.set(task.id, task);
    }
  }

  const local = store.local.map((t) => {
    const task = { ...t, done: !!t.done, origin: 'local', source: 'local' };
    cache.set(task.id, task);
    return task;
  });

  const all = [
    ...local,
    ...groups.doNow,
    ...groups.priorities,
    ...groups.doLater,
    ...groups.defer,
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
