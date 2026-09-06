import assert from "node:assert/strict";
import test from "node:test";
import {
  GAME_VERSION,
  GAME_WIDTH,
  LANE_COUNT,
  MAX_VERIFIED_TICKS,
  ROAD_LEFT,
  ROAD_RIGHT,
  clampVehicleToRoad,
  createGameState,
  laneBounds,
  laneCenter,
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

test("known seed can no longer survive indefinitely on the centre divider", () => {
  const state = replayGame(1, [], MAX_VERIFIED_TICKS);
  assert.deepEqual(publicRunResult(state), {
    version: GAME_VERSION,
    tick: 280,
    score: 46,
    crashed: true,
    capped: false
  });
});

test("all road modes use exactly three authoritative lanes", () => {
  assert.equal(LANE_COUNT, 3);
  const centers = Array.from({ length: LANE_COUNT }, (_, lane) => laneCenter(lane));
  assert.equal(centers.length, 3);
  assert.deepEqual(centers, [...centers].sort((a, b) => a - b));
  assert.equal(laneBounds(0).left, ROAD_LEFT);
  assert.equal(laneBounds(2).right, ROAD_RIGHT);
  assert.throws(() => laneBounds(3), RangeError);

  const state = createGameState(42, { roadMode: "two-way" });
  assert.equal(state.roadMode, "two-way");
  for (let tick = 0; tick < 900 && !state.crashed; tick += 1) stepGame(state, tick < 180 ? -1 : 1);
  assert.notEqual(state.playerDirectionBias, 0);
  assert.ok(state.traffic.every((car) => Number.isInteger(car.lane) && car.lane >= 0 && car.lane < LANE_COUNT));
});

test("the complete player hitbox remains within legal road bounds", () => {
  const state = createGameState(7);
  for (let tick = 0; tick < 400; tick += 1) stepGame(state, -1);
  assert.ok(state.player.x >= ROAD_LEFT);
  state.crashed = false;
  state.traffic = [];
  for (let tick = 0; tick < 400; tick += 1) stepGame(state, 1);
  assert.ok(state.player.x + state.player.width <= ROAD_RIGHT);

  const vehicle = { x: GAME_WIDTH, width: 52 };
  clampVehicleToRoad(vehicle);
  assert.equal(vehicle.x + vehicle.width, ROAD_RIGHT);
});

test("divider and lane-boundary positions use geometric collision detection", () => {
  for (let lane = 1; lane < LANE_COUNT; lane += 1) {
    const divider = laneBounds(lane).left;
    const player = { x: divider - 26, y: 500, width: 52, height: 88 };
    const leftTraffic = { x: divider - 48, y: 504, width: 50, height: 84 };
    const rightTraffic = { x: divider + 8, y: 504, width: 50, height: 84 };
    assert.equal(overlaps(player, leftTraffic), true);
    assert.equal(overlaps(player, rightTraffic), true);
  }
});

test("rapid steering cannot tunnel through overlapping traffic", () => {
  const state = createGameState(19);
  state.player.x = laneCenter(0) - state.player.width / 2;
  state.traffic = [{ lane: 1, x: laneCenter(1) - 25, y: state.player.y, width: 50, height: 84, speedFactor: 0, colorIndex: 0, direction: 0 }];
  for (let tick = 0; tick < 60 && !state.crashed; tick += 1) stepGame(state, 1);
  assert.equal(state.crashed, true);
});

test("restart creates clean three-lane geometry", () => {
  const crashed = createGameState(31);
  crashed.crashed = true;
  crashed.traffic.push({ lane: 2 });
  const restarted = createGameState(32);
  assert.equal(restarted.crashed, false);
  assert.equal(restarted.score, 0);
  assert.deepEqual(restarted.traffic, []);
  assert.equal(Array.from({ length: LANE_COUNT }, (_, lane) => laneCenter(lane)).length, 3);
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
