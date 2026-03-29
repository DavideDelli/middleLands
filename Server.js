// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- Configurazione del Gioco ---
const GRID_WIDTH = 1350;
const GRID_HEIGHT = 810;

// Nuova Palette di Colori v14
const DEEP_SEA_COLOR = '#1d4ed8';    // Blu più scuro e profondo
const SHALLOW_SEA_COLOR = '#38bdf8'; // Azzurro cielo
const BEACH_COLOR = '#fde047';       // Giallo sabbia brillante
const PLAINS_COLOR = '#4ade80';      // Verde prato vivido
const FOREST_COLOR = '#166534';      // Verde foresta scuro
const MOUNTAIN_COLOR = '#a1a1aa';    // Grigio roccia neutro
const SNOW_PEAK_COLOR = '#ffffff';   // Bianco neve puro

const INITIAL_TROOPS = 350; // Valore intermedio
const TROOP_INCREASE_INTERVAL = 2000; 
const BASE_TROOPS_PER_INTERVAL = 6; // Valore intermedio
const TILES_PER_EXTRA_TROOP = 15; // Ribilanciato

const COST_PER_INITIAL_TILE = 15; 
const BASE_EXPANSION_COST_PER_TILE = 4; 

const TERRAIN_COST_MODIFIERS = {
    'beach': 1.0, 'plains': 1.0, 'forest': 1.75, 
    'mountain': 3.0, 'snow_peak': 4.0,
    'deep_sea': Infinity, 'shallow_sea': Infinity
};

const NUMBER_OF_BOTS = 3; 
const BOT_AI_INTERVAL = 4000; 
const BOT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
const BOT_COLORS = ["#FF6347", "#4682B4", "#32CD32", "#FFD700", "#6A5ACD", "#FF4500"]; 


let gameGrid = [];
let players = {}; 
let gameState = 'lobby'; 

// --- Generazione Mappa ---

function interpolate(a, b, t) {
    const ft = t * Math.PI;
    const f = (1 - Math.cos(ft)) * 0.5;
    return a * (1 - f) + b * f;
}

function generateRandomGrid(width, height) {
    let grid = [];
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = Math.random();
        }
    }
    return grid;
}

function simpleNoise2D(x, y, randomGrid, gridCellWidth, gridCellHeight) {
    const gridX = x / gridCellWidth;
    const gridY = y / gridCellHeight;
    const xi = Math.floor(gridX);
    const yi = Math.floor(gridY);
    const xf = gridX - xi;
    const yf = gridY - yi;

    const rH = randomGrid.length;
    const rW = randomGrid[0].length;

    const y0 = yi % rH;
    const x0 = xi % rW;
    const y1 = (yi + 1) % rH;
    const x1 = (xi + 1) % rW;

    const v1 = randomGrid[y0][x0];
    const v2 = randomGrid[y0][x1];
    const v3 = randomGrid[y1][x0];
    const v4 = randomGrid[y1][x1];

    const i1 = interpolate(v1, v2, xf);
    const i2 = interpolate(v3, v4, xf);

    return interpolate(i1, i2, yf);
}

