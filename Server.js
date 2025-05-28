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
const GRID_WIDTH = 300; 
const GRID_HEIGHT = 180;

const SEA_COLOR = '#3B82F6';
const DEEP_SEA_COLOR = '#2563EB'; 
const SHALLOW_SEA_COLOR = '#60A5FA';
const BEACH_COLOR = '#FDE68A';      
const PLAINS_COLOR = '#84CC16';     
const FOREST_COLOR = '#15803D';     
const MOUNTAIN_COLOR = '#6B7280';   
const SNOW_PEAK_COLOR = '#F9FAFB';  

const INITIAL_TROOPS = 150;
const TROOP_INCREASE_INTERVAL = 2000; 
const BASE_TROOPS_PER_INTERVAL = 2;
const TILES_PER_EXTRA_TROOP = 8; 

const COST_PER_INITIAL_TILE = 15; 
const BASE_EXPANSION_COST_PER_TILE = 4; 

const TERRAIN_COST_MODIFIERS = {
    'beach': 1.0, 'plains': 1.0, 'forest': 1.75, 
    'mountain': 3.0, 'snow_peak': 4.0,
    'deep_sea': Infinity, 'shallow_sea': Infinity
};

let gameGrid = [];
let players = {};

// --- Generazione Mappa Procedurale Migliorata ---
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

function simpleNoise2D(x, y, randomGrid, octaveGridWidth, octaveGridHeight) {
    const gridCellWidth = GRID_WIDTH / octaveGridWidth; // Usa GRID_WIDTH/HEIGHT globali
    const gridCellHeight = GRID_HEIGHT / octaveGridHeight;
    const x_int = Math.floor(x / gridCellWidth);
    const y_int = Math.floor(y / gridCellHeight);
    const x_frac = (x / gridCellWidth) - x_int;
    const y_frac = (y / gridCellHeight) - y_int;
    
    const rgH = randomGrid.length;
    const rgW = randomGrid[0].length;

    const y0 = y_int % rgH;
    const x0 = x_int % rgW;
    const y1 = (y_int + 1) % rgH;
    const x1 = (x_int + 1) % rgW;

    const v1 = randomGrid[y0][x0];
    const v2 = randomGrid[y0][x1];
    const v3 = randomGrid[y1][x0];
    const v4 = randomGrid[y1][x1];
    
    const i1 = interpolate(v1, v2, x_frac);
    const i2 = interpolate(v3, v4, x_frac);
    return interpolate(i1, i2, y_frac);
}

