export const GAME_VERSION = "2.0.0";
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
const TRAFFIC_LANE_INSET = 8;
const TRAFFIC_ROUTE_GAP = 24;
const UINT32_RANGE = 0x1_0000_0000;

export const TRAFFIC_COLORS = Object.freeze(["#ffc857", "#3dd6d0", "#a78bfa", "#ff7b72", "#f8f9fa"]);

function normalizeSeed(seed) {
  const normalized = Number(seed) >>> 0;
  return normalized || 0x6d2b79f5;
}

function nextRandom(state) {
  let value = state.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / UINT32_RANGE;
}

function laneBounds(lane) {
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  return {
    left: ROAD_LEFT + lane * laneWidth,
    right: ROAD_LEFT + (lane + 1) * laneWidth
  };
}

function trafficX(state, lane, carWidth) {
  const bounds = laneBounds(lane);
  const minX = Math.max(ROAD_LEFT, bounds.left + TRAFFIC_LANE_INSET);
  const maxX = Math.min(ROAD_RIGHT - carWidth, bounds.right - carWidth - TRAFFIC_LANE_INSET);
  return minX + nextRandom(state) * (maxX - minX);
}

function wouldBlockRoad(state, candidate) {
  const nearbyLanes = new Set([candidate.lane]);
  const safeVerticalGap = candidate.height + state.player.height + TRAFFIC_ROUTE_GAP;
  for (const car of state.traffic) {
    if (Math.abs(car.y - candidate.y) < safeVerticalGap) nearbyLanes.add(car.lane);
  }
  return nearbyLanes.size === LANE_COUNT;
}

function spawnTraffic(state) {
  const availableLanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane).filter((lane) =>
    state.traffic.every((car) => car.lane !== lane || car.y > 170)
  );
  if (availableLanes.length === 0) return;

  const lane = availableLanes[Math.floor(nextRandom(state) * availableLanes.length)];
  const candidate = {
    lane,
    x: trafficX(state, lane, TRAFFIC_WIDTH),
    y: -TRAFFIC_HEIGHT - 10,
    width: TRAFFIC_WIDTH,
    height: TRAFFIC_HEIGHT,
    speedFactor: 0.88 + nextRandom(state) * 0.24,
    colorIndex: Math.floor(nextRandom(state) * TRAFFIC_COLORS.length)
  };

  if (!wouldBlockRoad(state, candidate)) state.traffic.push(candidate);
}

export function overlaps(a, b) {
  const paddingX = 3;
  const paddingY = 4;
  return a.x + paddingX < b.x + b.width - paddingX &&
    a.x + a.width - paddingX > b.x + paddingX &&
    a.y + paddingY < b.y + b.height - paddingY &&
    a.y + a.height - paddingY > b.y + paddingY;
}

export function createGameState(seed) {
  return {
    version: GAME_VERSION,
    seed: normalizeSeed(seed),
    rngState: normalizeSeed(seed),
    tick: 0,
    score: 0,
    crashed: false,
    capped: false,
    roadOffset: 0,
    spawnProgress: 0,
    worldSpeed: 245,
    traffic: [],
    player: {
      x: (GAME_WIDTH - PLAYER_WIDTH) / 2,
      y: GAME_HEIGHT - 126,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      color: "#ff3d4f"
    }
  };
}

export function stepGame(state, direction = 0) {
  if (state.crashed || state.capped) return state;
  const safeDirection = direction === -1 || direction === 1 ? direction : 0;

  state.player.x += safeDirection * PLAYER_SPEED_PER_TICK;
  state.player.x = Math.max(ROAD_LEFT + 8, Math.min(state.player.x, ROAD_RIGHT - state.player.width - 8));

  state.tick += 1;
  const elapsedSeconds = state.tick / TICK_RATE;
  state.worldSpeed = Math.min(470, 245 + elapsedSeconds * 5.2);
  const spawnIntervalSeconds = Math.max(0.58, 1.25 - elapsedSeconds * 0.009);
  state.spawnProgress += TICK_SECONDS;
  state.roadOffset = (state.roadOffset + state.worldSpeed * TICK_SECONDS) % 100;

  if (state.spawnProgress >= spawnIntervalSeconds) {
    state.spawnProgress -= spawnIntervalSeconds;
    spawnTraffic(state);
  }

  for (const car of state.traffic) {
    car.y += state.worldSpeed * car.speedFactor * TICK_SECONDS;
    if (overlaps(state.player, car)) {
      state.crashed = true;
      break;
    }
  }

  state.traffic = state.traffic.filter((car) => car.y < GAME_HEIGHT + car.height);
  state.score = Math.floor(elapsedSeconds * 10);
  if (state.tick >= MAX_VERIFIED_TICKS && !state.crashed) state.capped = true;
  return state;
}

export function validateReplayEvents(events, endTick) {
  if (!Number.isInteger(endTick) || endTick < 1 || endTick > MAX_VERIFIED_TICKS) {
    return { valid: false, error: "Invalid replay length" };
  }
  if (!Array.isArray(events) || events.length > 5000) {
    return { valid: false, error: "Invalid replay events" };
  }

  let previousTick = -1;
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return { valid: false, error: "Invalid replay event" };
    if (!Number.isInteger(event.tick) || event.tick < 0 || event.tick > endTick || event.tick < previousTick) {
      return { valid: false, error: "Replay events are out of order" };
    }
    if (![ -1, 0, 1 ].includes(event.direction)) return { valid: false, error: "Invalid replay direction" };
    previousTick = event.tick;
  }
  return { valid: true };
}

export function replayGame(seed, events, endTick) {
  const validation = validateReplayEvents(events, endTick);
  if (!validation.valid) throw new Error(validation.error);

  const state = createGameState(seed);
  let eventIndex = 0;
  let direction = 0;

  while (state.tick < endTick && !state.crashed && !state.capped) {
    while (eventIndex < events.length && events[eventIndex].tick === state.tick) {
      direction = events[eventIndex].direction;
      eventIndex += 1;
    }
    stepGame(state, direction);
  }

  return state;
}

export function publicRunResult(state) {
  return Object.freeze({
    version: state.version,
    tick: state.tick,
    score: state.score,
    crashed: state.crashed,
    capped: state.capped
  });
}
