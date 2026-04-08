const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const gameOverElement = document.getElementById("game-over");
const finalScoreElement = document.getElementById("final-score");
const resetBtn = document.getElementById("resetBtn");

const gridSize = 20;
const tileCount = canvas.width / gridSize;

let score = 0;
let dx = 0;
let dy = 0;
let snail = [{ x: 10, y: 10 }];
let lettuce = { x: 5, y: 5 };
let salt = { x: 15, y: 15, active: false };
let gameSpeed = 150;
let gameRunning = false;

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
    
    // Draw some "dirt" spots
    ctx.fillStyle = "#7a9d00";
    for(let i=0; i<canvas.width; i+=40) {
        for(let j=0; j<canvas.height; j+=40) {
            ctx.fillRect(i, j, 2, 2);
        }
    }
}

function drawSnail() {
    snail.forEach((part, index) => {
        ctx.fillStyle = index === 0 ? "#8d6e63" : "#a1887f"; // Shell color
        ctx.beginPath();
        ctx.arc(part.x * gridSize + gridSize/2, part.y * gridSize + gridSize/2, gridSize/2 - 2, 0, 2 * Math.PI);
        ctx.fill();

        // Eyes for the head
        if (index === 0) {
            ctx.fillStyle = "black";
            ctx.beginPath();
            ctx.arc(part.x * gridSize + 5, part.y * gridSize + 5, 2, 0, 2 * Math.PI);
            ctx.arc(part.x * gridSize + 15, part.y * gridSize + 5, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
    });
}

function advanceSnail() {
    const head = { x: snail[0].x + dx, y: snail[0].y + dy };
    snail.unshift(head);

    if (head.x === lettuce.x && head.y === lettuce.y) {
        score += 1;
        scoreElement.innerHTML = `Lettuce Eaten: ${score}`;
        createLettuce();
        // Randomly spawn salt
        if (Math.random() > 0.7) {
            createSalt();
        }
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
    // Don't spawn on snail
    if (snail.some(part => part.x === letta.x && part.y === letta.y)) {
        createLettuce();
    }
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
    ctx.fillStyle = "#2e7d32"; // Dark green
    ctx.beginPath();
    ctx.arc(lettuce.x * gridSize + gridSize/2, lettuce.y * gridSize + gridSize/2, gridSize/2 - 2, 0, 2 * Math.PI);
    ctx.fill();
    // Little leaf detail
    ctx.strokeStyle = "#c5e1a5";
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawSalt() {
    if (!salt.active) return;
    ctx.fillStyle = "#eceff1"; // White salt
    ctx.beginPath();
    ctx.rect(salt.x * gridSize + 5, salt.y * gridSize + 5, gridSize - 10, gridSize - 10);
    ctx.fill();
    ctx.strokeStyle = "#cfd8dc";
    ctx.stroke();
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

document.addEventListener("keydown", (e) => {
    if (!gameRunning) return;
    switch (e.key) {
        case "ArrowUp": if (dy !== 1) { dx = 0; dy = -1; } break;
        case "ArrowDown": if (dy !== -1) { dx = 0; dy = 1; } break;
        case $.key === "ArrowLeft": if (dx !== 1) { dx = -1; dy = 0; } break; // Wait, fixed below
    }
});

// Corrected Key Handler
document.addEventListener("keydown", (e) => {
    if (!gameRunning) return;
    const key = e.key;
    if (key === "ArrowUp" && dy !== 1) { dx = 0; dy = -1; }
    if (key === "ArrowDown" && dy !== -1) { dx = 0; dy = 1; }
    if (key === "ArrowLeft" && dx !== 1) { dx = -1; dy = 0; }
    if (key === "ArrowRight" && dx !== -1) { dx = 1; dy = 0; }
});

resetBtn.addEventListener("click", resetGame);

// Start the logic
resetGame();
