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
const GRID_WIDTH = 200; // Drasticamente aumentata
const GRID_HEIGHT = 120; // Drasticamente aumentata
const DEFAULT_LAND_COLOR = '#A0A0A0'; 
const SEA_COLOR = '#3B82F6';         
const DEEP_SEA_COLOR = '#2563EB'; 
const SHALLOW_SEA_COLOR = '#60A5FA';
const BEACH_COLOR = '#FDE68A';
const PLAINS_COLOR = '#84CC16';
const FOREST_COLOR = '#15803D';
const MOUNTAIN_COLOR = '#6B7280';
const SNOW_PEAK_COLOR = '#F9FAFB';


const INITIAL_TROOPS = 100; // Aumentate per la mappa più grande
const TROOP_INCREASE_INTERVAL = 2000; 
const BASE_TROOPS_PER_INTERVAL = 2; // Leggermente aumentata
const TILES_PER_EXTRA_TROOP = 10; // Più territorio necessario per truppe extra

const COST_PER_INITIAL_TILE = 15; // Leggermente aumentato
const COST_PER_TILE_DURING_EXPANSION = 5;

let gameGrid = []; 
let players = {};

// --- Generazione Mappa Procedurale con Simil-Perlin Noise ---

// Funzione di interpolazione (es. cosine interpolation)
function interpolate(a, b, t) {
    const ft = t * Math.PI;
    const f = (1 - Math.cos(ft)) * 0.5;
    return a * (1 - f) + b * f;
}

// Genera una griglia di valori casuali (base per il noise)
function generateRandomGrid(width, height) {
    let grid = [];
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = Math.random(); // Valori tra 0 e 1
        }
    }
    return grid;
}

// Funzione Noise 2D Semplificata (Value Noise)
function simpleNoise2D(x, y, randomGrid, octaveGridWidth, octaveGridHeight) {
    const gridCellWidth = GRID_WIDTH / octaveGridWidth;
    const gridCellHeight = GRID_HEIGHT / octaveGridHeight;

    const x_int = Math.floor(x / gridCellWidth);
    const y_int = Math.floor(y / gridCellHeight);
    const x_frac = (x / gridCellWidth) - x_int;
    const y_frac = (y / gridCellHeight) - y_int;

    // Valori ai 4 angoli della cella della griglia di rumore
    const v1 = randomGrid[y_int % octaveGridHeight][x_int % octaveGridWidth];
    const v2 = randomGrid[y_int % octaveGridHeight][(x_int + 1) % octaveGridWidth];
    const v3 = randomGrid[(y_int + 1) % octaveGridHeight][x_int % octaveGridWidth];
    const v4 = randomGrid[(y_int + 1) % octaveGridHeight][(x_int + 1) % octaveGridWidth];

    // Interpolazione
    const i1 = interpolate(v1, v2, x_frac);
    const i2 = interpolate(v3, v4, x_frac);
    return interpolate(i1, i2, y_frac);
}

