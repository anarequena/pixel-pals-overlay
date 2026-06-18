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
  if (/top\s*5|priorit/.test(h)) return 'priorities';
  if (/do\s*now/.test(h)) return 'doNow';
  if (/do\s*later/.test(h)) return 'doLater';
  if (/defer|monitor/.test(h)) return 'defer';
  return null;
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
  for (const line of lines) {
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
      const task = buildEntry(current, bullet[1]);
      if (task.text) result[current].push(task);
    }
  }

  for (const key of ['priorities', 'doNow', 'doLater', 'defer']) {
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

module.exports = { parse, slug, tokenize, parseSchedule };
