'use strict';

// Pomodoro engine. Cycles work -> break -> work, with a long break every 4th
// round. Drives UI via callbacks; no DOM access here.

(function () {
  function createPomodoro(config, callbacks) {
    const cb = callbacks || {};
    const state = {
      workMin: config.workMin || 25,
      breakMin: config.breakMin || 5,
      longBreakMin: config.longBreakMin || 15,
      phase: 'work',
      total: (config.workMin || 25) * 60,
      remaining: (config.workMin || 25) * 60,
      running: false,
      roundsDone: 0,
      roundInCycle: 1,
      interval: null,
    };

    function phaseDuration(phase) {
      if (phase === 'work') return state.workMin * 60;
      if (phase === 'long') return state.longBreakMin * 60;
      return state.breakMin * 60;
    }

    function emitTick() {
      if (cb.onTick) cb.onTick(state.remaining, state.total, displayPhase());
    }
    function displayPhase() {
      return state.phase === 'work' ? 'work' : 'break';
    }

    function setPhase(phase) {
      state.phase = phase;
      state.total = phaseDuration(phase);
      state.remaining = state.total;
      if (cb.onPhase) cb.onPhase(displayPhase(), state.roundsDone, state.roundInCycle);
      emitTick();
    }

    function advance() {
      if (state.phase === 'work') {
        state.roundsDone += 1;
        const longDue = state.roundInCycle % 4 === 0;
        if (cb.onChime) cb.onChime('work-done');
        setPhase(longDue ? 'long' : 'break');
      } else {
        if (state.phase !== 'long') state.roundInCycle += 1;
        else state.roundInCycle = 1;
        if (cb.onChime) cb.onChime('break-done');
        setPhase('work');
      }
    }

    function tick() {
      if (!state.running) return;
      state.remaining -= 1;
      if (state.remaining <= 0) {
        state.remaining = 0;
        emitTick();
        advance();
        return;
      }
      emitTick();
    }

    return {
      start() {
        if (state.running) return;
        state.running = true;
        if (cb.onRunning) cb.onRunning(true);
        state.interval = setInterval(tick, 1000);
        emitTick();
      },
      pause() {
        state.running = false;
        if (state.interval) clearInterval(state.interval);
        state.interval = null;
        if (cb.onRunning) cb.onRunning(false);
        emitTick();
      },
      toggle() {
        if (state.running) this.pause();
        else this.start();
      },
      reset() {
        this.pause();
        state.phase = 'work';
        state.roundInCycle = 1;
        setPhase('work');
      },
      skip() {
        advance();
      },
      setConfig(c) {
        if (typeof c.workMin === 'number') state.workMin = c.workMin;
        if (typeof c.breakMin === 'number') state.breakMin = c.breakMin;
        if (typeof c.longBreakMin === 'number') state.longBreakMin = c.longBreakMin;
        if (!state.running) {
          state.total = phaseDuration(state.phase);
          state.remaining = state.total;
          emitTick();
        }
      },
      isRunning() { return state.running; },
      getState() { return { ...state }; },
    };
  }

  window.createPomodoro = createPomodoro;
})();
