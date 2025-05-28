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
const GRID_WIDTH = 50; 
const GRID_HEIGHT = 35; 
const DEFAULT_CELL_COLOR = '#2D3748'; 

const INITIAL_TROOPS = 50;
const TROOP_INCREASE_INTERVAL = 2000; // ms
const BASE_TROOPS_PER_INTERVAL = 1;
const TILES_PER_EXTRA_TROOP = 4; 

const COST_PER_INITIAL_TILE = 10; 
const COST_PER_TILE_DURING_EXPANSION = 5;

let gameGrid = [];
let players = {}; // { socketId: { id, color, troops, capital: {x, y} | null } }

function initializeGrid() {
    gameGrid = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            row.push({ owner: null, color: DEFAULT_CELL_COLOR });
        }
        gameGrid.push(row);
    }
    console.log("Griglia di gioco inizializzata.");
}

function broadcastGridUpdate() {
    io.emit('updateGrid', gameGrid);
}

function countPlayerTiles(playerId) {
    let count = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (gameGrid[y]?.[x]?.owner === playerId) count++;
        }
    }
    return count;
}

// Funzione Helper per inviare i dettagli del giocatore
function sendPlayerDetails(socketId) {
    const player = players[socketId];
    if (player) {
        const detailsToSend = {
            id: player.id,
            color: player.color,
            capital: player.capital // Assicurati che capital sia sempre presente, anche se null
        };
        console.log(`[Server] Invio 'assignPlayerDetails' a ${socketId}:`, JSON.stringify(detailsToSend));
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
    
    // Inizializza il giocatore con capital: null
    players[socket.id] = {
        id: socket.id,
        color: initialColor,
        troops: INITIAL_TROOPS,
        capital: null // Esplicitamente null
    };

    sendPlayerDetails(socket.id); // Invia i dettagli iniziali (con capital: null)

    socket.emit('updatePlayerStats', { 
        troops: players[socket.id].troops,
        troopsPerInterval: BASE_TROOPS_PER_INTERVAL 
    });
    socket.emit('updateGrid', gameGrid); 

    socket.on('playerReady', (data) => { 
        const player = players[socket.id];
        if (!player) return;
        console.log(`[Server] Giocatore ${socket.id} è pronto con colore: ${data.color || player.color}`);
        if (data && data.color) player.color = data.color;
        sendPlayerDetails(socket.id); // Invia di nuovo i dettagli se il colore è cambiato
    });

    socket.on('claimFirstTile', (data) => {
        const player = players[socket.id];
        console.log(`[Server] Ricevuto 'claimFirstTile' da ${socket.id} per cella (${data.x}, ${data.y})`);

        if (!player) {
            console.log(`[Server] Errore claimFirstTile: Giocatore ${socket.id} non trovato.`);
            return socket.emit('errorOccurred', 'Giocatore non trovato.');
        }
        if (player.capital) {
            console.log(`[Server] Errore claimFirstTile: Giocatore ${socket.id} ha già una capitale.`);
            return socket.emit('errorOccurred', 'Hai già una capitale!');
        }
        
        const { x, y } = data;
        if (!(x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT && gameGrid[y]?.[x])) {
            console.log(`[Server] Errore claimFirstTile: Coordinate non valide (${x},${y}).`);
            return socket.emit('errorOccurred', 'Coordinate non valide.');
        }
        
        const tile = gameGrid[y][x];
        if (tile.owner !== null) {
            console.log(`[Server] Errore claimFirstTile: Cella (${x},${y}) già occupata da ${tile.owner}.`);
            return socket.emit('errorOccurred', 'Questa cella è già occupata.');
        }
        if (player.troops < COST_PER_INITIAL_TILE) {
            console.log(`[Server] Errore claimFirstTile: Truppe insufficienti per ${socket.id}. (Ha: ${player.troops}, Costo: ${COST_PER_INITIAL_TILE})`);
            return socket.emit('errorOccurred', `Non abbastanza truppe per la capitale (Costo: ${COST_PER_INITIAL_TILE}).`);
        }

        player.troops -= COST_PER_INITIAL_TILE;
        tile.owner = socket.id;
        tile.color = player.color;
        player.capital = { x, y }; // Imposta la capitale

        console.log(`[Server] Giocatore ${socket.id} ha fondato la capitale a (${x},${y}). Truppe rimanenti: ${player.troops}`);
        
        sendPlayerDetails(socket.id); // CRUCIALE: Invia i dettagli aggiornati CON la nuova capitale

        broadcastGridUpdate();
        const numOwnedTiles = countPlayerTiles(socket.id);
        const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
        io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
    });


    socket.on('startCircularExpansion', (data) => {
        const player = players[socket.id];
        console.log(`[Server] Ricevuto 'startCircularExpansion' da ${socket.id} con ${data.troopsCommitted} truppe.`);

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
             return socket.emit('errorOccurred', `Truppe impegnate (${troopsCommitted}) insufficienti per conquistare anche una sola cella (costo: ${COST_PER_TILE_DURING_EXPANSION}).`);
        }

        let actualTroopsSpentInExpansion = 0;
        let tilesSuccessfullyClaimedThisTurn = 0;
        const cellsToClaim = []; 
        const discoveryQueue = [{ x: player.capital.x, y: player.capital.y, dist: 0 }];
        const discovered = new Set([`${player.capital.x},${player.capital.y}`]);
        let dHead = 0;

        while(dHead < discoveryQueue.length){
            const current = discoveryQueue[dHead++];
            if ((current.x !== player.capital.x || current.y !== player.capital.y) && 
                gameGrid[current.y]?.[current.x]?.owner !== socket.id) {
                 if(gameGrid[current.y]?.[current.x]?.owner === null || gameGrid[current.y]?.[current.x]?.owner !== socket.id){
                    cellsToClaim.push(current);
                 }
            }
            const directions = [ { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 } ];
            for (const dir of directions) {
                const nx = current.x + dir.dx;
                const ny = current.y + dir.dy;
                const neighborCoord = `${nx},${ny}`;
                if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT && !discovered.has(neighborCoord)) {
                    discovered.add(neighborCoord);
                    discoveryQueue.push({ x: nx, y: ny, dist: current.dist + 1 });
                }
            }
        }
        cellsToClaim.sort((a, b) => a.dist - b.dist);

        for (const cellToConquer of cellsToClaim) {
            if (tilesSuccessfullyClaimedThisTurn >= maxCellsToConquerBasedOnCommitment) break;
            const tile = gameGrid[cellToConquer.y][cellToConquer.x];
            if (tile.owner === socket.id) continue; 
            let costForThisTile = COST_PER_TILE_DURING_EXPANSION;
            if ((troopsCommitted - actualTroopsSpentInExpansion) >= costForThisTile) {
                if (tile.owner !== null && tile.owner !== socket.id) { 
                    console.log(`[Server] Giocatore ${socket.id} sta conquistando una cella nemica di ${tile.owner} a (${cellToConquer.x}, ${cellToConquer.y})`);
                }
                tile.owner = socket.id;
                tile.color = player.color;
                actualTroopsSpentInExpansion += costForThisTile;
                tilesSuccessfullyClaimedThisTurn++;
            } else {
                break;
            }
        }

        if (tilesSuccessfullyClaimedThisTurn > 0) {
            player.troops -= actualTroopsSpentInExpansion; 
            console.log(`[Server] Giocatore ${socket.id} ha speso ${actualTroopsSpentInExpansion} truppe per conquistare ${tilesSuccessfullyClaimedThisTurn} celle. Rimanenti: ${player.troops}`);
            broadcastGridUpdate();
            const numOwnedTiles = countPlayerTiles(socket.id);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
        } else {
            socket.emit('errorOccurred', 'Nessuna cella conquistata (truppe impegnate insufficienti o nessuna cella valida trovata).');
        }
    });

    socket.on('changePlayerColor', (data) => {
        const player = players[socket.id];
        if (!player) return;
        if (data.newColor) {
            player.color = data.newColor;
            console.log(`[Server] Giocatore ${socket.id} ha cambiato colore in ${data.newColor}`);
            sendPlayerDetails(socket.id); // Invia dettagli aggiornati (include il nuovo colore e la capitale esistente)
            
            let gridChanged = false;
            for (let y = 0; y < GRID_HEIGHT; y++) {
                for (let x = 0; x < GRID_WIDTH; x++) {
                    if (gameGrid[y][x].owner === socket.id) {
                        gameGrid[y][x].color = player.color;
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
                    gameGrid[y][x].color = DEFAULT_CELL_COLOR;
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
    res.send('<h1>Server del Gioco Territoriale Attivo (v6)</h1><p>Connettiti tramite client Socket.IO.</p>');
});
