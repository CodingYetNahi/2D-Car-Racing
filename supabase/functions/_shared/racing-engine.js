export const GAME_VERSION = "3.1.0";
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
const TRAFFIC_LANE_CHANGE_SPEED = 1.5;
const TRAFFIC_LANE_CHANGE_LEAD = 230;
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

export function laneBounds(lane) {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_COUNT) throw new RangeError("Invalid lane");
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  return {
    left: ROAD_LEFT + lane * laneWidth,
    right: ROAD_LEFT + (lane + 1) * laneWidth
  };
}

export function laneCenter(lane) {
  const bounds = laneBounds(lane);
  return (bounds.left + bounds.right) / 2;
}

export function vehicleLane(vehicle) {
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  const center = Math.max(ROAD_LEFT, Math.min(ROAD_RIGHT - Number.EPSILON, vehicle.x + vehicle.width / 2));
  return Math.max(0, Math.min(LANE_COUNT - 1, Math.floor((center - ROAD_LEFT) / laneWidth)));
}

export function clampVehicleToRoad(vehicle) {
  vehicle.x = Math.max(ROAD_LEFT, Math.min(vehicle.x, ROAD_RIGHT - vehicle.width));
  return vehicle;
}

function trafficX(state, lane, carWidth) {
  const bounds = laneBounds(lane);
  const minX = Math.max(ROAD_LEFT, bounds.left + TRAFFIC_LANE_INSET);
  const maxX = Math.min(ROAD_RIGHT - carWidth, bounds.right - carWidth - TRAFFIC_LANE_INSET);
  return minX + nextRandom(state) * (maxX - minX);
}

function wouldBlockRoad(state, candidate, ignoredCar = null) {
  const nearbyLanes = new Set([candidate.lane]);
  const safeVerticalGap = candidate.height + state.player.height + TRAFFIC_ROUTE_GAP;
  for (const car of state.traffic) {
    if (car === ignoredCar) continue;
    if (Math.abs(car.y - candidate.y) < safeVerticalGap) nearbyLanes.add(car.lane);
  }
  return nearbyLanes.size === LANE_COUNT;
}

function spawnTraffic(state) {
  const availableLanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane).filter((lane) =>
    state.traffic.every((car) => car.lane !== lane || car.y > 170)
  );
  if (availableLanes.length === 0) return;

  let lane = availableLanes[0];
  for (let offset = 0; offset < LANE_COUNT; offset += 1) {
    const candidateLane = (state.spawnLaneCursor + offset) % LANE_COUNT;
    if (availableLanes.includes(candidateLane)) {
      lane = candidateLane;
      break;
    }
  }
  state.spawnLaneCursor = (lane + 1) % LANE_COUNT;
  const candidate = {
    lane,
    x: trafficX(state, lane, TRAFFIC_WIDTH),
    y: -TRAFFIC_HEIGHT - 10,
    width: TRAFFIC_WIDTH,
    height: TRAFFIC_HEIGHT,
    speedFactor: 0.88 + nextRandom(state) * 0.24,
    colorIndex: Math.floor(nextRandom(state) * TRAFFIC_COLORS.length),
    laneChangeReadyTick: state.tick + 45 + Math.floor(nextRandom(state) * 31)
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
  const normalizedSeed = normalizeSeed(seed);
  return {
    version: GAME_VERSION,
    seed: normalizedSeed,
    rngState: normalizedSeed,
    tick: 0,
    score: 0,
    crashed: false,
    capped: false,
    roadOffset: 0,
    spawnProgress: 0,
    worldSpeed: 245,
    spawnLaneCursor: normalizedSeed % LANE_COUNT,
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
  clampVehicleToRoad(state.player);

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
    const canStartLaneChange = state.tick >= (car.laneChangeReadyTick || 0) &&
      car.y >= state.player.y - TRAFFIC_LANE_CHANGE_LEAD &&
      car.y < state.player.y - car.height;
    if (canStartLaneChange) {
      const playerLane = vehicleLane(state.player);
      let targetLane = car.lane + Math.sign(playerLane - car.lane);
      if (targetLane === car.lane) {
        const playerCenter = state.player.x + state.player.width / 2;
        const changeDirection = playerCenter < laneCenter(car.lane) ? -1 : 1;
        targetLane = car.lane + changeDirection;
        if (targetLane < 0 || targetLane >= LANE_COUNT) targetLane = car.lane - changeDirection;
      }
      const candidate = { ...car, lane: targetLane };
      const laneIsClear = !state.traffic.some((other) =>
        other !== car && other.lane === targetLane && Math.abs(other.y - car.y) < 125
      );
      if (targetLane >= 0 && targetLane < LANE_COUNT && laneIsClear && !wouldBlockRoad(state, candidate, car)) {
        car.lane = targetLane;
      }
      car.laneChangeReadyTick = state.tick + 120 + Math.floor(nextRandom(state) * 61);
    }
    const bounds = laneBounds(car.lane);
    const targetX = (bounds.left + bounds.right - car.width) / 2;
    car.x += Math.max(-TRAFFIC_LANE_CHANGE_SPEED, Math.min(TRAFFIC_LANE_CHANGE_SPEED, targetX - car.x));
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
