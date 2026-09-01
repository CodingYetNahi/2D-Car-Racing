"use strict";

import { ENTITLEMENT_STORAGE_KEY, PASS_PRODUCTS, TERMS_VERSION, getPassProduct } from "./payment-policy.js";

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
const paymentStatusElement = document.getElementById("paymentStatus");
const passPurchasePanel = document.getElementById("passPurchasePanel");
const activePassMessage = document.getElementById("activePassMessage");
const dayPassButton = document.getElementById("dayPassButton");
const weekPassButton = document.getElementById("weekPassButton");
const continueToPaymentButton = document.getElementById("continueToPaymentButton");
const ageDialog = document.getElementById("ageDialog");
const selectedPassSummary = document.getElementById("selectedPassSummary");
const confirmAdultButton = document.getElementById("confirmAdultButton");
const declineAdultButton = document.getElementById("declineAdultButton");
const usePassButton = document.getElementById("usePassButton");
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
let activePass = null;
let selectedProductCode = "";

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
  if (dayPassButton) dayPassButton.disabled = isBusy || !PAYMENT_API_BASE;
  if (weekPassButton) weekPassButton.disabled = isBusy || !PAYMENT_API_BASE;
  if (continueToPaymentButton) continueToPaymentButton.disabled = isBusy || !PAYMENT_API_BASE || !selectedProductCode;
  if (usePassButton) usePassButton.disabled = isBusy;
  if (restartButton) restartButton.disabled = isBusy;
}

function selectPass(productCode) {
  const product = getPassProduct(productCode);
  if (!product || paymentInProgress) return;
  selectedProductCode = product.code;

  dayPassButton?.setAttribute("aria-pressed", String(product.code === PASS_PRODUCTS.day.code));
  weekPassButton?.setAttribute("aria-pressed", String(product.code === PASS_PRODUCTS.week.code));
  if (continueToPaymentButton) {
    continueToPaymentButton.disabled = !PAYMENT_API_BASE;
    continueToPaymentButton.textContent = `Continue with ${product.name}`;
  }
  setPaymentStatus("");
}

function askForAdultConfirmation() {
  const product = getPassProduct(selectedProductCode);
  if (!product || paymentInProgress) return;
  setText(selectedPassSummary, `${product.name}: ₹${product.amountPaise / 100} for ${product.durationHours === 24 ? "24 hours" : "7 days"}.`);

  if (ageDialog instanceof HTMLDialogElement && typeof ageDialog.showModal === "function") {
    ageDialog.showModal();
    return;
  }

  setPaymentStatus("Your browser cannot open the secure age check. Please update it before buying a pass.");
}

