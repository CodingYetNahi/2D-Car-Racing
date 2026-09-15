export const GAME_VERSION = "3.4.0";
export const TICK_RATE = 60;
export const TICK_SECONDS = 1 / TICK_RATE;
export const MAX_VERIFIED_TICKS = TICK_RATE * 60 * 10;

export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 720;
export const ROAD_LEFT = 52;
export const ROAD_RIGHT = GAME_WIDTH - 52;
export const LANE_COUNT = 3;

const PLAYER_WIDTH = 52;
const PLAYER_HEIGHT = 88;
const PLAYER_SPEED_PER_TICK = 310 / TICK_RATE;
const TRAFFIC_WIDTH = 50;
const TRAFFIC_HEIGHT = 84;
const TRAFFIC_ROUTE_GAP = 24;
const TRAFFIC_LANE_CHANGE_SPEED = 1.15;
const TRAFFIC_LANE_CHANGE_CHANCE = 0.35;
const DIVIDER_TRAFFIC_CHANCE = 0.24;
const DIVIDER_MIN_GAP = 190;
const UINT32_RANGE = 0x1_0000_0000;

export const TRAFFIC_COLORS = Object.freeze(["#ffc857", "#3dd6d0", "#a78bfa", "#ff7b72", "#f8f9fa"]);

function normalizeSeed(seed) { const normalized = Number(seed) >>> 0; return normalized || 0x6d2b79f5; }
function nextRandom(state) { let value = state.rngState >>> 0; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; state.rngState = value >>> 0; return state.rngState / UINT32_RANGE; }

export function laneBounds(lane) {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_COUNT) throw new RangeError("Invalid lane");
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  return { left: ROAD_LEFT + lane * laneWidth, right: ROAD_LEFT + (lane + 1) * laneWidth };
}
export function laneCenter(lane) { const bounds = laneBounds(lane); return (bounds.left + bounds.right) / 2; }
export function clampVehicleToRoad(vehicle) { vehicle.x = Math.max(ROAD_LEFT, Math.min(vehicle.x, ROAD_RIGHT - vehicle.width)); return vehicle; }
function trafficX(lane, carWidth) { const bounds = laneBounds(lane); return (bounds.left + bounds.right - carWidth) / 2; }
function dividerX(divider, carWidth) { const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT; return ROAD_LEFT + laneWidth * divider - carWidth / 2; }

function occupiedLanes(vehicle) {
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  const leftLane = Math.max(0, Math.min(LANE_COUNT - 1, Math.floor((vehicle.x - ROAD_LEFT + 1) / laneWidth)));
  const rightLane = Math.max(0, Math.min(LANE_COUNT - 1, Math.floor((vehicle.x + vehicle.width - ROAD_LEFT - 1) / laneWidth)));
  const lanes = new Set();
  for (let lane = leftLane; lane <= rightLane; lane += 1) lanes.add(lane);
  return lanes;
}

function wouldBlockRoad(state, candidate, ignoredCar = null) {
  const occupied = new Set(occupiedLanes(candidate));
  const safeVerticalGap = candidate.height + state.player.height + TRAFFIC_ROUTE_GAP;
  for (const car of state.traffic) {
    if (car === ignoredCar || Math.abs(car.y - candidate.y) >= safeVerticalGap) continue;
    for (const lane of occupiedLanes(car)) occupied.add(lane);
  }
  return occupied.size === LANE_COUNT;
}

function dividerPlacementIsClear(state, divider) {
  const x = dividerX(divider, TRAFFIC_WIDTH);
  const probe = { x, y: -TRAFFIC_HEIGHT - 10, width: TRAFFIC_WIDTH, height: TRAFFIC_HEIGHT };
  const probeLanes = occupiedLanes(probe);
  return state.traffic.every((car) => {
    if (Math.abs(car.y - probe.y) >= DIVIDER_MIN_GAP) return true;
    return [...occupiedLanes(car)].every((lane) => !probeLanes.has(lane));
  });
}

function spawnTraffic(state) {
  const availableLanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane).filter((lane) =>
    state.traffic.every((car) => !occupiedLanes(car).has(lane) || car.y > 170)
  );
  if (availableLanes.length === 0) return;

  let lane = availableLanes[0];
  for (let offset = 0; offset < LANE_COUNT; offset += 1) {
    const candidateLane = (state.spawnLaneCursor + offset) % LANE_COUNT;
    if (availableLanes.includes(candidateLane)) { lane = candidateLane; break; }
  }
  state.spawnLaneCursor = (lane + 1) % LANE_COUNT;

  // A minority of traffic deliberately straddles a divider. This models the
  // risky space a real vehicle occupies while overtaking/merging and removes
  // the artificial safe corridor without punishing the player for using it.
  // Never spawn divider traffic twice in a row, and only use a divider when
  // both neighbouring lanes have enough vertical clearance.
  let divider = 0;
  if (!state.lastSpawnWasDivider && nextRandom(state) < DIVIDER_TRAFFIC_CHANCE) {
    const candidates = [1, 2].filter((value) => dividerPlacementIsClear(state, value));
    if (candidates.length) divider = candidates[Math.floor(nextRandom(state) * candidates.length)];
  }

  const isDividerCar = divider > 0;
  const candidate = {
    lane,
    divider,
    x: isDividerCar ? dividerX(divider, TRAFFIC_WIDTH) : trafficX(lane, TRAFFIC_WIDTH),
    y: -TRAFFIC_HEIGHT - 10,
    width: TRAFFIC_WIDTH,
    height: TRAFFIC_HEIGHT,
    speedFactor: 0.88 + nextRandom(state) * 0.24,
    colorIndex: Math.floor(nextRandom(state) * TRAFFIC_COLORS.length),
    laneChangeDirection: isDividerCar ? 0 : (nextRandom(state) < TRAFFIC_LANE_CHANGE_CHANCE ? (lane === 0 ? 1 : lane === LANE_COUNT - 1 ? -1 : nextRandom(state) < 0.5 ? -1 : 1) : 0),
    laneChangeY: 70 + nextRandom(state) * 300,
    laneChangeAttempted: isDividerCar
  };

  if (!wouldBlockRoad(state, candidate)) {
    state.traffic.push(candidate);
    state.lastSpawnWasDivider = isDividerCar;
  }
}

