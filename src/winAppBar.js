'use strict';

// Registers the overlay as a Windows AppBar so the OS reserves screen space on
// the right edge. Maximized / snapped windows then stop at the overlay's edge
// instead of being covered by it (the same mechanism the taskbar uses).
//
// Uses koffi to call the Win32 SHAppBarMessage API. All calls are guarded; if
// anything fails (non-Windows, missing dll, etc.) the module degrades to a
// no-op and the overlay simply floats on top as before.

let koffi = null;
let SHAppBarMessage = null;
let APPBARDATA = null;
let available = false;

// AppBar messages
const ABM_NEW = 0x00000000;
const ABM_REMOVE = 0x00000001;
const ABM_QUERYPOS = 0x00000002;
const ABM_SETPOS = 0x00000003;
// Edge
const ABE_RIGHT = 2;

let registered = false;
let handleVal = null;

function tryInit() {
  if (koffi) return available;
  if (process.platform !== 'win32') {
    available = false;
    return false;
  }
  try {
    koffi = require('koffi');
    koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long',
    });
    APPBARDATA = koffi.struct('APPBARDATA', {
      cbSize: 'uint32',
      hWnd: 'uintptr_t',
      uCallbackMessage: 'uint32',
      uEdge: 'uint32',
      rc: 'RECT',
      lParam: 'intptr_t',
    });
    const shell32 = koffi.load('shell32.dll');
    SHAppBarMessage = shell32.func(
      'uintptr_t __stdcall SHAppBarMessage(uint32 dwMessage, _Inout_ APPBARDATA *pData)'
    );
    available = true;
  } catch (err) {
    console.error('[appbar] init failed:', err.message);
    available = false;
  }
  return available;
}

function bufToHandle(buf) {
  if (!buf || !buf.length) return 0n;
  if (buf.length >= 8) return buf.readBigUInt64LE(0);
  return BigInt(buf.readUInt32LE(0));
}

function makeData(rc) {
  return {
    cbSize: koffi.sizeof(APPBARDATA),
    hWnd: handleVal,
    uCallbackMessage: 0,
    uEdge: ABE_RIGHT,
    rc: rc || { left: 0, top: 0, right: 0, bottom: 0 },
    lParam: 0n,
  };
}

// rcPhys: { left, top, right, bottom } in PHYSICAL screen pixels.
function register(handleBuffer, rcPhys) {
  if (!tryInit()) return false;
  try {
    handleVal = bufToHandle(handleBuffer);
    if (!handleVal) return false;

    if (!registered) {
      SHAppBarMessage(ABM_NEW, makeData(rcPhys));
      registered = true;
    }
    // Ask Windows for an acceptable position, then commit our width.
    const data = makeData(rcPhys);
    SHAppBarMessage(ABM_QUERYPOS, data);
    // Preserve our intended left/width; keep top/bottom Windows may have nudged.
    data.uEdge = ABE_RIGHT;
    data.rc = {
      left: rcPhys.left,
      top: data.rc.top || rcPhys.top,
      right: rcPhys.right,
      bottom: data.rc.bottom || rcPhys.bottom,
    };
    SHAppBarMessage(ABM_SETPOS, data);
    return true;
  } catch (err) {
    console.error('[appbar] register failed:', err.message);
    return false;
  }
}

function update(rcPhys) {
  if (!available || !registered) return false;
  try {
    const data = makeData(rcPhys);
    SHAppBarMessage(ABM_QUERYPOS, data);
    data.uEdge = ABE_RIGHT;
    data.rc = {
      left: rcPhys.left,
      top: data.rc.top || rcPhys.top,
      right: rcPhys.right,
      bottom: data.rc.bottom || rcPhys.bottom,
    };
    SHAppBarMessage(ABM_SETPOS, data);
    return true;
  } catch (err) {
    console.error('[appbar] update failed:', err.message);
    return false;
  }
}

function remove() {
  if (!available || !registered) return;
  try {
    SHAppBarMessage(ABM_REMOVE, makeData());
  } catch (err) {
    console.error('[appbar] remove failed:', err.message);
  } finally {
    registered = false;
  }
}

function isRegistered() {
  return registered;
}

module.exports = { register, update, remove, isRegistered };