function readAccessToken() {
  try {
    return localStorage.getItem(ENTITLEMENT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveAccessToken(token) {
  try {
    if (token) localStorage.setItem(ENTITLEMENT_STORAGE_KEY, token);
    else localStorage.removeItem(ENTITLEMENT_STORAGE_KEY);
  } catch {
    // Storage can be blocked. The entitlement then lasts only for this page session.
  }
}

async function paymentApi(path, payload, accessToken = "") {
  if (!PAYMENT_API_BASE) throw new Error("Payment backend is not configured yet.");

  const response = await fetch(`${PAYMENT_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {})
    },
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

function renderPassState() {
  const hasActivePass = Boolean(activePass?.active && activePass?.expiresAt);
  if (passPurchasePanel) passPurchasePanel.hidden = hasActivePass;
  if (usePassButton) usePassButton.hidden = !hasActivePass;
  if (activePassMessage) {
    activePassMessage.hidden = !hasActivePass;
    activePassMessage.textContent = hasActivePass
      ? `${activePass.productName} active until ${new Date(activePass.expiresAt).toLocaleString()}.`
      : "";
  }
}

async function refreshPassState() {
  const token = readAccessToken();
  if (!token || !PAYMENT_API_BASE) {
    activePass = null;
    renderPassState();
    return null;
  }

  try {
    const result = await paymentApi("check-pass", {}, token);
    activePass = result?.active ? result : null;
    if (!activePass) saveAccessToken("");
  } catch {
    activePass = null;
  }
  renderPassState();
  return activePass;
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
  void refreshPassState();
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
  // The player travels up the road; opposing traffic travels down it.
  // Headlights and tail lights make that direction clear in both orientations.
  ctx.fillStyle = "#fff4a8";
  const frontLightY = isPlayer ? 3 : car.height - 7;
  ctx.fillRect(5, frontLightY, 10, 4);
  ctx.fillRect(car.width - 15, frontLightY, 10, 4);
  ctx.fillStyle = "#ff5d5d";
  const rearLightY = isPlayer ? car.height - 7 : 3;
  ctx.fillRect(5, rearLightY, 10, 4);
  ctx.fillRect(car.width - 15, rearLightY, 10, 4);
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
  setText(bestScoreElement, bestScore);
  setText(finalScoreElement, score);
  setText(crashCountElement, crashCount);
  setText(crashNumberElement, crashCount);
  setPaymentStatus(PAYMENT_API_BASE ? "" : "Payments are not configured yet. Restart free.");
  if (crashOverlayElement) crashOverlayElement.hidden = false;
  void refreshPassState().finally(() => {
    if (activePass) usePassButton?.focus();
    else restartButton?.focus();
  });
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

async function buyPass(productCode) {
  if (paymentInProgress) return;
  const product = getPassProduct(productCode);
  if (!product) return;

  setPaymentBusy(true);
  setPaymentStatus("Preparing secure payment…");

  try {
    const activeRunId = await ensureRunId();
    const order = await paymentApi("create-order", {
      runId: activeRunId,
      productCode,
      adultConfirmed: true,
      termsVersion: TERMS_VERSION
    });

    if (!order?.orderId || !order?.keyId || !Number.isInteger(order?.amountPaise)) {
      throw new Error("Payment service returned an invalid order.");
    }
    if (order.productCode !== product.code || order.amountPaise !== product.amountPaise) {
      throw new Error("Payment service returned an unexpected pass or price.");
    }

    await loadRazorpayCheckout();
    setPaymentStatus("");

    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency || "INR",
      name: "2D Racing Game",
      description: `${product.name} · non-renewing access`,
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

          if (!verification?.verified || !verification?.accessToken || !verification?.expiresAt) {
            throw new Error("Payment verification failed.");
          }
          saveAccessToken(verification.accessToken);
          activePass = verification;
          renderPassState();
          resumeAfterVerifiedPayment();
        } catch (error) {
          console.error("Payment verification error:", error);
          setPaymentStatus("Payment could not be verified. Do not pay again; retry verification or contact support.");
          setPaymentBusy(false);
        }
      },
      modal: {
        ondismiss: () => {
          setPaymentStatus("Payment cancelled. Cancelling Checkout does not create a charge.");
          setPaymentBusy(false);
        }
      },
      theme: { color: "#58e88b" }
    });

    checkout.on("payment.failed", () => {
      setPaymentStatus("Payment failed. No pass was granted.");
      setPaymentBusy(false);
    });
    checkout.open();
  } catch (error) {
    console.error("Unable to start payment:", error);
    setPaymentStatus(error.message || "Payment service is unavailable.");
    setPaymentBusy(false);
  }
}

async function useActivePass() {
  if (paymentInProgress) return;
  setPaymentBusy(true);
  setPaymentStatus("Checking pass…");
  try {
    const activeRunId = await ensureRunId();
    const token = readAccessToken();
    if (!token) throw new Error("No active pass was found.");
    const authorization = await paymentApi("authorize-continue", { runId: activeRunId }, token);
    if (!authorization?.authorized) throw new Error("This pass has expired or is not valid.");
    activePass = authorization;
    renderPassState();
    resumeAfterVerifiedPayment();
  } catch (error) {
    saveAccessToken("");
    activePass = null;
    renderPassState();
    setPaymentStatus(error.message || "The pass could not be checked. Restart free.");
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
dayPassButton?.addEventListener("click", () => selectPass(PASS_PRODUCTS.day.code));
weekPassButton?.addEventListener("click", () => selectPass(PASS_PRODUCTS.week.code));
continueToPaymentButton?.addEventListener("click", askForAdultConfirmation);
confirmAdultButton?.addEventListener("click", (event) => {
  event.preventDefault();
  ageDialog?.close("yes");
  void buyPass(selectedProductCode);
});
declineAdultButton?.addEventListener("click", (event) => {
  event.preventDefault();
  ageDialog?.close("no");
  setPaymentStatus("A parent or guardian aged 18 or older must make the purchase in their own name.");
  continueToPaymentButton?.focus();
});
usePassButton?.addEventListener("click", useActivePass);
restartButton?.addEventListener("click", resetGame);

resetGame();
