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
let SystemParametersInfo = null;
let APPBARDATA = null;
let available = false;

// AppBar messages
const ABM_NEW = 0x00000000;
const ABM_REMOVE = 0x00000001;
const ABM_QUERYPOS = 0x00000002;
const ABM_SETPOS = 0x00000003;
// Edge
const ABE_RIGHT = 2;
// SystemParametersInfo
const SPI_GETWORKAREA = 0x0030;

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
    const user32 = koffi.load('user32.dll');
    SystemParametersInfo = user32.func(
      'bool __stdcall SystemParametersInfoW(uint32 uiAction, uint32 uiParam, _Inout_ RECT *pvParam, uint32 fWinIni)'
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
function commitPos(rcPhys) {
  // Ask Windows for an acceptable position, then commit our intended width.
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
}

function register(handleBuffer, rcPhys) {
  if (!tryInit()) return false;
  try {
    handleVal = bufToHandle(handleBuffer);
    if (!handleVal) return false;

    if (!registered) {
      SHAppBarMessage(ABM_NEW, makeData(rcPhys));
      registered = true;
    }
    commitPos(rcPhys);
    return true;
  } catch (err) {
    console.error('[appbar] register failed:', err.message);
    return false;
  }
}

function update(rcPhys) {
  if (!available || !registered) return false;
  try {
    commitPos(rcPhys);
    return true;
  } catch (err) {
    console.error('[appbar] update failed:', err.message);
    return false;
  }
}

// Read the primary monitor's work area in physical pixels, or null on failure.
function getWorkArea() {
  if (!tryInit() || !SystemParametersInfo) return null;
  try {
    const rc = { left: 0, top: 0, right: 0, bottom: 0 };
    const ok = SystemParametersInfo(SPI_GETWORKAREA, 0, rc, 0);
    return ok ? rc : null;
  } catch (err) {
    console.error('[appbar] getWorkArea failed:', err.message);
    return null;
  }
}

// Tear the AppBar down and re-create it. Needed when Windows has silently
// cleared our reserved space (full-screen app, sleep/wake, resolution change):
// a plain ABM_SETPOS with unchanged coordinates is treated as a no-op and won't
// restore the work area, but a fresh ABM_NEW + ABM_SETPOS forces a recompute.
function forceReregister(rcPhys) {
  if (!tryInit() || !handleVal) return false;
  try {
    if (registered) {
      SHAppBarMessage(ABM_REMOVE, makeData());
      registered = false;
    }
    SHAppBarMessage(ABM_NEW, makeData(rcPhys));
    registered = true;
    commitPos(rcPhys);
    return true;
  } catch (err) {
    console.error('[appbar] forceReregister failed:', err.message);
    return false;
  }
}

// Make sure the right-edge strip is actually reserved. If the live work area
// already matches what we expect, do nothing (no window churn); otherwise force
// a fresh registration so other windows get pushed back over.
function ensureReserved(rcPhys) {
  if (!available || !registered) return false;
  const wa = getWorkArea();
  if (wa) {
    const expectedGap = rcPhys.right - rcPhys.left; // strip width in px
    const currentGap = rcPhys.right - wa.right; // rcPhys.right == screen right edge
    if (Math.abs(currentGap - expectedGap) <= 2) {
      return true; // already reserved correctly
    }
  }
  return forceReregister(rcPhys);
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

module.exports = { register, update, remove, isRegistered, ensureReserved, getWorkArea };
