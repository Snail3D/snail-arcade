const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const gameOverElement = document.getElementById("game-over");
const finalScoreElement = document.getElementById("final-score");
const resetBtn = document.getElementById("resetBtn");

// Responsive scaling for mobile
function resizeCanvas() {
    const container = document.getElementById("game-container");
    const maxWidth = Math.min(window.innerWidth - 40, 400);
    canvas.width = maxWidth;
    canvas.height = maxWidth;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const gridSize = canvas.width / 20; // Logic remains 20 tiles wide
const tileCount = 20;

let score = 0;
let dx = 0;
let dy = 0;
let snail = [{ x: 10, y: 10 }];
let lettuce = { x: 5, y: 5 };
let salt = { x: 15, y: 15, active: false };
let gameSpeed = 150;
let gameRunning = false;

// Mobile Touch Handling
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}, { passive: false });

document.addEventListener("touchmove", (e) => {
    if (!gameRunning) return;
    e.preventDefault(); // Prevent scrolling while playing
}, { passive: false });

document.addEventListener("touchend", (e) => {
    if (!gameRunning) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    // Determine swipe direction
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe
        if (deltaX > 30 && dx !== -1) { dx = 1; dy = 0; }      // Right
        else if (deltaX < -30 && dx !== 1) { dx = -1; dy = 0; } // Left
    } else {
        // Vertical swipe
        if (deltaY > 30 && dy !== -1) { dx = 0; dy = 1; }      // Down
        else if (deltaY < -30 && dy !== 1) { dx = 0; dy = -1; } // Up
    }
}, { passive: false });

// Keyboard handling (Keep for Desktop)
document.addEventListener("keydown", (e) => {
    if (!gameRunning) return;
    const key = e.key;
    if (key === "ArrowUp" && dy !== 1) { dx = 0; dy = -1; }
    if (key === "ArrowDown" && dy !== -1) { dx = 0; dy = 1; }
    if (key === "ArrowLeft" && dx !== 1) { dx = -1; dy = 0; }
    if (key === "ArrowRight" && dx !== -1) { dx = 1; dy = 0; }
});

function main() {
    if (didGameEnd()) {
        showGameOver();
        return;
    }

    setTimeout(function onTick() {
        clearCanvas();
        drawLettuce();
        drawSalt();
        advanceSnail();
        drawSnail();
        main();
    }, gameSpeed);
}

function clearCanvas() {
    ctx.fillStyle = "#8db600";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = "#7a9d00";
    for(let i=0; i<canvas.width; i+=40) {
        for(let j=0; j<canvas.height; j+=40) {
            ctx.fillRect(i, j, 2, 2);
        }
    }
}

function drawSnail() {
    const currentGridSize = canvas.width / tileCount;
    snail.forEach((part, index) => {
        ctx.fillStyle = index === 0 ? "#8d6e63" : "#a1887f";
        ctx.beginPath();
        ctx.arc(part.x * currentGridSize + currentGridSize/2, part.y * currentGridSize + currentGridSize/2, currentGridSize/2 - 1, 0, 2 * Math.PI);
        ctx.fill();

        if (index === 0) {
            ctx.fillStyle = "black";
            ctx.beginPath();
            ctx.arc(part.x * currentGridSize + currentGridSize/4, part.y * currentGridSize + currentGridSize/4, currentGridSize/8, 0, 2 * Math.PI);
            ctx.arc(part.x * currentGridSize + (3*currentGridSize/4), part.y * currentGridSize + currentGridSize/4, currentGridSize/8, 0, 2 * Math.PI);
            ctx.fill();
        }
    });
}

function advanceSnail() {
    const currentGridSize = canvas.width / tileCount;
    const head = { x: snail[0].x + dx, y: snail[0].y + dy };
    snail.unshift(head);

    if (head.x === lettuce.x && head.y === lettuce.y) {
        score += 1;
        scoreElement.innerHTML = `Lettuce Eaten: ${score}`;
        createLettuce();
        if (Math.random() > 0.7) createSalt();
        if (gameSpeed > 50) gameSpeed -= 2;
    } else {
        if (dx !== 0 || dy !== 0) {
            snail.pop();
        }
    }
}

function didGameEnd() {
    if (dx === 0 && dy === 0) return false;
    const head = snail[0];
    const hitWall = head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount;
    const hitSelf = snail.slice(1).some(part => part.x === head.x && part.y === head.y);
    const hitSalt = salt.active && head.x === salt.x && head.y === salt.y;
    return hitWall || hitSelf || hitSalt;
}

function createLettuce() {
    letta = {
        x: Math.floor(Math.random() * tileCount),
        y: Math.floor(Math.random() * tileCount)
    };
    if (snail.some(part => part.x === letta.x && part.y === letta.y)) createLettuce();
    lettuce = letta;
}

function createSalt() {
    salt = {
        x: Math.floor(Math.random() * tileCount),
        y: Math.floor(Math.random() * tileCount),
        active: true
    };
}

function drawLettuce() {
    const currentGridSize = canvas.width / tileCount;
    ctx.fillStyle = "#2e7d32";
    ctx.beginPath();
    ctx.arc(lettuce.x * currentGridSize + currentGridSize/2, lettuce.y * currentGridSize + currentGridSize/2, currentGridSize/2 - 2, 0, 2 * Math.PI);
    ctx.fill();
}

function drawSalt() {
    if (!salt.active) return;
    const currentGridSize = canvas.width / tileCount;
    ctx.fillStyle = "#eceff1";
    ctx.fillRect(salt.x * currentGridSize + 2, salt.y * currentGridSize + 2, currentGridSize - 4, currentGridSize - 4);
}

function showGameOver() {
    gameRunning = false;
    gameOverElement.classList.remove("hidden");
    finalScoreElement.innerHTML = `You ate ${score} pieces of lettuce!`;
}

function resetGame() {
    score = 0;
    dx = 1;
    dy = 0;
    snail = [{ x: 10, y: 10 }];
    gameSpeed = 150;
    gameRunning = true;
    scoreElement.innerHTML = `Lettuce Eaten: 0`;
    gameOverElement.classList.add("hidden");
    salt.active = false;
    createLettuce();
    main();
}

resetBtn.addEventListener("click", resetGame);
resetGame();