function generatePerlinLikeMap() {
    let noiseMap = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0));
    
    let totalAmplitude = 0;
    const persistence = 0.5; // Quanto l'ampiezza diminuisce per ogni ottava
    const numOctaves = 5;    // Numero di livelli di dettaglio

    for (let octave = 0; octave < numOctaves; octave++) {
        const frequency = Math.pow(2, octave);
        const amplitude = Math.pow(persistence, octave);
        totalAmplitude += amplitude;

        // Griglia di rumore più piccola per frequenze più basse (ottave iniziali)
        const octaveGridWidth = Math.max(2, Math.floor(GRID_WIDTH / (frequency * 8))); 
        const octaveGridHeight = Math.max(2, Math.floor(GRID_HEIGHT / (frequency * 8)));
        const randomGrid = generateRandomGrid(octaveGridWidth, octaveGridHeight);

        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                noiseMap[y][x] += simpleNoise2D(x * frequency / (GRID_WIDTH/octaveGridWidth) , y * frequency / (GRID_HEIGHT/octaveGridHeight), randomGrid, octaveGridWidth, octaveGridHeight) * amplitude;
            }
        }
    }

    // Normalizza la mappa di rumore (valori tra 0 e 1)
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            noiseMap[y][x] /= totalAmplitude;
        }
    }
    
    // Converti i valori di rumore in tipi di terreno e colori
    let finalMap = [];
    const seaLevel = 0.4;       // Valori sotto questo sono mare
    const beachLevel = 0.45;
    const plainsLevel = 0.6;
    const forestLevel = 0.75;
    const mountainLevel = 0.9;  // Valori sopra questo sono montagne/neve

    for (let y = 0; y < GRID_HEIGHT; y++) {
        finalMap[y] = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            const noiseVal = noiseMap[y][x];
            let type = 'sea';
            let color = SEA_COLOR;

            if (noiseVal < seaLevel * 0.7) { // Deep sea
                type = 'sea'; color = DEEP_SEA_COLOR;
            } else if (noiseVal < seaLevel) { // Shallow sea
                type = 'sea'; color = SHALLOW_SEA_COLOR;
            } else if (noiseVal < beachLevel) {
                type = 'land'; color = BEACH_COLOR; // Spiaggia
            } else if (noiseVal < plainsLevel) {
                type = 'land'; color = PLAINS_COLOR; // Pianura
            } else if (noiseVal < forestLevel) {
                type = 'land'; color = FOREST_COLOR; // Foresta
            } else if (noiseVal < mountainLevel) {
                type = 'land'; color = MOUNTAIN_COLOR; // Montagna
            } else {
                type = 'land'; color = SNOW_PEAK_COLOR; // Cime innevate
            }
            finalMap[y][x] = { type, baseColor: color }; // Memorizza il colore base del terreno
        }
    }
    return finalMap;
}


function initializeGrid() {
    const generatedMap = generatePerlinLikeMap(); 
    gameGrid = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            row.push({
                owner: null,
                color: generatedMap[y][x].baseColor, // Colore iniziale basato sul terreno
                type: generatedMap[y][x].type,
                baseColor: generatedMap[y][x].baseColor // Conserva il colore base
            });
        }
        gameGrid.push(row);
    }
    console.log("[Server] Griglia di gioco inizializzata con mappa Perlin-like.");
}

function broadcastGridUpdate() {
    io.emit('updateGrid', gameGrid);
}

function countPlayerTiles(playerId) {
    let count = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (gameGrid[y]?.[x]?.owner === playerId && gameGrid[y]?.[x]?.type === 'land') count++;
        }
    }
    return count;
}

function sendPlayerDetails(socketId) {
    const player = players[socketId];
    if (player) {
        const detailsToSend = { id: player.id, color: player.color, capital: player.capital };
        io.to(socketId).emit('assignPlayerDetails', detailsToSend);
    }
}