function generatePerlinLikeMap() {
    let baseNoiseMap = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0));
    let totalAmplitudeBase = 0;
    const basePersistence = 0.6;
    const baseOctaves = 4; 
    const baseInitialFrequencyFactor = Math.min(GRID_WIDTH, GRID_HEIGHT) / 8; 

    for (let octave = 0; octave < baseOctaves; octave++) {
        const frequency = Math.pow(2, octave);
        const amplitude = Math.pow(basePersistence, octave);
        totalAmplitudeBase += amplitude;
        const octaveGridWidth = Math.max(2, Math.floor(GRID_WIDTH / (frequency * baseInitialFrequencyFactor)));
        const octaveGridHeight = Math.max(2, Math.floor(GRID_HEIGHT / (frequency * baseInitialFrequencyFactor)));
        const randomGrid = generateRandomGrid(octaveGridWidth, octaveGridHeight);
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                baseNoiseMap[y][x] += simpleNoise2D(x, y, randomGrid, octaveGridWidth, octaveGridHeight) * amplitude;
            }
        }
    }
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            baseNoiseMap[y][x] /= totalAmplitudeBase;
        }
    }

    let mapLayout = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill('s'));
    const primarySeaLevel = 0.48; 
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (baseNoiseMap[y][x] > primarySeaLevel) {
                mapLayout[y][x] = 'l';
            }
        }
    }

    const cleanupPasses = 3; 
    for (let pass = 0; pass < cleanupPasses; pass++) {
        let changesMadeFill = true;
        while(changesMadeFill){
            changesMadeFill = false;
            for (let y = 1; y < GRID_HEIGHT - 1; y++) {
                for (let x = 1; x < GRID_WIDTH - 1; x++) {
                    if (mapLayout[y][x] === 's') {
                        let landNeighbors = 0;
                        if (mapLayout[y-1][x] === 'l') landNeighbors++;
                        if (mapLayout[y+1][x] === 'l') landNeighbors++;
                        if (mapLayout[y][x-1] === 'l') landNeighbors++;
                        if (mapLayout[y][x+1] === 'l') landNeighbors++;
                        if (landNeighbors >= 3) { 
                            mapLayout[y][x] = 'l';
                            changesMadeFill = true;
                        }
                    }
                }
            }
        }
        let changesMadeRemove = true;
        while(changesMadeRemove){
            changesMadeRemove = false;
            for (let y = 1; y < GRID_HEIGHT - 1; y++) {
                for (let x = 1; x < GRID_WIDTH - 1; x++) {
                    if (mapLayout[y][x] === 'l') {
                        let seaNeighbors = 0;
                        if (mapLayout[y-1][x] === 's') seaNeighbors++;
                        if (mapLayout[y+1][x] === 's') seaNeighbors++;
                        if (mapLayout[y][x-1] === 's') seaNeighbors++;
                        if (mapLayout[y][x+1] === 's') seaNeighbors++;
                        if (seaNeighbors >= 3) { 
                            mapLayout[y][x] = 's';
                            changesMadeRemove = true;
                        }
                    }
                }
            }
        }
    }
    
    let detailNoiseMap = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0));
    let totalAmplitudeDetail = 0;
    const detailPersistence = 0.5;
    const detailOctaves = 5;
    const detailInitialFrequencyFactor = Math.min(GRID_WIDTH, GRID_HEIGHT) / 30; 

    for (let octave = 0; octave < detailOctaves; octave++) {
        const frequency = Math.pow(2, octave);
        const amplitude = Math.pow(detailPersistence, octave);
        totalAmplitudeDetail += amplitude;
        const octaveGridWidth = Math.max(2, Math.floor(GRID_WIDTH / (frequency * detailInitialFrequencyFactor)));
        const octaveGridHeight = Math.max(2, Math.floor(GRID_HEIGHT / (frequency * detailInitialFrequencyFactor)));
        const randomGrid = generateRandomGrid(octaveGridWidth, octaveGridHeight);
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (mapLayout[y][x] === 'l') { 
                    detailNoiseMap[y][x] += simpleNoise2D(x, y, randomGrid, octaveGridWidth, octaveGridHeight) * amplitude;
                }
            }
        }
    }
     for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (mapLayout[y][x] === 'l') {
                detailNoiseMap[y][x] /= totalAmplitudeDetail;
            }
        }
    }

    let finalMapStructure = [];
    const beachLevel = 0.15; 
    const plainsLevel = 0.45;
    const forestLevel = 0.70;
    const mountainLevel = 0.90;

    for (let y = 0; y < GRID_HEIGHT; y++) {
        finalMapStructure[y] = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            let type, subType, color;
            if (mapLayout[y][x] === 's') {
                if (baseNoiseMap[y][x] < primarySeaLevel * 0.65) { 
                    type = 'sea'; subType = 'deep_sea'; color = DEEP_SEA_COLOR;
                } else {
                    type = 'sea'; subType = 'shallow_sea'; color = SHALLOW_SEA_COLOR;
                }
            } else { 
                type = 'land';
                const terrainVal = detailNoiseMap[y][x];
                if (terrainVal < beachLevel) { subType = 'beach'; color = BEACH_COLOR; }
                else if (terrainVal < plainsLevel) { subType = 'plains'; color = PLAINS_COLOR; }
                else if (terrainVal < forestLevel) { subType = 'forest'; color = FOREST_COLOR; }
                else if (terrainVal < mountainLevel) { subType = 'mountain'; color = MOUNTAIN_COLOR; }
                else { subType = 'snow_peak'; color = SNOW_PEAK_COLOR; }
            }
            finalMapStructure[y][x] = { type, subType, baseColor: color };
        }
    }
    return finalMapStructure;
}

function calculateTileConquestCost(subType) { 
    if (!subType || TERRAIN_COST_MODIFIERS[subType] === undefined) {
        return BASE_EXPANSION_COST_PER_TILE; 
    }
    const modifier = TERRAIN_COST_MODIFIERS[subType];
    return Math.ceil(BASE_EXPANSION_COST_PER_TILE * modifier);
}

