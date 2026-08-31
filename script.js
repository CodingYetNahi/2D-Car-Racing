"use strict";

const canvas = document.getElementById("gameCanvas");

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("The game canvas could not be found.");
}

const ctx = canvas.getContext("2d");

if (!ctx) {
  throw new Error("This browser does not support the 2D canvas API.");
}

const scoreElement = document.getElementById("score");
const bestScoreElement = document.getElementById("bestScore");
const finalScoreElement = document.getElementById("finalScore");
const gameOverElement = document.getElementById("gameOver");
const restartButton = document.getElementById("restartButton");
const leftButton = document.getElementById("moveLeft");
const rightButton = document.getElementById("moveRight");

const GAME_WIDTH = canvas.width;
const GAME_HEIGHT = canvas.height;
const ROAD_LEFT = 52;
const ROAD_RIGHT = GAME_WIDTH - 52;
const LANE_COUNT = 3;
const TRAFFIC_COLORS = ["#ffc857", "#3dd6d0", "#a78bfa", "#ff7b72", "#f8f9fa"];
const keysPressed = {
  left: false,
  right: false
};

const player = {
  x: 0,
  y: GAME_HEIGHT - 126,
  width: 52,
  height: 88,
  speed: 310,
  color: "#ff3d4f"
};

let traffic = [];
let roadOffset = 0;
let elapsedTime = 0;
let score = 0;
let bestScore = readBestScore();
let spawnTimer = 0;
let spawnInterval = 1.25;
let worldSpeed = 245;
let running = false;
let lastTime = 0;
let animationFrameId = 0;

function readBestScore() {
  try {
    const storedScore = Number.parseInt(localStorage.getItem("racingBestScore") || "0", 10);
    return Number.isFinite(storedScore) && storedScore > 0 ? storedScore : 0;
  } catch {
    return 0;
  }
}

function saveBestScore() {
  try {
    localStorage.setItem("racingBestScore", String(bestScore));
  } catch {
    // The game remains playable when storage is disabled or unavailable.
  }
}

function setScoreText(element, value) {
  if (element) {
    element.textContent = String(value);
  }
}

function resetGame() {
  cancelAnimationFrame(animationFrameId);
  traffic = [];
  roadOffset = 0;
  elapsedTime = 0;
  score = 0;
  spawnTimer = 0;
  spawnInterval = 1.25;
  worldSpeed = 245;
  player.x = (GAME_WIDTH - player.width) / 2;
  keysPressed.left = false;
  keysPressed.right = false;
  leftButton?.classList.remove("is-pressed");
  rightButton?.classList.remove("is-pressed");
  setScoreText(scoreElement, 0);
  setScoreText(bestScoreElement, bestScore);
  if (gameOverElement) gameOverElement.hidden = true;
  running = true;
  lastTime = performance.now();
  animationFrameId = requestAnimationFrame(gameLoop);
}

function laneX(lane, carWidth) {
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  return ROAD_LEFT + lane * laneWidth + (laneWidth - carWidth) / 2;
}

function spawnTraffic() {
  const availableLanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane).filter((lane) =>
    traffic.every((car) => car.lane !== lane || car.y > 170)
  );

  if (availableLanes.length === 0) return;

  const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
  const width = 50;
  const height = 84;
  traffic.push({
    lane,
    x: laneX(lane, width),
    y: -height - 10,
    width,
    height,
    speedFactor: 0.88 + Math.random() * 0.24,
    color: TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)]
  });
}

function overlaps(a, b) {
  const paddingX = 7;
  const paddingY = 6;
  return a.x + paddingX < b.x + b.width - paddingX &&
    a.x + a.width - paddingX > b.x + paddingX &&
    a.y + paddingY < b.y + b.height - paddingY &&
    a.y + a.height - paddingY > b.y + paddingY;
}

function update(deltaTime) {
  const direction = Number(keysPressed.right) - Number(keysPressed.left);
  player.x += direction * player.speed * deltaTime;
  player.x = Math.max(ROAD_LEFT + 8, Math.min(player.x, ROAD_RIGHT - player.width - 8));

  elapsedTime += deltaTime;
  worldSpeed = Math.min(470, 245 + elapsedTime * 5.2);
  spawnInterval = Math.max(0.58, 1.25 - elapsedTime * 0.009);
  roadOffset = (roadOffset + worldSpeed * deltaTime) % 100;
  spawnTimer += deltaTime;

  if (spawnTimer >= spawnInterval) {
    spawnTimer -= spawnInterval;
    spawnTraffic();
  }

  for (const car of traffic) {
    car.y += worldSpeed * car.speedFactor * deltaTime;
    if (overlaps(player, car)) {
      endGame();
      return;
    }
  }

  traffic = traffic.filter((car) => car.y < GAME_HEIGHT + car.height);
  score = Math.floor(elapsedTime * 10);
  setScoreText(scoreElement, score);
}

