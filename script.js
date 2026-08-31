/* script.js */

// --- Canvas Setup ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Game Constants ---
const GAME_WIDTH = canvas.width;
const GAME_HEIGHT = canvas.height;

// --- Player Car Object ---
const player = {
    x: GAME_WIDTH / 2 - 25, // Start near the center horizontally
    y: GAME_HEIGHT - 50,     // Start near the bottom
    width: 40,
    height: 60,
    color: 'red',
    speed: 5
};

// --- Track Definition (Simple straight road for now) ---
const trackLines = [
    // A simple path across the middle
    { y: GAME_HEIGHT / 2 - 10, x: 0, dx: 800, dy: 0, color: '#555' } 
];

// --- Drawing Functions ---

function drawCar() {
    // Draw the car body (a simple rectangle)
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y - player.height / 
                 player.width, player.width, player.height);
    
    // Optional: Draw a small detail (like a windshield)
    ctx.fillStyle = 'white';
    ctx.Rect(player.x + 5, player.y - player.height / 2, player.width - 10, player.height / 2);
}

function drawTrack() {
    // Draw the simple track line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line line/
    
    trackLines.forEach(line => {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 10; // Make the track lines thick
        ctx.beginPath();
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(line.x + line.dx, line.y);
        ctx.stroke();
    });
}

// --- Update Function ---

function update() {
    // 1. Handle Player Input
    const keysPressed = {
        ArrowLeft: false,
        ArrowRight: false
    };

    // Check for Left/Right movement
    if (keysPressed.ArrowLeft) {
        player.x -= player.speed;
    }
    if (keysPressed.ArrowRight) {
        player.x += player.speed;
    }

    // Keep car within bounds
    if (player.x < 0) player.x = 0;
    if (player.x > GAME_WIDTH - player.width) player.x = GAME_WIDTH - player.width;

    // 2. Check for Collision (Simplified: checking if the car hits the track area, though complex in a real game)
    // For this simple demo, we just ensure movement is valid.

}

// --- Main Game Loop ---

function gameLoop() {
    // 1. Clear the canvas
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // 2. Update Game State (Movement, physics, checks)
    update();

    // 3. Draw everything
    drawTrack();
    drawCar();

    // Request the next frame: This is crucial for creating smooth motion
    request_timeout(1000 / 60, gameLoop); // Target 60 FPS (1000ms / 60 frames)
}

// --- Event Listeners (Handling keyboard input) ---

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
        keysPressed.ArrowLeft = true;
    }
    if (e.key === 'ArrowRight') {
        keysPressed.ArrowRight = true;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') {
        keysPressed.ArrowLeft = false;
    }
    if (e.key === 'ArrowRight') {
        keysPressed.ArrowRight = false;
    }
});

// --- Start the Game ---
gameLoop();

console.log("Game Initialized. Use Left/Right Arrow keys to move.");
