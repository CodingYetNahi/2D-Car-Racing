"use strict";

const canvas = document.getElementById("gameCanvas");

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("The game canvas could not be found.");
}

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("This browser does not support the 2D canvas API.");

const scoreElement = document.getElementById("score");
const bestScoreElement = document.getElementById("bestScore");
const finalScoreElement = document.getElementById("finalScore");
const crashOverlayElement = document.getElementById("crashOverlay");
const crashCountElement = document.getElementById("crashCount");
const crashNumberElement = document.getElementById("crashNumber");
const continueAmountElement = document.getElementById("continueAmount");
const paymentStatusElement = document.getElementById("paymentStatus");
const payContinueButton = document.getElementById("payContinueButton");
const restartButton = document.getElementById("restartButton");
const leftButton = document.getElementById("moveLeft");
const rightButton = document.getElementById("moveRight");

const GAME_WIDTH = canvas.width;
const GAME_HEIGHT = canvas.height;
const ROAD_LEFT = 52;
const ROAD_RIGHT = GAME_WIDTH - 52;
const LANE_COUNT = 3;
const TRAFFIC_LANE_INSET = 8;
const TRAFFIC_ROUTE_GAP = 24;
const BASE_CONTINUE_PRICE_RUPEES = 9;
const PAYMENT_API_BASE = String(window.RACING_PAYMENT_API_BASE || "").replace(/\/$/, "");
const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
const TRAFFIC_COLORS = ["#ffc857", "#3dd6d0", "#a78bfa", "#ff7b72", "#f8f9fa"];

const keysPressed = { left: false, right: false };
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
let crashCount = 0;
let runId = null;
let runStartPromise = null;
let paymentInProgress = false;
let razorpayLoadPromise = null;

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
    // Best score persistence is optional. Payment state is never stored here.
  }
}

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function setPaymentStatus(message) {
  setText(paymentStatusElement, message || "");
}

function setPaymentBusy(isBusy) {
  paymentInProgress = isBusy;
  if (payContinueButton) payContinueButton.disabled = isBusy;
  if (restartButton) restartButton.disabled = isBusy;
}