function generatePerlinLikeMap() {
    console.log("[Server MapGen] Avvio generazione mappa...");

    let baseNoiseMap = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0));
    let totalAmplitudeBase = 0;
    const basePersistence = 0.6;
    const baseOctaves = 5;
    const baseInitialFreq = Math.min(GRID_WIDTH, GRID_HEIGHT) / 15;

    for (let o = 0; o < baseOctaves; o++) {
        const frequency = Math.pow(2, o);
        const amplitude = Math.pow(basePersistence, o);
        totalAmplitudeBase += amplitude;

        const octaveGridWidth = Math.max(2, Math.floor(GRID_WIDTH / (frequency * baseInitialFreq)));
        const octaveGridHeight = Math.max(2, Math.floor(GRID_HEIGHT / (frequency * baseInitialFreq)));
        const randomGrid = generateRandomGrid(octaveGridWidth, octaveGridHeight);
        const cellWidth = GRID_WIDTH / octaveGridWidth;
        const cellHeight = GRID_HEIGHT / octaveGridHeight;

        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                baseNoiseMap[y][x] += simpleNoise2D(x, y, randomGrid, cellWidth, cellHeight) * amplitude;
            }
        }
    }

    const centerX = GRID_WIDTH / 2;
    const centerY = GRID_HEIGHT / 2;
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            baseNoiseMap[y][x] /= totalAmplitudeBase;
            const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
            const gradient = Math.pow(1 - (dist / maxDist), 0.6);
            baseNoiseMap[y][x] = (baseNoiseMap[y][x] + gradient) / 2;
        }
    }
    console.log("[Server MapGen] Rumore di base generato.");

    let landSeaMask = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill('sea'));
    const seaLevel = 0.52;
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (baseNoiseMap[y][x] > seaLevel) {
                landSeaMask[y][x] = 'land';
            }
        }
    }

    const cleanupPasses = 4;
    for (let p = 0; p < cleanupPasses; p++) {
        let changedFill = true;
        while (changedFill) {
            changedFill = false;
            for (let y = 1; y < GRID_HEIGHT - 1; y++) {
                for (let x = 1; x < GRID_WIDTH - 1; x++) {
                    if (landSeaMask[y][x] === 'sea') {
                        let landNeighbors = 0;
                        if (landSeaMask[y - 1][x] === 'land') landNeighbors++;
                        if (landSeaMask[y + 1][x] === 'land') landNeighbors++;
                        if (landSeaMask[y][x - 1] === 'land') landNeighbors++;
                        if (landSeaMask[y][x + 1] === 'land') landNeighbors++;
                        if (landNeighbors >= 3) {
                            landSeaMask[y][x] = 'land';
                            changedFill = true;
                        }
                    }
                }
            }
        }
        let changedRemove = true;
        while (changedRemove) {
            changedRemove = false;
            for (let y = 1; y < GRID_HEIGHT - 1; y++) {
                for (let x = 1; x < GRID_WIDTH - 1; x++) {
                    if (landSeaMask[y][x] === 'land') {
                        let seaNeighbors = 0;
                        if (landSeaMask[y - 1][x] === 'sea') seaNeighbors++;
                        if (landSeaMask[y + 1][x] === 'sea') seaNeighbors++;
                        if (landSeaMask[y][x - 1] === 'sea') seaNeighbors++;
                        if (landSeaMask[y][x + 1] === 'sea') seaNeighbors++;
                        if (seaNeighbors >= 3) {
                            landSeaMask[y][x] = 'sea';
                            changedRemove = true;
                        }
                    }
                }
            }
        }
    }
    console.log("[Server MapGen] Coste pulite.");

    let detailNoiseMap = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0));
    let totalAmplitudeDetail = 0;
    const detailPersistence = 0.5;
    const detailOctaves = 6;
    const detailInitialFreq = Math.min(GRID_WIDTH, GRID_HEIGHT) / 40;

    for (let o = 0; o < detailOctaves; o++) {
        const frequency = Math.pow(2, o);
        const amplitude = Math.pow(detailPersistence, o);
        totalAmplitudeDetail += amplitude;

        const octaveGridWidth = Math.max(2, Math.floor(GRID_WIDTH / (frequency * detailInitialFreq)));
        const octaveGridHeight = Math.max(2, Math.floor(GRID_HEIGHT / (frequency * detailInitialFreq)));
        const randomGrid = generateRandomGrid(octaveGridWidth, octaveGridHeight);
        const cellWidth = GRID_WIDTH / octaveGridWidth;
        const cellHeight = GRID_HEIGHT / octaveGridHeight;

        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (landSeaMask[y][x] === 'land') {
                    detailNoiseMap[y][x] += simpleNoise2D(x, y, randomGrid, cellWidth, cellHeight) * amplitude;
                }
            }
        }
    }
     for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (landSeaMask[y][x] === 'land') {
                detailNoiseMap[y][x] /= totalAmplitudeDetail;
            }
        }
    }
    console.log("[Server MapGen] Rumore di dettaglio generato.");

    let finalMap = [];
    const beachLevel = 0.18;
    const plainsLevel = 0.50;
    const forestLevel = 0.75;
    const mountainLevel = 0.92;

    for (let y = 0; y < GRID_HEIGHT; y++) {
        finalMap[y] = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            let type, subType, color;
            if (landSeaMask[y][x] === 'sea') {
                type = 'sea';
                if (baseNoiseMap[y][x] < seaLevel * 0.75) {
                    subType = 'deep_sea';
                    color = DEEP_SEA_COLOR;
                } else {
                    subType = 'shallow_sea';
                    color = SHALLOW_SEA_COLOR;
                }
            } else { 
                type = 'land';
                const terrainValue = detailNoiseMap[y][x];
                if (terrainValue < beachLevel) {
                    subType = 'beach';
                    color = BEACH_COLOR;
                } else if (terrainValue < plainsLevel) {
                    subType = 'plains';
                    color = PLAINS_COLOR;
                } else if (terrainValue < forestLevel) {
                    subType = 'forest';
                    color = FOREST_COLOR;
                } else if (terrainValue < mountainLevel) {
                    subType = 'mountain';
                    color = MOUNTAIN_COLOR;
                } else {
                    subType = 'snow_peak';
                    color = SNOW_PEAK_COLOR;
                }
            }
            finalMap[y][x] = { type: type, subType: subType, baseColor: color };
        }
    }
    console.log("[Server MapGen] Generazione mappa completata.");
    return finalMap;
}


