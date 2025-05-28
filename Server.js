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

// --- Logica di Gioco del Server ---
const GRID_WIDTH = 30;
const GRID_HEIGHT = 20;
const DEFAULT_CELL_COLOR = '#2D3748';

const INITIAL_TROOPS = 25; 
const TROOP_INCREASE_INTERVAL = 2500; // ms (2.5 secondi)
const BASE_TROOPS_PER_INTERVAL = 1;
const TILES_PER_EXTRA_TROOP = 3; // << MODIFICATO: Ora ogni 3 celle danno una truppa extra

const COST_PER_TILE_DURING_EXPANSION = 5; 

let gameGrid = [];
let players = {}; 

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

function isTileOwnedByPlayer(x, y, playerId) {
    return x >= 0 && x < GRID_WIDTH &&
           y >= 0 && y < GRID_HEIGHT &&
           gameGrid[y]?.[x]?.owner === playerId;
}

function hasAdjacentOwnedTile(targetX, targetY, playerId) {
    const directions = [ { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 } ];
    for (const dir of directions) {
        if (isTileOwnedByPlayer(targetX + dir.dx, targetY + dir.dy, playerId)) return true;
    }
    return false;
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
    console.log(`Nuovo giocatore connesso: ${socket.id}`);
    const initialColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    players[socket.id] = { id: socket.id, color: initialColor, troops: INITIAL_TROOPS };

    socket.emit('assignPlayerDetails', players[socket.id]);
    const numOwnedTiles = 0; 
    const initialTroopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
    // Invia subito le statistiche iniziali, inclusa la produzione
    socket.emit('updatePlayerStats', { troops: players[socket.id].troops, troopsPerInterval: initialTroopsGenerated });
    socket.emit('updateGrid', gameGrid);


    socket.on('playerReady', (data) => {
        console.log(`Giocatore ${socket.id} è pronto con colore: ${data.color || players[socket.id].color}`);
        if (data && data.color) players[socket.id].color = data.color;
        // Riconferma i dettagli dopo che il colore potrebbe essere cambiato
        socket.emit('assignPlayerDetails', players[socket.id]); 
        // Riconferma anche le stats che dipendono dai dettagli (anche se qui non cambiano solo per il colore)
        const currentOwnedTiles = countPlayerTiles(socket.id);
        const currentTroopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(currentOwnedTiles / TILES_PER_EXTRA_TROOP);
        socket.emit('updatePlayerStats', { troops: players[socket.id].troops, troopsPerInterval: currentTroopsGenerated });

    });

    socket.on('initiateExpansion', (data) => {
        const { x, y, troopsCommitted } = data;
        const player = players[socket.id];

        if (!player) {
            socket.emit('errorOccurred', 'Giocatore non trovato.');
            return;
        }
        if (!(x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT && gameGrid[y]?.[x])) {
            socket.emit('errorOccurred', 'Coordinate di partenza non valide.');
            return;
        }
        if (!Number.isInteger(troopsCommitted) || troopsCommitted <= 0) {
            socket.emit('errorOccurred', 'Numero di truppe da impegnare non valido.');
            return;
        }
        if (player.troops < troopsCommitted) {
            socket.emit('errorOccurred', `Non hai abbastanza truppe per impegnarne ${troopsCommitted}. (Hai: ${player.troops})`);
            return;
        }

        const startTile = gameGrid[y][x];
        const numPlayerTilesBeforeExpansion = countPlayerTiles(socket.id);

        if (startTile.owner === socket.id) {
            socket.emit('errorOccurred', 'Non puoi espanderti da una cella che già possiedi (scegli una cella neutrale/nemica adiacente).');
            return;
        }
        
        if (numPlayerTilesBeforeExpansion > 0 && !hasAdjacentOwnedTile(x, y, socket.id)) {
            socket.emit('errorOccurred', 'Puoi iniziare un\'espansione solo da una cella adiacente al tuo territorio.');
            return;
        }
        if (numPlayerTilesBeforeExpansion === 0 && startTile.owner !== null) {
            socket.emit('errorOccurred', 'La tua prima cella deve essere neutrale.');
            return;
        }

        let actualTroopsSpentInExpansion = 0;
        let tilesSuccessfullyClaimedThisTurn = 0;
        const queue = [{ex: x, ey: y}]; 
        const visitedInThisExpansion = new Set([`${x},${y}`]);
        let expansionPossible = true;

        if (startTile.owner !== socket.id && (troopsCommitted < COST_PER_TILE_DURING_EXPANSION)) {
             socket.emit('errorOccurred', `Non abbastanza truppe impegnate per la cella iniziale (costo: ${COST_PER_TILE_DURING_EXPANSION}).`);
             expansionPossible = false;
        }
        
        if (!expansionPossible) return;

        let head = 0;
        while(head < queue.length && actualTroopsSpentInExpansion < troopsCommitted) {
            const current = queue[head++];
            const currentTile = gameGrid[current.ey][current.ex];

            if (currentTile.owner !== socket.id) {
                let costForThisSpecificTile = COST_PER_TILE_DURING_EXPANSION;
                
                if ((troopsCommitted - actualTroopsSpentInExpansion) >= costForThisSpecificTile) {
                    if (currentTile.owner !== null && currentTile.owner !== socket.id) {
                        console.log(`Giocatore ${socket.id} sta conquistando una cella nemica di ${currentTile.owner} a (${current.ex}, ${current.ey})`);
                    }
                    currentTile.owner = socket.id;
                    currentTile.color = player.color;
                    actualTroopsSpentInExpansion += costForThisSpecificTile;
                    tilesSuccessfullyClaimedThisTurn++;
                } else {
                    continue; 
                }
            }
            
            if (actualTroopsSpentInExpansion < troopsCommitted) {
                const directions = [ { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 } ];
                for (const dir of directions) {
                    const nx = current.ex + dir.dx;
                    const ny = current.ey + dir.dy;
                    const neighborCoord = `${nx},${ny}`;

                    if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT && !visitedInThisExpansion.has(neighborCoord)) {
                        const neighborTile = gameGrid[ny][nx];
                        if (neighborTile.owner !== socket.id) { 
                            let costForNeighborTile = COST_PER_TILE_DURING_EXPANSION;
                            if ((troopsCommitted - actualTroopsSpentInExpansion) >= costForNeighborTile) {
                                visitedInThisExpansion.add(neighborCoord);
                                queue.push({ex: nx, ey: ny});
                            }
                        }
                    }
                }
            }
        }

        if (tilesSuccessfullyClaimedThisTurn > 0) {
            player.troops -= actualTroopsSpentInExpansion;
            console.log(`Giocatore ${socket.id} ha speso ${actualTroopsSpentInExpansion} truppe per conquistare ${tilesSuccessfullyClaimedThisTurn} celle. Rimanenti: ${player.troops}`);
            broadcastGridUpdate();
            const numOwnedTilesNow = countPlayerTiles(socket.id);
            const troopsGeneratedNow = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTilesNow / TILES_PER_EXTRA_TROOP);
            io.to(socket.id).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGeneratedNow });
        } else {
             if (expansionPossible) socket.emit('errorOccurred', 'Espansione fallita o nessuna cella conquistata.');
        }
    });

    socket.on('changePlayerColor', (data) => {
        if (players[socket.id] && data.newColor) {
            players[socket.id].color = data.newColor;
            console.log(`Giocatore ${socket.id} ha cambiato colore in ${data.newColor}`);
            socket.emit('playerColorUpdated', { playerId: socket.id, newColor: data.newColor });
            let changed = false;
            for(let r=0; r < GRID_HEIGHT; r++){
                for(let c=0; c < GRID_WIDTH; c++){
                    if(gameGrid[r][c].owner === socket.id){
                        gameGrid[r][c].color = data.newColor;
                        changed = true;
                    }
                }
            }
            if(changed) broadcastGridUpdate();
        } else {
            socket.emit('errorOccurred', 'Impossibile cambiare colore.');
        }
    });

    socket.on('disconnect', () => {
        console.log(`Giocatore disconnesso: ${socket.id}`);
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
    console.log(`Server in ascolto sulla porta ${PORT}`);
});

app.get('/', (req, res) => {
    res.send('<h1>Server del Gioco Territoriale Attivo (v4.1)</h1><p>Connettiti tramite client Socket.IO.</p>');
});
