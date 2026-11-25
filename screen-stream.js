'use strict';

// One stream per socket; reject unbounded capture frequencies and stale async frames.
const MIN_FPS = 0.2;
const MAX_FPS = 5;

function createScreenStream({ capture, emit, setTimer = setInterval, clearTimer = clearInterval, now = () => new Date().toISOString() }) {
  if (typeof capture !== 'function' || typeof emit !== 'function') {
    throw new TypeError('capture and emit are required');
  }

  let timer = null;
  let generation = 0;
  let inFlight = false;

  function stop() {
    generation += 1;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function start(data) {
    // Starting a new stream replaces the old one, even when the request is invalid.
    stop();
    const fps = data && typeof data === 'object' &&
      Object.prototype.hasOwnProperty.call(data, 'fps') ? data.fps : 1;

    if (typeof fps !== 'number' || !Number.isFinite(fps) || fps < MIN_FPS || fps > MAX_FPS) {
      emit('stream-error', { error: 'fps must be a finite number between 0.2 and 5' });
      return false;
    }

    const currentGeneration = generation;
    const delayMs = Math.max(200, Math.floor(1000 / fps));
    timer = setTimer(async () => {
      // Prevent overlapping captures, including across stream replacement.
      if (inFlight || currentGeneration !== generation) return;
      inFlight = true;
      try {
        const image = await capture({ format: 'jpg' });
        // A stopped/restarted socket must never receive a frame from a prior capture.
        if (currentGeneration === generation) {
          emit('screen-frame', { image: Buffer.from(image).toString('base64'), timestamp: now() });
        }
      } catch (error) {
        if (currentGeneration === generation) {
          emit('stream-error', { error: 'Screen capture failed' });
        }
      } finally {
        inFlight = false;
      }
    }, delayMs);
    return true;
  }

  return { start, stop };
}

module.exports = { createScreenStream, MIN_FPS, MAX_FPS };
