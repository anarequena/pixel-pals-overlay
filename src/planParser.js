'use strict';

// Parses a DailyPlan-YYYY-MM-DD.md file into structured task groups plus the
// time-blocked schedule. Markdown links are preserved as segments so the UI can
// render clickable PR / work-item links.

const EMOJI_RE = /^([\p{Extended_Pictographic}\u2600-\u27BF\uFE0F]+)\s*/u;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Strip bold/italic/code/strike markers but keep link syntax intact.
function stripMarks(t) {
  return t
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/~~/g, '');
}

function linkKind(url) {
  if (/pullrequest|\/pull\//i.test(url)) return 'pr';
  if (/_workitems|\/issues\//i.test(url)) return 'work';
  return 'link';
}

// Turn a raw markdown fragment into ordered segments (text + link) and a flat
// link list. Also returns the plain (link-flattened) text.
function tokenize(raw) {
  const segments = [];
  const links = [];
  const src = stripMarks(raw);
  let last = 0;
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(src))) {
    if (m.index > last) {
      const txt = src.slice(last, m.index);
      if (txt) segments.push({ type: 'text', value: txt });
    }
    const label = m[1].trim();
    const url = m[2].trim();
    const kind = linkKind(url);
    segments.push({ type: 'link', value: label, url, kind });
    links.push({ label, url, kind });
    last = LINK_RE.lastIndex;
  }
  if (last < src.length) {
    const txt = src.slice(last);
    if (txt) segments.push({ type: 'text', value: txt });
  }
  const plain = segments.map((s) => s.value).join('').replace(/\s+/g, ' ').trim();
  return { segments, links, plain };
}

function detectDone(rawText) {
  if (/^\s*✅/.test(rawText)) return true;
  if (/~~[^~]+~~/.test(rawText)) return true;
  return false;
}

function classifyHeading(heading) {
  const h = heading.toLowerCase();
  if (/active/.test(h)) return 'active';
  if (/top\s*5|priorit/.test(h)) return 'priorities';
  if (/do\s*now/.test(h)) return 'doNow';
  if (/do\s*later/.test(h)) return 'doLater';
  if (/defer|monitor/.test(h)) return 'defer';
  return null;
}

// ---------------- Backlog / Learning metadata parsing ----------------

const META_RE = /<!--\s*([\s\S]*?)\s*-->/;

// Parse the single metadata comment line into a key/value map. `reason:` may
// contain spaces, so it is captured to the end of the comment; all other fields
// are whitespace-delimited `key:value` tokens (value may be empty, e.g. deadline:).
function parseMeta(text) {
  const m = text.match(META_RE);
  if (!m) return null;
  let body = m[1];
  const meta = {};
  const reasonM = body.match(/\breason:(.*)$/);
  if (reasonM) {
    meta.reason = reasonM[1].trim();
    body = body.slice(0, reasonM.index);
  }
  const kv = /([\w-]+):([^\s]*)/g;
  let k;
  while ((k = kv.exec(body))) {
    meta[k[1]] = k[2];
  }
  return meta;
}

// Age in days: prefer explicit carried count, else days since first-seen.
function computeAge(meta) {
  if (meta && meta.carried != null && meta.carried !== '') {
    const n = parseInt(meta.carried, 10);
    if (!Number.isNaN(n)) return n;
  }
  if (meta && meta['first-seen']) {
    const then = new Date(meta['first-seen'] + 'T00:00:00');
    if (!Number.isNaN(then.getTime())) {
      const days = Math.floor((Date.now() - then.getTime()) / 86400000);
      return days >= 0 ? days : null;
    }
  }
  return null;
}

// Whole days until a deadline (negative = overdue); null when no/invalid deadline.
function daysUntil(deadline) {
  if (!deadline) return null;
  const d = new Date(deadline + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

// Pull the trailing numeric id out of a PR / work-item URL.
function extractIdFromUrl(url) {
  const m = String(url).match(/(\d{4,})(?!.*\d)/);
  return m ? m[1] : null;
}

// Match keys for an item, used to test it against the ignore list.
function itemKeys(item) {
  const keys = new Set();
  const meta = item.meta || {};
  if (meta.id) keys.add('id:' + meta.id);
  if (item.text) keys.add('id:' + slug(item.text));
  for (const link of item.links || []) {
    const id = extractIdFromUrl(link.url);
    if (!id) continue;
    if (link.kind === 'pr') keys.add('pr:' + id);
    else if (link.kind === 'work') keys.add('wi:' + id);
  }
  if (meta.pr) keys.add('pr:' + meta.pr);
  if (meta.wi) keys.add('wi:' + meta.wi);
  return [...keys];
}

// Given a set of ignored keys, decide whether an item should be suppressed.
function isIgnored(item, ignoredKeys) {
  if (!ignoredKeys || !ignoredKeys.size) return false;
  return itemKeys(item).some((k) => ignoredKeys.has(k));
}

// Mark lines that are inside (or are) an HTML comment block so example bullets
// documented inside `<!-- ... -->` are not mistaken for real items.
function commentMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inComment) {
      mask[i] = true;
      if (line.includes('-->')) inComment = false;
      continue;
    }
    const open = line.indexOf('<!--');
    if (open !== -1) {
      const close = line.indexOf('-->', open);
      if (close === -1) {
        inComment = true;
        mask[i] = true;
      } else if (!line.slice(0, open).trim()) {
        // whole-line comment (metadata on its own line) — never a bullet
        mask[i] = true;
      }
    }
  }
  return mask;
}