function initializeGrid() { 
    const generatedMap = generatePerlinLikeMap();
    gameGrid = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            row.push({
                owner: null,
                color: generatedMap[y][x].baseColor,
                type: generatedMap[y][x].type,
                subType: generatedMap[y][x].subType, 
                baseColor: generatedMap[y][x].baseColor
            });
        }
        gameGrid.push(row);
    }
    console.log(`[Server] Griglia ${GRID_WIDTH}x${GRID_HEIGHT} inizializzata con mappa planetaria migliorata.`);
}

function broadcastGridUpdate() { io.emit('updateGrid', gameGrid); }
function countPlayerTiles(playerId) {
    let count = 0;
    for (let r of gameGrid) for (let cell of r) if (cell.owner === playerId && cell.type === 'land') count++;
    return count;
}
function sendPlayerDetails(socketId) {
    const player = players[socketId];
    if (player) io.to(socketId).emit('assignPlayerDetails', { id: player.id, color: player.color, capital: player.capital });
}

setInterval(() => { 
    for (const playerId in players) {
        if (players.hasOwnProperty(playerId)) {
            const player = players[playerId];
            const numOwnedTiles = countPlayerTiles(playerId);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            player.troops += troopsGenerated;
            io.to(playerId).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
        }
    }
}, TROOP_INCREASE_INTERVAL);