export function overlaps(a, b) {
  const paddingX = 3, paddingY = 4;
  return a.x + paddingX < b.x + b.width - paddingX && a.x + a.width - paddingX > b.x + paddingX && a.y + paddingY < b.y + b.height - paddingY && a.y + a.height - paddingY > b.y + paddingY;
}

export function createGameState(seed) {
  const normalizedSeed = normalizeSeed(seed);
  return { version: GAME_VERSION, seed: normalizedSeed, rngState: normalizedSeed, tick: 0, score: 0, crashed: false, capped: false, roadOffset: 0, spawnProgress: 0, worldSpeed: 245, spawnLaneCursor: normalizedSeed % LANE_COUNT, traffic: [], lastSpawnWasDivider: false, player: { x: (GAME_WIDTH - PLAYER_WIDTH) / 2, y: GAME_HEIGHT - 126, width: PLAYER_WIDTH, height: PLAYER_HEIGHT, color: "#ff3d4f" } };
}

export function stepGame(state, direction = 0) {
  if (state.crashed || state.capped) return state;
  const safeDirection = direction === -1 || direction === 1 ? direction : 0;
  state.player.x += safeDirection * PLAYER_SPEED_PER_TICK;
  clampVehicleToRoad(state.player);

  state.tick += 1;
  const elapsedSeconds = state.tick / TICK_RATE;
  state.worldSpeed = Math.min(470, 245 + elapsedSeconds * 5.2);
  const spawnIntervalSeconds = Math.max(0.58, 1.25 - elapsedSeconds * 0.009);
  state.spawnProgress += TICK_SECONDS;
  state.roadOffset = (state.roadOffset + state.worldSpeed * TICK_SECONDS) % 100;
  if (state.spawnProgress >= spawnIntervalSeconds) { state.spawnProgress -= spawnIntervalSeconds; spawnTraffic(state); }

  for (const car of state.traffic) {
    const canStartLaneChange = !car.laneChangeAttempted && car.laneChangeDirection !== 0 && car.y >= car.laneChangeY;
    if (canStartLaneChange) {
      const targetLane = car.lane + car.laneChangeDirection;
      if (targetLane >= 0 && targetLane < LANE_COUNT) {
        const candidate = { ...car, lane: targetLane, divider: 0, x: trafficX(targetLane, car.width) };
        const laneIsClear = !state.traffic.some((other) => other !== car && occupiedLanes(other).has(targetLane) && Math.abs(other.y - car.y) < 125);
        if (laneIsClear && !wouldBlockRoad(state, candidate, car)) car.lane = targetLane;
      }
      car.laneChangeAttempted = true;
    }

    if (!car.divider) {
      const bounds = laneBounds(car.lane);
      const targetX = (bounds.left + bounds.right - car.width) / 2;
      car.x += Math.max(-TRAFFIC_LANE_CHANGE_SPEED, Math.min(TRAFFIC_LANE_CHANGE_SPEED, targetX - car.x));
    }
    car.y += state.worldSpeed * car.speedFactor * TICK_SECONDS;
    if (overlaps(state.player, car)) { state.crashed = true; break; }
  }

  state.traffic = state.traffic.filter((car) => car.y < GAME_HEIGHT + car.height);
  state.score = Math.floor(elapsedSeconds * 10);
  if (state.tick >= MAX_VERIFIED_TICKS && !state.crashed) state.capped = true;
  return state;
}

export function validateReplayEvents(events, endTick) {
  if (!Number.isInteger(endTick) || endTick < 1 || endTick > MAX_VERIFIED_TICKS) return { valid: false, error: "Invalid replay length" };
  if (!Array.isArray(events) || events.length > 5000) return { valid: false, error: "Invalid replay events" };
  let previousTick = -1;
  for (const event of events) { if (!event || typeof event !== "object" || Array.isArray(event)) return { valid: false, error: "Invalid replay event" }; if (!Number.isInteger(event.tick) || event.tick < 0 || event.tick >= endTick || event.tick <= previousTick) return { valid: false, error: "Replay events are out of order" }; if (![-1, 0, 1].includes(event.direction)) return { valid: false, error: "Invalid replay direction" }; previousTick = event.tick; }
  return { valid: true };
}

export function replayGame(seed, events, endTick) {
  const validation = validateReplayEvents(events, endTick); if (!validation.valid) throw new Error(validation.error);
  const state = createGameState(seed); let eventIndex = 0, direction = 0;
  while (state.tick < endTick && !state.crashed && !state.capped) { while (eventIndex < events.length && events[eventIndex].tick === state.tick) { direction = events[eventIndex].direction; eventIndex += 1; } stepGame(state, direction); }
  return state;
}

export function publicRunResult(state) { return Object.freeze({ version: state.version, tick: state.tick, score: state.score, crashed: state.crashed, capped: state.capped }); }