// Parse checkbox bullets whose metadata comment sits on the same line or the
// immediately following non-empty line. Returns entries with `meta` + `age`.
function parseMetaBullets(lines, from, to, source, mask) {
  const items = [];
  for (let i = from; i < to; i++) {
    if (mask && mask[i]) continue;
    const line = lines[i];
    const bullet = line.match(/^\s*(?:[-*+]|\d+\.)\s+(\[[ xX]\]\s*)?(.*)$/);
    if (!bullet || !bullet[2].trim()) continue;
    const checkboxDone = bullet[1] ? /[xX]/.test(bullet[1]) : false;

    let meta = parseMeta(line);
    let metaLine = meta ? i : null;
    if (!meta) {
      for (let j = i + 1; j < to; j++) {
        if (!lines[j].trim()) continue;
        const mm = parseMeta(lines[j]);
        if (mm) {
          meta = mm;
          metaLine = j;
        }
        break;
      }
    }

    const rawItem = bullet[2].replace(META_RE, '').trim();
    if (!rawItem) continue;
    const entry = buildEntry(source, rawItem, {
      line: i,
      metaLine,
      meta: meta || {},
      origin: source,
    });
    if (checkboxDone) entry.done = true;
    entry.status = (meta && meta.status) || (entry.done ? 'done' : 'open');
    entry.age = computeAge(meta || {});
    entry.deadlineDays = daysUntil(meta && meta.deadline);
    entry.topic = (meta && meta.topic) || null;
    if (meta && meta.id) entry.id = `${source}:${meta.id}`;
    items.push(entry);
  }
  return items;
}

// Find [start,end) line ranges for each top-level (#) section by heading test.
function sectionRange(lines, matcher) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (!h) continue;
    if (start === -1) {
      if (matcher(h[1])) start = i + 1;
    } else {
      // stop at the next same-or-higher-level heading
      return [start, i];
    }
  }
  return start === -1 ? null : [start, lines.length];
}

// Parse Backlog.md → { aging: [...open items...], ignored: { keys:Set, entries:[...] } }.
function parseBacklog(md) {
  const lines = (md || '').split(/\r?\n/);
  const mask = commentMask(lines);
  const agingRange = sectionRange(lines, (h) => /aging|backlog/i.test(h) && !/ignore/i.test(h));
  const ignoredRange = sectionRange(lines, (h) => /ignore/i.test(h));

  const aging = agingRange
    ? parseMetaBullets(lines, agingRange[0], agingRange[1], 'backlog', mask).filter(
        (it) => it.status !== 'done' && it.status !== 'parked'
      )
    : [];

  const ignoredEntries = ignoredRange
    ? parseMetaBullets(lines, ignoredRange[0], ignoredRange[1], 'ignored', mask)
    : [];
  const keys = new Set();
  for (const e of ignoredEntries) {
    for (const k of itemKeys(e)) keys.add(k);
    if (e.meta && e.meta.reason) e.reason = e.meta.reason;
  }
  return { aging, ignored: { keys, entries: ignoredEntries } };
}

// Parse LearningPlan.md → [...open learning items...].
function parseLearning(md) {
  const lines = (md || '').split(/\r?\n/);
  const mask = commentMask(lines);
  const range = sectionRange(lines, (h) => /learning|learn/i.test(h));
  const items = range
    ? parseMetaBullets(lines, range[0], range[1], 'learning', mask)
    : parseMetaBullets(lines, 0, lines.length, 'learning', mask);
  return items.filter((it) => it.status !== 'done' && it.status !== 'parked');
}

// Parse WeekPriorities.md → [...open weekly priority items...].
function parseWeek(md) {
  const lines = (md || '').split(/\r?\n/);
  const mask = commentMask(lines);
  const range = sectionRange(lines, (h) => /week|priorit/i.test(h));
  const items = range
    ? parseMetaBullets(lines, range[0], range[1], 'week', mask)
    : parseMetaBullets(lines, 0, lines.length, 'week', mask);
  return items.filter((it) => it.status !== 'done' && it.status !== 'parked');
}