function calculateTileConquestCost(subType) { 
    if (!subType || TERRAIN_COST_MODIFIERS[subType] === undefined) return BASE_EXPANSION_COST_PER_TILE; 
    return Math.ceil(BASE_EXPANSION_COST_PER_TILE * TERRAIN_COST_MODIFIERS[subType]);
}

function initializeGame() { 
    gameState = 'lobby'; 
    players = {}; 
    const generatedMap = generatePerlinLikeMap();
    gameGrid = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            row.push({
                owner: null, color: generatedMap[y][x].baseColor,
                type: generatedMap[y][x].type, subType: generatedMap[y][x].subType, 
                baseColor: generatedMap[y][x].baseColor
            });
        }
        gameGrid.push(row);
    }
    console.log(`[Server] Griglia ${GRID_WIDTH}x${GRID_HEIGHT} inizializzata per una nuova partita.`);
}

function startGameProcedure() {
    if (gameState === 'active') {
        console.log("[Server] La partita è già attiva.");
        return;
    }
    console.log("[Server] Avvio procedura di inizio partita...");
    gameState = 'active';
    const humanPlayers = {};
    for (const playerId in players) {
        if (!players[playerId].isBot) {
            humanPlayers[playerId] = players[playerId];
            humanPlayers[playerId].capital = null;
            humanPlayers[playerId].troops = INITIAL_TROOPS;
        }
    }
    players = humanPlayers;

    spawnBots(NUMBER_OF_BOTS); 
    
    for (const playerId in players) {
        if (!players[playerId].isBot) {
             io.to(playerId).emit('gameStarted');
             for (const pIdToBroadcast in players) {
                sendPlayerDetails(playerId, players[pIdToBroadcast]);
             }
        }
    }
    console.log("[Server] Partita ATTIVA. Bot spawnati e dettagli inviati.");
    broadcastGridUpdate();
}


function broadcastGridUpdate() { io.emit('updateGrid', gameGrid); }
function countPlayerTiles(playerId) {
    let count = 0;
    for (let r of gameGrid) for (let cell of r) if (cell.owner === playerId && cell.type === 'land') count++;
    return count;
}

function getLeaderboardData() {
    const leaderboard = [];
    for (const playerId in players) {
        if (players.hasOwnProperty(playerId)) {
            const player = players[playerId];
            const tileCount = countPlayerTiles(playerId);
            let name = '??';
            if (player.isBot) {
                const nameParts = player.id.split('_');
                if (nameParts.length > 1) {
                    name = nameParts[1];
                }
            } else if(player.id) {
                name = player.id.substring(0, 5);
            }
            
            leaderboard.push({
                id: playerId,
                name: name,
                tileCount: tileCount,
                color: player.color
            });
        }
    }
    leaderboard.sort((a, b) => b.tileCount - a.tileCount);
    return leaderboard;
}

function sendPlayerDetails(socketIdToReceive, playerDetailsObject) {
    if (players[socketIdToReceive] && !players[socketIdToReceive].isBot && playerDetailsObject) {
        const detailsToSend = { 
            id: playerDetailsObject.id, 
            color: playerDetailsObject.color, 
            capital: playerDetailsObject.capital,
            isBot: playerDetailsObject.isBot 
        };
        io.to(socketIdToReceive).emit('assignPlayerDetails', detailsToSend);
    }
}

function broadcastPlayerDetails(playerToBroadcastDetails) {
    if (!playerToBroadcastDetails) return;
    for (const socketId in players) {
        if (players.hasOwnProperty(socketId) && !players[socketId].isBot) {
            sendPlayerDetails(socketId, playerToBroadcastDetails);
        }
    }
}


