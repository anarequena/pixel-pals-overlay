'use strict';

// Writes task edits back to a DailyPlan-YYYY-MM-DD.md file. Operations work on
// the bullet/numbered list items that planParser collects (Top 5 Priorities,
// Do Now, Do Later, Defer). The original line endings (usually CRLF on Windows
// / OneDrive) are preserved and writes are atomic (temp file + rename) so a
// crash mid-write can't corrupt the user's real plan.

const fs = require('fs');

// Captures: 1=indent, 2=marker (-/*/+ or "N."), 3=gap after marker, 4=content.
const BULLET_RE = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/;
const HEADING_RE = /^#{1,6}\s+(.*)$/;
const RULE_RE = /^---+\s*$/;
const DONE_RE = /^✅\s*/;

const SECTION_LABEL = {
  priorities: "🎯 Today's Top 5 Priorities",
  doNow: '🟢 Do Now',
  doLater: '🟡 Do Later Today',
  defer: '⏳ Defer / Monitor',
};

function readFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /\r?\n$/.test(text);
  return { lines: text.split(/\r?\n/), eol, trailingNewline };
}

function writeFile(file, lines, eol, trailingNewline) {
  let data = lines.join(eol);
  // split() on a trailing newline yields a final '' element which join restores,
  // so only add an extra eol if the original ended with one and we lost it.
  if (trailingNewline && !/\r?\n$/.test(data) && lines[lines.length - 1] !== '') {
    data += eol;
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function bulletContent(line) {
  const m = line.match(BULLET_RE);
  return m ? m[4] : null;
}

function isOrdered(line) {
  return /^\s*\d+\.\s+/.test(line);
}

// Resolve the array index of a bullet, trusting the parser's line hint when the
// content still matches, otherwise falling back to a content scan (the file may
// have shifted if it was edited externally between parse and write).
function locate(lines, lineHint, expectedRaw) {
  if (
    Number.isInteger(lineHint) &&
    lineHint >= 0 &&
    lineHint < lines.length &&
    bulletContent(lines[lineHint]) === expectedRaw
  ) {
    return lineHint;
  }
  for (let i = 0; i < lines.length; i++) {
    if (bulletContent(lines[i]) === expectedRaw) return i;
  }
  return -1;
}

function isDone(content) {
  return DONE_RE.test(content) || /^~~[\s\S]*~~$/.test(content);
}

function stripDone(content) {
  let c = content.replace(DONE_RE, '');
  const sm = c.match(/^~~([\s\S]*)~~$/);
  if (sm) c = sm[1];
  return c;
}

// Renumber the contiguous ordered-list block that contains `anchor` so a
// numbered list stays 1..n after an insert/delete.
function renumberOrdered(lines, anchor) {
  if (anchor < 0 || anchor >= lines.length || !isOrdered(lines[anchor])) {
    if (anchor - 1 >= 0 && isOrdered(lines[anchor - 1])) anchor -= 1;
    else return;
  }
  let start = anchor;
  while (start - 1 >= 0 && isOrdered(lines[start - 1])) start--;
  let end = anchor;
  while (end + 1 < lines.length && isOrdered(lines[end + 1])) end++;
  let n = 1;
  for (let i = start; i <= end; i++) {
    lines[i] = lines[i].replace(
      /^(\s*)\d+\.(\s+)/,
      (_m, sp, gap) => `${sp}${n}.${gap}`
    );
    n++;
  }
}

function setDone(file, lineHint, expectedRaw, done) {
  const { lines, eol, trailingNewline } = readFile(file);
  const idx = locate(lines, lineHint, expectedRaw);
  if (idx < 0) return false;
  const m = lines[idx].match(BULLET_RE);
  if (!m) return false;
  const prefix = m[1] + m[2] + m[3];
  let content = m[4];
  const currentlyDone = isDone(content);
  if (done && !currentlyDone) content = '✅ ' + content;
  else if (!done && currentlyDone) content = stripDone(content);
  else return true;
  lines[idx] = prefix + content;
  writeFile(file, lines, eol, trailingNewline);
  return true;
}

function editBullet(file, lineHint, expectedRaw, newRaw) {
  const text = String(newRaw == null ? '' : newRaw).trim();
  if (!text) return false;
  const { lines, eol, trailingNewline } = readFile(file);
  const idx = locate(lines, lineHint, expectedRaw);
  if (idx < 0) return false;
  const m = lines[idx].match(BULLET_RE);
  if (!m) return false;
  lines[idx] = m[1] + m[2] + m[3] + text;
  writeFile(file, lines, eol, trailingNewline);
  return true;
}

function removeBullet(file, lineHint, expectedRaw) {
  const { lines, eol, trailingNewline } = readFile(file);
  const idx = locate(lines, lineHint, expectedRaw);
  if (idx < 0) return false;
  const wasOrdered = isOrdered(lines[idx]);
  lines.splice(idx, 1);
  if (wasOrdered) renumberOrdered(lines, idx);
  writeFile(file, lines, eol, trailingNewline);
  return true;
}

// Insert a new bullet at the end of the section whose heading classifies to
// `groupKey`. Creates the section at EOF if it doesn't exist. Uses the same
// bullet marker style already present in the section; never appends a "- " item
// into a numbered list (it would break numbering), so ordered sections reuse the
// ordered marker and get renumbered.
function addBullet(file, groupKey, newRaw, classify) {
  const text = String(newRaw == null ? '' : newRaw).trim();
  if (!text) return false;
  const { lines, eol, trailingNewline } = readFile(file);

  let headIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING_RE);
    if (h && classify(h[1]) === groupKey) {
      headIdx = i;
      break;
    }
  }

  if (headIdx < 0) {
    const label = SECTION_LABEL[groupKey] || SECTION_LABEL.doNow;
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('## ' + label);
    lines.push('- ' + text);
    writeFile(file, lines, eol, trailingNewline);
    return true;
  }

  // Find the end of this section (next heading or horizontal rule, else EOF).
  let end = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]) || RULE_RE.test(lines[i])) {
      end = i;
      break;
    }
  }

  // Append after the last existing list item in the section.
  let insertAt = headIdx + 1;
  let marker = '- ';
  let ordered = false;
  for (let i = headIdx + 1; i < end; i++) {
    const bm = lines[i].match(BULLET_RE);
    if (bm) {
      insertAt = i + 1;
      marker = bm[2] + bm[3];
      ordered = /^\d+\.$/.test(bm[2]);
    }
  }

  lines.splice(insertAt, 0, marker + text);
  if (ordered) renumberOrdered(lines, insertAt);
  writeFile(file, lines, eol, trailingNewline);
  return true;
}

module.exports = { setDone, editBullet, removeBullet, addBullet, SECTION_LABEL };