// Pull a leading emoji off the plain text / first segment to use as an icon.
function splitIcon(plain, segments) {
  const m = plain.match(EMOJI_RE);
  if (!m) return { icon: null, segments };
  const icon = m[1].replace(/\uFE0F/g, '').trim();
  const segs = segments.map((s) => ({ ...s }));
  for (const s of segs) {
    if (s.type === 'text') {
      s.value = s.value.replace(EMOJI_RE, '');
      if (s.value.trim() === '') continue;
      break;
    } else break;
  }
  while (segs.length && segs[0].type === 'text' && segs[0].value.trim() === '') {
    segs.shift();
  }
  return { icon, segments: segs };
}

function buildEntry(source, rawItem, extra) {
  const done = detectDone(rawItem);
  const tok = tokenize(rawItem);
  const { icon, segments } = splitIcon(tok.plain, tok.segments);
  const text = (icon ? tok.plain.replace(EMOJI_RE, '') : tok.plain).trim();
  return Object.assign(
    {
      id: `${source}:${slug(text)}`,
      text,
      // `raw` is the exact bullet content (everything after the list marker) as
      // it appears in the .md, so it can be written back / edited losslessly.
      raw: rawItem,
      // `line` is the 0-based index of this bullet within the md lines array.
      line: null,
      icon,
      done,
      source,
      origin: 'plan',
      segments,
      links: tok.links,
    },
    extra || {}
  );
}

// ---------------- Schedule (time-blocked) parsing ----------------

function toMin(h, m, mer) {
  h = h % 12;
  if (mer === 'PM') h += 12;
  return h * 60 + m;
}

function disambiguate(h, m, mer, prev, anchor) {
  if (mer) return toMin(h, m, mer.toUpperCase());
  const am = toMin(h, m, 'AM');
  const pm = toMin(h, m, 'PM');
  if (prev < 0) {
    if (anchor) return toMin(h, m, anchor);
    return Math.min(am, pm);
  }
  const cands = [am, pm].filter((x) => x >= prev);
  if (cands.length) return Math.min(...cands);
  return Math.max(am, pm);
}

function parseSchedule(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let anchor = null;
  let inSchedule = false;

  const rowRe =
    /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:[–\-—]|to)\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i;

  let prev = -1;
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inSchedule = /time.?block|schedule/i.test(h[1]);
      if (inSchedule) {
        const mer = h[1].match(/\b(AM|PM)\b/i);
        if (mer) anchor = mer[1].toUpperCase();
      }
      continue;
    }
    if (!inSchedule) continue;
    if (/^---+\s*$/.test(line)) {
      inSchedule = false;
      continue;
    }
    const cellsMatch = line.match(/^\s*\|(.+)\|\s*$/);
    if (!cellsMatch) continue;
    const parts = cellsMatch[1].split('|').map((c) => c.trim());
    const tr = parts[0] && parts[0].match(rowRe);
    if (!tr) continue;

    const startMin = disambiguate(+tr[1], +tr[2], tr[3], prev, anchor);
    const endMin = disambiguate(+tr[4], +tr[5], tr[6], startMin, anchor);
    prev = startMin;

    const labelTok = tokenize(parts[1] || '');
    const split = splitIcon(labelTok.plain, labelTok.segments);
    const labelText = split.icon
      ? labelTok.plain.replace(EMOJI_RE, '').trim()
      : labelTok.plain;
    const notesTok = tokenize(parts[2] || '');
    blocks.push({
      id: `block:${blocks.length}:${slug(labelText)}`,
      startMin,
      endMin,
      icon: split.icon,
      text: labelText,
      segments: split.segments,
      links: labelTok.links,
      notes: notesTok.plain,
      source: 'schedule',
      origin: 'schedule',
    });
  }
  return blocks;
}

function parse(md) {
  const lines = md.split(/\r?\n/);
  const result = {
    date: null,
    priorities: [],
    active: [],
    doNow: [],
    doLater: [],
    defer: [],
    schedule: [],
  };

  const titleMatch = md.match(
    /DailyPlan-(\d{4}-\d{2}-\d{2})|—\s*([A-Za-z]+,\s*[A-Za-z]+\s*\d+,\s*\d{4})/
  );
  if (titleMatch) result.date = titleMatch[1] || titleMatch[2] || null;

  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      current = classifyHeading(headingMatch[1]);
      continue;
    }
    if (!current) continue;
    if (/^---+\s*$/.test(line)) {
      current = null;
      continue;
    }
    if (/^\s*\|/.test(line) || /^\s*>/.test(line)) continue;

    const bullet = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (bullet && bullet[1].trim()) {
      const task = buildEntry(current, bullet[1], { line: i });
      if (task.text) result[current].push(task);
    }
  }

  for (const key of ['priorities', 'active', 'doNow', 'doLater', 'defer']) {
    const seen = new Set();
    result[key] = result[key].filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }

  result.schedule = parseSchedule(md);
  return result;
}

module.exports = {
  parse,
  slug,
  tokenize,
  parseSchedule,
  classifyHeading,
  parseBacklog,
  parseLearning,
  parseWeek,
  parseMeta,
  computeAge,
  daysUntil,
  itemKeys,
  isIgnored,
  extractIdFromUrl,
};