function drawRoad() {
  ctx.fillStyle = "#176b37";
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  ctx.fillStyle = "#272b2e";
  ctx.fillRect(ROAD_LEFT, 0, ROAD_RIGHT - ROAD_LEFT, GAME_HEIGHT);

  ctx.fillStyle = "#e9eef0";
  ctx.fillRect(ROAD_LEFT, 0, 5, GAME_HEIGHT);
  ctx.fillRect(ROAD_RIGHT - 5, 0, 5, GAME_HEIGHT);

  ctx.fillStyle = "#e8e4bf";
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  for (let lane = 1; lane < LANE_COUNT; lane += 1) {
    const x = ROAD_LEFT + lane * laneWidth - 3;
    for (let y = -100 + roadOffset; y < GAME_HEIGHT; y += 100) {
      ctx.fillRect(x, y, 6, 55);
    }
  }

  ctx.fillStyle = "#d8d8d8";
  for (let y = -48 + (roadOffset % 48); y < GAME_HEIGHT; y += 48) {
    ctx.fillRect(20, y, 12, 25);
    ctx.fillRect(GAME_WIDTH - 32, y, 12, 25);
  }
}

function drawCar(car, isPlayer = false) {
  ctx.save();
  ctx.translate(car.x, car.y);

  ctx.fillStyle = "#090b0c";
  ctx.fillRect(-4, 12, 5, 20);
  ctx.fillRect(car.width - 1, 12, 5, 20);
  ctx.fillRect(-4, car.height - 31, 5, 20);
  ctx.fillRect(car.width - 1, car.height - 31, 5, 20);

  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.roundRect(0, 0, car.width, car.height, 9);
  ctx.fill();

  ctx.fillStyle = "#bde7f5";
  ctx.beginPath();
  ctx.roundRect(8, 14, car.width - 16, 22, 5);
  ctx.fill();
  ctx.fillStyle = "#17242a";
  ctx.fillRect(8, 48, car.width - 16, 18);

  ctx.fillStyle = isPlayer ? "#fff4a8" : "#ff5d5d";
  ctx.fillRect(5, isPlayer ? 3 : car.height - 7, 10, 4);
  ctx.fillRect(car.width - 15, isPlayer ? 3 : car.height - 7, 10, 4);
  ctx.restore();
}

function draw() {
  drawRoad();
  for (const car of traffic) drawCar(car);
  drawCar(player, true);
}

function gameLoop(timestamp) {
  if (!running) return;
  const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  update(deltaTime);
  draw();
  if (running) animationFrameId = requestAnimationFrame(gameLoop);
}

function endGame() {
  running = false;
  bestScore = Math.max(bestScore, score);
  saveBestScore();
  setScoreText(bestScoreElement, bestScore);
  setScoreText(finalScoreElement, score);
  if (gameOverElement) gameOverElement.hidden = false;
  restartButton?.focus();
}

function keyboardDirection(key) {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "arrowleft" || normalizedKey === "a") return "left";
  if (normalizedKey === "arrowright" || normalizedKey === "d") return "right";
  return null;
}

document.addEventListener("keydown", (event) => {
  const direction = keyboardDirection(event.key);
  if (!direction) return;
  event.preventDefault();
  keysPressed[direction] = true;
});

document.addEventListener("keyup", (event) => {
  const direction = keyboardDirection(event.key);
  if (!direction) return;
  event.preventDefault();
  keysPressed[direction] = false;
});

window.addEventListener("blur", () => {
  keysPressed.left = false;
  keysPressed.right = false;
});

function bindTouchControl(button, direction) {
  if (!button) return;

  const release = (event) => {
    event.preventDefault();
    keysPressed[direction] = false;
    button.classList.remove("is-pressed");
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    keysPressed[direction] = true;
    button.classList.add("is-pressed");
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}

bindTouchControl(leftButton, "left");
bindTouchControl(rightButton, "right");
restartButton?.addEventListener("click", resetGame);

resetGame();