async function paymentApi(path, payload) {
  if (!PAYMENT_API_BASE) throw new Error("Payment backend is not configured yet.");

  const response = await fetch(`${PAYMENT_API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Keep the public error generic. Never expose backend stack traces or secrets.
  }

  if (!response.ok) {
    throw new Error(body?.error || "Payment service is temporarily unavailable.");
  }

  return body;
}

function startServerRun() {
  runId = null;
  if (!PAYMENT_API_BASE) {
    runStartPromise = Promise.resolve(null);
    return runStartPromise;
  }

  runStartPromise = paymentApi("start-run", {})
    .then((data) => {
      if (!data?.runId) throw new Error("Payment service returned an invalid run.");
      runId = data.runId;
      return runId;
    })
    .catch((error) => {
      console.warn("Unable to start payment-backed run:", error.message);
      return null;
    });

  return runStartPromise;
}

async function ensureRunId() {
  if (runId) return runId;
  if (!runStartPromise) startServerRun();
  const resolvedRunId = await runStartPromise;
  if (!resolvedRunId) throw new Error("Payment service is unavailable. You can end the run and restart.");
  return resolvedRunId;
}

function resetGame() {
  cancelAnimationFrame(animationFrameId);
  traffic = [];
  roadOffset = 0;
  elapsedTime = 0;
  score = 0;
  crashCount = 0;
  spawnTimer = 0;
  spawnInterval = 1.25;
  worldSpeed = 245;
  player.x = (GAME_WIDTH - player.width) / 2;
  keysPressed.left = false;
  keysPressed.right = false;
  leftButton?.classList.remove("is-pressed");
  rightButton?.classList.remove("is-pressed");
  setText(scoreElement, 0);
  setText(bestScoreElement, bestScore);
  setText(crashCountElement, 0);
  setPaymentStatus("");
  if (crashOverlayElement) crashOverlayElement.hidden = true;
  setPaymentBusy(false);
  startServerRun();
  running = true;
  lastTime = performance.now();
  animationFrameId = requestAnimationFrame(gameLoop);
}

function laneBounds(lane) {
  const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / LANE_COUNT;
  return {
    left: ROAD_LEFT + lane * laneWidth,
    right: ROAD_LEFT + (lane + 1) * laneWidth
  };
}

function trafficX(lane, carWidth) {
  const bounds = laneBounds(lane);
  const minX = Math.max(ROAD_LEFT, bounds.left + TRAFFIC_LANE_INSET);
  const maxX = Math.min(ROAD_RIGHT - carWidth, bounds.right - carWidth - TRAFFIC_LANE_INSET);
  return minX + Math.random() * (maxX - minX);
}

function wouldBlockRoad(candidate) {
  const nearbyLanes = new Set([candidate.lane]);
  const safeVerticalGap = candidate.height + player.height + TRAFFIC_ROUTE_GAP;

  for (const car of traffic) {
    if (Math.abs(car.y - candidate.y) < safeVerticalGap) nearbyLanes.add(car.lane);
  }

  return nearbyLanes.size === LANE_COUNT;
}

function spawnTraffic() {
  const availableLanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane).filter((lane) =>
    traffic.every((car) => car.lane !== lane || car.y > 170)
  );

  if (availableLanes.length === 0) return;

  const lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
  const width = 50;
  const height = 84;
  const candidate = {
    lane,
    x: trafficX(lane, width),
    y: -height - 10,
    width,
    height,
    speedFactor: 0.88 + Math.random() * 0.24,
    color: TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)]
  };

  if (!wouldBlockRoad(candidate)) traffic.push(candidate);
}

function overlaps(a, b) {
  const paddingX = 3;
  const paddingY = 4;
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
      handleCrash();
      return;
    }
  }

  traffic = traffic.filter((car) => car.y < GAME_HEIGHT + car.height);
  score = Math.floor(elapsedTime * 10);
  setText(scoreElement, score);
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
    for (let y = -100 + roadOffset; y < GAME_HEIGHT; y += 100) ctx.fillRect(x, y, 6, 55);
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

function handleCrash() {
  running = false;
  cancelAnimationFrame(animationFrameId);
  bestScore = Math.max(bestScore, score);
  saveBestScore();

  crashCount += 1;
  const predictedAmount = BASE_CONTINUE_PRICE_RUPEES * crashCount;
  setText(bestScoreElement, bestScore);
  setText(finalScoreElement, score);
  setText(crashCountElement, crashCount);
  setText(crashNumberElement, crashCount);
  setText(continueAmountElement, predictedAmount);
  if (payContinueButton) payContinueButton.textContent = `Pay ₹${predictedAmount} & Continue`;
  setPaymentStatus(PAYMENT_API_BASE ? "" : "Payments are not configured yet. End the run and restart.");
  if (crashOverlayElement) crashOverlayElement.hidden = false;
  payContinueButton?.focus();
}

function resumeAfterVerifiedPayment() {
  // Prevent an immediate second collision with the same traffic cluster.
  traffic = traffic.filter((car) => Math.abs((car.y + car.height / 2) - (player.y + player.height / 2)) > 155);
  player.x = (GAME_WIDTH - player.width) / 2;
  keysPressed.left = false;
  keysPressed.right = false;
  setPaymentStatus("");
  if (crashOverlayElement) crashOverlayElement.hidden = true;
  setPaymentBusy(false);
  running = true;
  lastTime = performance.now();
  animationFrameId = requestAnimationFrame(gameLoop);
}

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayLoadPromise) return razorpayLoadPromise;

  razorpayLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded."));
    document.head.appendChild(script);
  });

  return razorpayLoadPromise;
}

async function payAndContinue() {
  if (paymentInProgress) return;
  setPaymentBusy(true);
  setPaymentStatus("Preparing secure payment…");

  try {
    const activeRunId = await ensureRunId();
    const order = await paymentApi("create-order", { runId: activeRunId });

    if (!order?.orderId || !order?.keyId || !Number.isInteger(order?.amountPaise) || order.amountPaise < 100) {
      throw new Error("Payment service returned an invalid order.");
    }

    const authoritativeCrashNumber = Number(order.crashNumber);
    const authoritativeRupees = order.amountPaise / 100;
    if (!Number.isInteger(authoritativeCrashNumber) || authoritativeCrashNumber < 1) {
      throw new Error("Payment service returned an invalid crash number.");
    }

    crashCount = authoritativeCrashNumber;
    setText(crashCountElement, crashCount);
    setText(crashNumberElement, crashCount);
    setText(continueAmountElement, authoritativeRupees);
    if (payContinueButton) payContinueButton.textContent = `Pay ₹${authoritativeRupees} & Continue`;

    await loadRazorpayCheckout();
    setPaymentStatus("");

    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency || "INR",
      name: "2D Racing Game",
      description: `Continue after crash ${crashCount}`,
      order_id: order.orderId,
      handler: async (response) => {
        setPaymentStatus("Verifying payment…");
        try {
          const verification = await paymentApi("verify-payment", {
            runId: activeRunId,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature
          });

          if (!verification?.verified) throw new Error("Payment verification failed.");
          resumeAfterVerifiedPayment();
        } catch (error) {
          console.error("Payment verification error:", error);
          setPaymentStatus("Payment could not be verified. Do not pay again; retry verification or contact support.");
          setPaymentBusy(false);
        }
      },
      modal: {
        ondismiss: () => {
          setPaymentStatus("Payment cancelled. No charge is made by cancelling Checkout.");
          setPaymentBusy(false);
        }
      },
      theme: { color: "#58e88b" }
    });

    checkout.on("payment.failed", () => {
      setPaymentStatus("Payment failed. You have not been allowed to continue this run.");
      setPaymentBusy(false);
    });

    checkout.open();
  } catch (error) {
    console.error("Unable to start payment:", error);
    setPaymentStatus(error.message || "Payment service is unavailable.");
    setPaymentBusy(false);
  }
}

function keyboardDirection(key) {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "arrowleft" || normalizedKey === "a") return "left";
  if (normalizedKey === "arrowright" || normalizedKey === "d") return "right";
  return null;
}

document.addEventListener("keydown", (event) => {
  if (!running) return;
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
    if (!running) return;
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
payContinueButton?.addEventListener("click", payAndContinue);
restartButton?.addEventListener("click", resetGame);

resetGame();