function spawnBots(numBots) {
    for (let i = 0; i < numBots; i++) {
        const botId = `Bot_${BOT_NAMES[i % BOT_NAMES.length]}_${i}`;
        const botColor = BOT_COLORS[i % BOT_COLORS.length];
        if (players[botId]) continue;
        players[botId] = {
            id: botId, color: botColor, troops: INITIAL_TROOPS,
            capital: null, isBot: true, lastActionTime: 0 
        };
        console.log(`[Server] Creato Bot: ${botId} con colore ${botColor}`);
    }
}

function botAttemptClaimFirstTile(botId) {
    const bot = players[botId];
    if (!bot || bot.capital) return false;
    let attempts = 0;
    const maxAttempts = GRID_WIDTH * GRID_HEIGHT / 10; 
    while (attempts < maxAttempts) {
        const x = Math.floor(Math.random() * GRID_WIDTH);
        const y = Math.floor(Math.random() * GRID_HEIGHT);
        const tile = gameGrid[y]?.[x];
        if (tile && tile.type === 'land' && tile.owner === null) {
            const cost = calculateTileConquestCost(tile.subType); 
            if (bot.troops >= cost) {
                bot.troops -= cost;
                tile.owner = botId;
                tile.color = bot.color;
                bot.capital = { x, y };
                console.log(`[Server AI] Bot ${botId} ha fondato la capitale a (${x},${y}) su ${tile.subType}. Costo: ${cost}`);
                broadcastPlayerDetails(bot);
                return true; 
            }
        }
        attempts++;
    }
    return false; 
}

function botAttemptExpansion(botId) {
    const bot = players[botId];
    if (!bot || !bot.capital) return false;
    const costCheapestTile = calculateTileConquestCost('plains'); 
    if (bot.troops < costCheapestTile * 3) return false;
    const troopsToCommit = Math.floor(bot.troops * (Math.random() * 0.4 + 0.5)); 
    let actualTroopsSpent = 0;
    let tilesClaimed = 0;
    const cellsToConsider = [];
    const discoveryQueue = [{ x: bot.capital.x, y: bot.capital.y, dist: 0 }];
    const discovered = new Set([`${bot.capital.x},${bot.capital.y}`]);
    let dHead = 0;
    while(dHead < discoveryQueue.length){
        const current = discoveryQueue[dHead++];
        const directions = [ { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 } ];
        for (const dir of directions) {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;
            const neighborCoord = `${nx},${ny}`;
            if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT && !discovered.has(neighborCoord)) {
                const neighborTile = gameGrid[ny]?.[nx];
                if (neighborTile && neighborTile.type === 'land') {
                    discovered.add(neighborCoord);
                    discoveryQueue.push({ x: nx, y: ny, dist: current.dist + 1 });
                    if (neighborTile.owner !== botId) { 
                       cellsToConsider.push({ 
                           x: nx, y: ny, dist: current.dist + 1, 
                           cost: calculateTileConquestCost(neighborTile.subType), 
                           subType: neighborTile.subType 
                       });
                    }
                }
            }
        }
    }
    cellsToConsider.sort((a,b) => (a.dist === b.dist) ? a.cost - b.cost : a.dist - b.dist);
    for (const cell of cellsToConsider) {
        const tile = gameGrid[cell.y][cell.x];
        if (tile.owner === botId || tile.type === 'sea') continue;
        if ((troopsToCommit - actualTroopsSpent) >= cell.cost) {
            if (tile.owner !== null && tile.owner !== botId) { /* Logica nemico */ }
            tile.owner = botId;
            tile.color = bot.color;
            actualTroopsSpent += cell.cost;
            tilesClaimed++;
        }
    }
    if (tilesClaimed > 0) {
        bot.troops -= actualTroopsSpent;
        console.log(`[Server AI] Bot ${botId} ha speso ${actualTroopsSpent} per ${tilesClaimed} celle. Rimanenti: ${bot.troops}`);
        return true;
    }
    return false;
}

setInterval(() => {
    if (gameState !== 'active') return; 
    let gridChangedByBots = false;
    for (const playerId in players) {
        if (players.hasOwnProperty(playerId) && players[playerId].isBot) {
            const bot = players[playerId];
            if (!bot.capital) {
                if (botAttemptClaimFirstTile(bot.id)) gridChangedByBots = true;
            } else {
                if (Math.random() < 0.85) { 
                    if (botAttemptExpansion(bot.id)) gridChangedByBots = true;
                }
            }
            bot.lastActionTime = Date.now();
        }
    }
    if (gridChangedByBots) broadcastGridUpdate();
}, BOT_AI_INTERVAL);