io.on('connection', (socket) => { 
    console.log(`[Server] Nuovo giocatore connesso: ${socket.id}`);
    const initialColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    players[socket.id] = { id: socket.id, color: initialColor, troops: INITIAL_TROOPS, capital: null };
    sendPlayerDetails(socket.id);
    socket.emit('updatePlayerStats', { troops: players[socket.id].troops, troopsPerInterval: BASE_TROOPS_PER_INTERVAL });
    socket.emit('updateGrid', gameGrid);
    socket.on('playerReady', (data) => { 
        const player = players[socket.id];
        if (!player) return;
        if (data && data.color) player.color = data.color;
        sendPlayerDetails(socket.id);
    });

    socket.on('claimFirstTile', (data) => { 
        const player = players[socket.id];
        if (!player) return socket.emit('errorOccurred', 'Giocatore non trovato.');
        if (player.capital) return socket.emit('errorOccurred', 'Hai già una capitale!');
        const { x, y } = data;
        if (!(x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT && gameGrid[y]?.[x])) {
            return socket.emit('errorOccurred', 'Coordinate non valide.');
        }
        const tile = gameGrid[y][x];
        if (tile.type === 'sea') return socket.emit('errorOccurred', 'Non puoi fondare la capitale sul mare!');
        if (tile.owner !== null) return socket.emit('errorOccurred', 'Questa cella è già occupata.');
        
        let actualCostInitialTile = COST_PER_INITIAL_TILE; 
        if (tile.subType && TERRAIN_COST_MODIFIERS[tile.subType]) { 
             actualCostInitialTile = Math.ceil(COST_PER_INITIAL_TILE * TERRAIN_COST_MODIFIERS[tile.subType]);
        }

        if (player.troops < actualCostInitialTile) {
            return socket.emit('errorOccurred', `Non abbastanza truppe per la capitale su ${tile.subType || 'terreno sconosciuto'} (Costo: ${actualCostInitialTile}).`);
        }
        player.troops -= actualCostInitialTile;
        tile.owner = socket.id;
        tile.color = player.color;
        player.capital = { x, y };
        console.log(`[Server] Giocatore ${socket.id} ha fondato la capitale a (${x},${y}) su ${tile.subType}.`);
        sendPlayerDetails(socket.id);
        broadcastGridUpdate();
        const numOwnedTiles = countPlayerTiles(socket.id);
        const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
        io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
    });

    socket.on('startCircularExpansion', (data) => { 
        const player = players[socket.id];
        if (!player || !player.capital) return socket.emit('errorOccurred', player ? 'Fonda prima una capitale!' : 'Giocatore non trovato.');
        const { troopsCommitted } = data;
        if (!Number.isInteger(troopsCommitted) || troopsCommitted <= 0 || player.troops < troopsCommitted) {
            return socket.emit('errorOccurred', player.troops < troopsCommitted ? 'Truppe totali insufficienti.' : 'Truppe impegnate non valide.');
        }
        console.log(`[Server DEBUG ${socket.id}] Inizio Espansione. Truppe Impegnate: ${troopsCommitted}. Truppe Totali Player: ${player.troops}`);

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
                        if (neighborTile.owner !== socket.id) { // Solo se non è già nostra
                           cellsToConsider.push({ 
                               x: nx, y: ny, 
                               dist: current.dist + 1, 
                               cost: calculateTileConquestCost(neighborTile.subType), 
                               subType: neighborTile.subType 
                           });
                        }
                    }
                }
            }
        }
        
        console.log(`[Server DEBUG ${socket.id}] Celle candidate prima del sort: ${cellsToConsider.length}`);
        // cellsToConsider.forEach(c => console.log(`[Server DEBUG ${socket.id}] Candidata (pre-sort): (${c.x},${c.y}) Dist: ${c.dist}, Costo: ${c.cost}, Tipo: ${c.subType}`));


        cellsToConsider.sort((a, b) => {
            if (a.dist === b.dist) return a.cost - b.cost; 
            return a.dist - b.dist; 
        });
        
        console.log(`[Server DEBUG ${socket.id}] Celle candidate dopo il sort: ${cellsToConsider.length}`);
        // cellsToConsider.slice(0, 10).forEach(c => console.log(`[Server DEBUG ${socket.id}] Candidata (post-sort, top 10): (${c.x},${c.y}) Dist: ${c.dist}, Costo: ${c.cost}, Tipo: ${c.subType}`));


        for (const cellToClaim of cellsToConsider) {
            const tile = gameGrid[cellToClaim.y][cellToClaim.x];
            // Ricontrolla owner perché potrebbe essere stato conquistato in un precedente giro di questo stesso loop
            // se la logica di "break" non fosse perfetta o se ci fossero più celle con stesso costo/dist.
            if (tile.owner === socket.id || tile.type === 'sea') continue; 

            console.log(`[Server DEBUG ${socket.id}] Considero cella (${cellToClaim.x},${cellToClaim.y}), Tipo: ${cellToClaim.subType}, Costo: ${cellToClaim.cost}. Truppe Rimaste Impegnate: ${troopsCommitted - actualTroopsSpentInExpansion}`);

            if ((troopsCommitted - actualTroopsSpentInExpansion) >= cellToClaim.cost) {
                tile.owner = socket.id;
                tile.color = player.color;
                actualTroopsSpentInExpansion += cellToClaim.cost;
                tilesSuccessfullyClaimedThisTurn++;
                console.log(`[Server DEBUG ${socket.id}] CONQUISTATA (${cellToClaim.x},${cellToClaim.y}). Speso: ${cellToClaim.cost}. Tot Speso Espansione: ${actualTroopsSpentInExpansion}. Celle Conquistate: ${tilesSuccessfullyClaimedThisTurn}`);
            } else {
                console.log(`[Server DEBUG ${socket.id}] NON CONQUISTATA (${cellToClaim.x},${cellToClaim.y}) - truppe impegnate insufficienti.`);
                // Se non possiamo permetterci questa cella, e la lista è ordinata per costo (a parità di distanza),
                // non potremo permetterci altre celle alla stessa distanza che costano di più.
                // E non potremo permetterci celle più distanti se costano uguale o di più.
                // Potremmo fare un break qui se siamo sicuri che non ci siano celle più economiche più avanti nella lista.
                // Per ora, continuiamo il ciclo per semplicità, ma potrebbe essere ottimizzato.
            }
        }

        if (tilesSuccessfullyClaimedThisTurn > 0) {
            player.troops -= actualTroopsSpentInExpansion;
            console.log(`[Server ${socket.id}] Espansione completata. Truppe totali spese: ${actualTroopsSpentInExpansion}. Celle totali conquistate: ${tilesSuccessfullyClaimedThisTurn}. Truppe giocatore rimanenti: ${player.troops}`);
            broadcastGridUpdate();
            const numOwnedTiles = countPlayerTiles(socket.id);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
        } else { 
            console.log(`[Server ${socket.id}] Nessuna cella conquistata in questa espansione.`);
            socket.emit('errorOccurred', 'Nessuna cella conquistata.'); 
        }
    });

    socket.on('changePlayerColor', (data) => { 
        const player = players[socket.id];
        if (!player) return;
        if (data.newColor) {
            player.color = data.newColor;
            sendPlayerDetails(socket.id);
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
        console.log(`[Server] Giocatore disconnesso: ${socket.id}`);
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
        if (changed) broadcastGridUpdate();
    });
});

server.listen(PORT, () => {
    initializeGrid();
    console.log(`[Server] Server in ascolto sulla porta ${PORT}`);
});

app.get('/', (req, res) => { res.send('<h1>Server del Gioco Territoriale Attivo (v11 - Debug Espansione)</h1>'); });