setInterval(() => {
    for (const playerId in players) {
        if (players.hasOwnProperty(playerId)) {
            const player = players[playerId];
            const numOwnedTiles = countPlayerTiles(playerId);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            player.troops += troopsGenerated;
            io.to(playerId).emit('updatePlayerStats', {
                troops: player.troops,
                troopsPerInterval: troopsGenerated
            });
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
        if (player.troops < COST_PER_INITIAL_TILE) {
            return socket.emit('errorOccurred', `Non abbastanza truppe per la capitale (Costo: ${COST_PER_INITIAL_TILE}).`);
        }
        player.troops -= COST_PER_INITIAL_TILE;
        tile.owner = socket.id;
        tile.color = player.color; // La capitale e le terre conquistate prendono il colore del giocatore
        player.capital = { x, y };
        console.log(`[Server] Giocatore ${socket.id} ha fondato la capitale a (${x},${y}).`);
        sendPlayerDetails(socket.id);
        broadcastGridUpdate();
        const numOwnedTiles = countPlayerTiles(socket.id);
        const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
        io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
    });

    socket.on('startCircularExpansion', (data) => {
        const player = players[socket.id];
        if (!player) return socket.emit('errorOccurred', 'Giocatore non trovato.');
        if (!player.capital) return socket.emit('errorOccurred', 'Devi prima fondare una capitale!');
        const { troopsCommitted } = data;
        if (!Number.isInteger(troopsCommitted) || troopsCommitted <= 0) {
            return socket.emit('errorOccurred', 'Numero di truppe da impegnare non valido.');
        }
        if (player.troops < troopsCommitted) {
            return socket.emit('errorOccurred', `Non hai abbastanza truppe per impegnarne ${troopsCommitted}. (Hai: ${player.troops})`);
        }
        const maxCellsToConquerBasedOnCommitment = Math.floor(troopsCommitted / COST_PER_TILE_DURING_EXPANSION);
        if (maxCellsToConquerBasedOnCommitment === 0) {
             return socket.emit('errorOccurred', `Truppe impegnate (${troopsCommitted}) insufficienti per conquistare (costo: ${COST_PER_TILE_DURING_EXPANSION}).`);
        }
        let actualTroopsSpentInExpansion = 0;
        let tilesSuccessfullyClaimedThisTurn = 0;
        const cellsToClaim = [];
        const discoveryQueue = [{ x: player.capital.x, y: player.capital.y, dist: 0 }];
        const discovered = new Set([`${player.capital.x},${player.capital.y}`]);
        let dHead = 0;
        while(dHead < discoveryQueue.length){
            const current = discoveryQueue[dHead++];
            const currentTile = gameGrid[current.y]?.[current.x];
            if (!currentTile) continue;
            if (currentTile.type === 'land' &&
                (current.x !== player.capital.x || current.y !== player.capital.y) &&
                currentTile.owner !== socket.id) {
                 if(currentTile.owner === null || currentTile.owner !== socket.id){ cellsToClaim.push(current); }
            }
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
                    }
                }
            }
        }
        cellsToClaim.sort((a, b) => a.dist - b.dist);
        for (const cellToConquer of cellsToClaim) {
            if (tilesSuccessfullyClaimedThisTurn >= maxCellsToConquerBasedOnCommitment) break;
            const tile = gameGrid[cellToConquer.y][cellToConquer.x];
            if (tile.owner === socket.id || tile.type === 'sea') continue;
            let costForThisTile = COST_PER_TILE_DURING_EXPANSION;
            if ((troopsCommitted - actualTroopsSpentInExpansion) >= costForThisTile) {
                if (tile.owner !== null && tile.owner !== socket.id) { /* Logica nemico */ }
                tile.owner = socket.id;
                tile.color = player.color; // Le terre conquistate prendono il colore del giocatore
                actualTroopsSpentInExpansion += costForThisTile;
                tilesSuccessfullyClaimedThisTurn++;
            } else { break; }
        }
        if (tilesSuccessfullyClaimedThisTurn > 0) {
            player.troops -= actualTroopsSpentInExpansion;
            broadcastGridUpdate();
            const numOwnedTiles = countPlayerTiles(socket.id);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
        } else { socket.emit('errorOccurred', 'Nessuna cella di terra conquistata.'); }
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
                        gameGrid[y][x].color = player.color; // Aggiorna colore delle terre possedute
                        gridChanged = true;
                    }
                }
            }
            if (gridChanged) broadcastGridUpdate();
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Server] Giocatore disconnesso: ${socket.id}`);
        let changed = false;
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (gameGrid[y]?.[x]?.owner === socket.id) {
                    gameGrid[y][x].owner = null;
                    gameGrid[y][x].color = gameGrid[y][x].baseColor; // Ripristina colore base del terreno
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

app.get('/', (req, res) => {
    res.send('<h1>Server del Gioco Territoriale Attivo (v9)</h1><p>Connettiti tramite client Socket.IO.</p>');
});