setInterval(() => { 
    if (gameState !== 'active') return; 
    for (const playerId in players) {
        if (players.hasOwnProperty(playerId)) {
            const player = players[playerId];
            const numOwnedTiles = countPlayerTiles(playerId);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            player.troops += troopsGenerated;
            if (!player.isBot) { 
                io.to(playerId).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
            }
        }
    }
}, TROOP_INCREASE_INTERVAL);

io.on('connection', (socket) => { 
    console.log(`[Server] Nuovo giocatore UMANO connesso: ${socket.id}`);
    players[socket.id] = { 
        id: socket.id, 
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'), 
        troops: INITIAL_TROOPS, 
        capital: null,
        isBot: false 
    };
    sendPlayerDetails(socket.id, players[socket.id]); 
    
    for (const existingPlayerId in players) {
        if (existingPlayerId !== socket.id) {
            sendPlayerDetails(socket.id, players[existingPlayerId]);
        }
    }
    broadcastPlayerDetails(players[socket.id]);


    socket.emit('updatePlayerStats', { troops: players[socket.id].troops, troopsPerInterval: BASE_TROOPS_PER_INTERVAL });
    socket.emit('updateGrid', gameGrid); 
    
    if (gameState === 'active') {
        socket.emit('gameStarted');
    } else {
        socket.emit('lobbyState');
    }


    socket.on('requestStartGame', () => {
        if (Object.values(players).filter(p => !p.isBot).length === 0 && gameState === 'lobby') {
             console.warn("[Server] Tentativo di avviare partita senza giocatori umani connessi.");
             return;
        }
        if (gameState === 'lobby') {
            console.log(`[Server] Giocatore ${socket.id} ha richiesto l'inizio della partita.`);
            startGameProcedure();
        } else {
            socket.emit('errorOccurred', 'La partita è già iniziata o in uno stato non valido.');
        }
    });

    socket.on('playerReady', (data) => { 
        const player = players[socket.id];
        if (!player || player.isBot) return;
        if (data && data.color) player.color = data.color;
        sendPlayerDetails(socket.id, player);
        broadcastPlayerDetails(player);
    });

    socket.on('claimFirstTile', (data) => { 
        if (gameState !== 'active') return socket.emit('errorOccurred', 'La partita non è attiva.');
        const player = players[socket.id];
        if (!player || player.isBot) return socket.emit('errorOccurred', 'Azione non permessa.');
        if (player.capital) return socket.emit('errorOccurred', 'Hai già una capitale!');
        const { x, y } = data;
        if (!(x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT && gameGrid[y]?.[x])) {
            return socket.emit('errorOccurred', 'Coordinate non valide.');
        }
        const tile = gameGrid[y][x];
        if (tile.type === 'sea') return socket.emit('errorOccurred', 'Non puoi fondare la capitale sul mare!');
        if (tile.owner !== null) return socket.emit('errorOccurred', 'Questa cella è già occupata.');
        const actualCostInitialTile = calculateTileConquestCost(tile.subType); 
        if (player.troops < actualCostInitialTile) {
            return socket.emit('errorOccurred', `Non abbastanza truppe per la capitale su ${tile.subType || 'terra'} (Costo: ${actualCostInitialTile}).`);
        }
        player.troops -= actualCostInitialTile;
        tile.owner = socket.id;
        tile.color = player.color;
        player.capital = { x, y };
        console.log(`[Server] Giocatore ${socket.id} ha fondato la capitale a (${x},${y}) su ${tile.subType}.`);
        sendPlayerDetails(socket.id, player);
        broadcastPlayerDetails(player);
        broadcastGridUpdate();
        const numOwnedTiles = countPlayerTiles(socket.id);
        const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
        io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
    });

    socket.on('startCircularExpansion', (data) => { 
        if (gameState !== 'active') return socket.emit('errorOccurred', 'La partita non è attiva.');
        const player = players[socket.id];
        if (!player || player.isBot) return socket.emit('errorOccurred', 'Azione non permessa.');
        if (!player.capital) return socket.emit('errorOccurred', 'Fonda prima una capitale!');
        const { troopsCommitted } = data;
        if (!Number.isInteger(troopsCommitted) || troopsCommitted <= 0 || player.troops < troopsCommitted) {
            return socket.emit('errorOccurred', player.troops < troopsCommitted ? 'Truppe totali insufficienti.' : 'Truppe impegnate non valide.');
        }
        let actualTroopsSpentInExpansion = 0;
        let tilesSuccessfullyClaimedThisTurn = 0;
        const cellsToConsider = []; 
        const discoveryQueue = [{ x: player.capital.x, y: player.capital.y, dist: 0 }];
        const discovered = new Set([`${player.capital.x},${player.capital.y}`]);
        let dHead = 0;
        while(dHead < discoveryQueue.length){
            const current = discoveryQueue[dHead++];
            const currentTileServer = gameGrid[current.y]?.[current.x];
            if (!currentTileServer) continue;
            const directions = [ { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 } ];
            for (const dir of directions) {
                const nx = current.x + dir.dx;
                const ny = current.y + dir.dy;
                const neighborCoord = `${nx},${ny}`;
                if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT && !discovered.has(neighborCoord)) {
                    const neighborTile = gameGrid[ny]?.[nx];
                    if (neighborTile && neighborTile.type === 'land') { 
                        discovered.add(neighborCoord);
                        discoveryQueue.push({ x: nx, y: ny, dist: current.dist + 1 });
                        if (neighborTile.owner !== socket.id) {
                           cellsToConsider.push({ x: nx, y: ny, dist: current.dist + 1, cost: calculateTileConquestCost(neighborTile.subType), subType: neighborTile.subType });
                        }
                    }
                }
            }
        }
        cellsToConsider.sort((a, b) => (a.dist === b.dist) ? a.cost - b.cost : a.dist - b.dist);
        for (const cellToClaim of cellsToConsider) {
            const tile = gameGrid[cellToClaim.y][cellToClaim.x];
            if (tile.owner === socket.id || tile.type === 'sea') continue; 
            if ((troopsCommitted - actualTroopsSpentInExpansion) >= cellToClaim.cost) {
                tile.owner = socket.id;
                tile.color = player.color;
                actualTroopsSpentInExpansion += cellToClaim.cost;
                tilesSuccessfullyClaimedThisTurn++;
            }
        }
        if (tilesSuccessfullyClaimedThisTurn > 0) {
            player.troops -= actualTroopsSpentInExpansion;
            broadcastGridUpdate();
            const numOwnedTiles = countPlayerTiles(socket.id);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
        } else { socket.emit('errorOccurred', 'Nessuna cella conquistata.'); }
    });

    socket.on('changePlayerColor', (data) => { 
        const player = players[socket.id];
        if (!player || player.isBot) return;
        if (data.newColor) { 
            player.color = data.newColor;
            sendPlayerDetails(socket.id, player);
            broadcastPlayerDetails(player);
            let gridChanged = false;
            for (let y = 0; y < GRID_HEIGHT; y++) {
                for (let x = 0; x < GRID_WIDTH; x++) {
                    if (gameGrid[y][x].owner === socket.id && gameGrid[y][x].type === 'land') {
                        gameGrid[y][x].color = player.color;
                        gridChanged = true;
                    }
                }
            }
            if (gridChanged) broadcastGridUpdate();
        }
    });
    socket.on('disconnect', (data) => { 
        const player = players[socket.id];
        if (!player) return; 
        console.log(`[Server] Giocatore ${player.isBot ? 'BOT' : 'UMANO'} ${socket.id} disconnesso.`);
        let changed = false;
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (gameGrid[y]?.[x]?.owner === socket.id) {
                    gameGrid[y][x].owner = null;
                    gameGrid[y][x].color = gameGrid[y][x].baseColor; 
                    changed = true;
                }
            }
        }
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id); 
        if (changed) broadcastGridUpdate();
    });

    socket.on('sendMessage', (message) => {
        const player = players[socket.id];
        if (player && message && message.trim().length > 0) {
            let name = '??';
            if (player.isBot) {
                const nameParts = player.id.split('_');
                if (nameParts.length > 1) {
                    name = nameParts[1];
                }
            } else if(player.id) {
                name = player.id.substring(0, 5);
            }

            const sanitizedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");

            io.emit('newMessage', {
                sender: name,
                color: player.color,
                message: sanitizedMessage
            });
        }
    });
});

server.listen(PORT, () => {
    initializeGame(); 
    console.log(`[Server] Server in ascolto sulla porta ${PORT}. Stato gioco: ${gameState}`);
});

app.get('/', (req, res) => { res.send(`<h1>Server Gioco Territoriale (v14)</h1><p>Stato Gioco: ${gameState}</p>`); });
