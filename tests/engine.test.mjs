import assert from "node:assert/strict";
import test from "node:test";
import {
  GAME_VERSION,
  MAX_VERIFIED_TICKS,
  createGameState,
  overlaps,
  publicRunResult,
  replayGame,
  stepGame,
  validateReplayEvents
} from "../supabase/functions/_shared/racing-engine.js";

function runTicks(seed, directions) {
  const state = createGameState(seed);
  for (const direction of directions) {
    if (state.crashed || state.capped) break;
    stepGame(state, direction);
  }
  return state;
}

test("the same seed and inputs always produce the same run", () => {
  const directions = Array.from({ length: 900 }, (_, tick) => tick < 120 ? -1 : tick < 360 ? 1 : 0);
  const first = runTicks(0x12345678, directions);
  const second = runTicks(0x12345678, directions);
  assert.deepEqual(first, second);
  assert.equal(first.version, GAME_VERSION);
});

test("replay events reproduce the browser simulation", () => {
  const events = [
    { tick: 0, direction: -1 },
    { tick: 45, direction: 0 },
    { tick: 100, direction: 1 },
    { tick: 160, direction: 0 }
  ];
  const endTick = 240;
  const manualDirections = Array.from({ length: endTick }, (_, tick) => {
    if (tick < 45) return -1;
    if (tick < 100) return 0;
    if (tick < 160) return 1;
    return 0;
  });
  const browserState = runTicks(987654321, manualDirections);
  const verifiedState = replayGame(987654321, events, endTick);
  assert.deepEqual(publicRunResult(verifiedState), publicRunResult(browserState));
  assert.deepEqual(verifiedState.traffic, browserState.traffic);
});

test("known seed produces a stable verified crash", () => {
  const state = replayGame(1, [], 299);
  assert.deepEqual(publicRunResult(state), {
    version: GAME_VERSION,
    tick: 299,
    score: 49,
    crashed: true,
    capped: false
  });
});

test("replay validation rejects oversized, unordered and impossible input", () => {
  assert.equal(validateReplayEvents([], 0).valid, false);
  assert.equal(validateReplayEvents([], MAX_VERIFIED_TICKS + 1).valid, false);
  assert.equal(validateReplayEvents([{ tick: 8, direction: 1 }, { tick: 7, direction: 0 }], 10).valid, false);
  assert.equal(validateReplayEvents([{ tick: 1, direction: 2 }], 10).valid, false);
  assert.equal(validateReplayEvents(Array.from({ length: 5001 }, (_, tick) => ({ tick, direction: 0 })), 5001).valid, false);
});

test("collision geometry remains independent of rendering", () => {
  assert.equal(overlaps({ x: 100, y: 100, width: 50, height: 80 }, { x: 110, y: 110, width: 50, height: 80 }), true);
  assert.equal(overlaps({ x: 100, y: 100, width: 50, height: 80 }, { x: 300, y: 300, width: 50, height: 80 }), false);
});
