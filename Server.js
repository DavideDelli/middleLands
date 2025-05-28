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

// --- Configurazione Bot ---
const NUMBER_OF_BOTS = 3; // Numero di bot da aggiungere
const BOT_AI_INTERVAL = 5000; // Intervallo (ms) per le decisioni dei bot (5 secondi)
const BOT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
const BOT_COLORS = ["#FF6347", "#4682B4", "#32CD32", "#FFD700", "#6A5ACD", "#FF4500"]; // Tomato, SteelBlue, LimeGreen, Gold, SlateBlue, OrangeRed


let gameGrid = [];
let players = {}; // Ora può contenere sia giocatori umani che bot

// --- Generazione Mappa (invariata dalla v11) ---
function interpolate(a,b,t){const ft=t*Math.PI;const f=(1-Math.cos(ft))*0.5;return a*(1-f)+b*f}
function generateRandomGrid(w,h){let g=[];for(let y=0;y<h;y++){g[y]=[];for(let x=0;x<w;x++)g[y][x]=Math.random()}return g}
function simpleNoise2D(x,y,rg,ogw,ogh){const gcw=GRID_WIDTH/ogw;const gch=GRID_HEIGHT/ogh;const xi=Math.floor(x/gcw);const yi=Math.floor(y/gch);const xf=(x/gcw)-xi;const yf=(y/gch)-yi;const rH=rg.length;const rW=rg[0].length;const y0=yi%rH;const x0=xi%rW;const y1=(yi+1)%rH;const x1=(xi+1)%rW;const v1=rg[y0][x0];const v2=rg[y0][x1];const v3=rg[y1][x0];const v4=rg[y1][x1];const i1=interpolate(v1,v2,xf);const i2=interpolate(v3,v4,xf);return interpolate(i1,i2,yf)}
function generatePerlinLikeMap(){let bnm=Array(GRID_HEIGHT).fill(null).map(()=>Array(GRID_WIDTH).fill(0));let tab=0;const bp=0.6;const bo=4;const bif=Math.min(GRID_WIDTH,GRID_HEIGHT)/8;for(let o=0;o<bo;o++){const fr=Math.pow(2,o);const am=Math.pow(bp,o);tab+=am;const ogw=Math.max(2,Math.floor(GRID_WIDTH/(fr*bif)));const ogh=Math.max(2,Math.floor(GRID_HEIGHT/(fr*bif)));const rg=generateRandomGrid(ogw,ogh);for(let y=0;y<GRID_HEIGHT;y++)for(let x=0;x<GRID_WIDTH;x++)bnm[y][x]+=simpleNoise2D(x,y,rg,ogw,ogh)*am}for(let y=0;y<GRID_HEIGHT;y++)for(let x=0;x<GRID_WIDTH;x++)bnm[y][x]/=tab;let ml=Array(GRID_HEIGHT).fill(null).map(()=>Array(GRID_WIDTH).fill('s'));const psl=0.48;for(let y=0;y<GRID_HEIGHT;y++)for(let x=0;x<GRID_WIDTH;x++)if(bnm[y][x]>psl)ml[y][x]='l';const cp=3;for(let p=0;p<cp;p++){let cmf=!0;for(;cmf;){cmf=!1;for(let y=1;y<GRID_HEIGHT-1;y++)for(let x=1;x<GRID_WIDTH-1;x++)if(ml[y][x]==='s'){let ln=0;if(ml[y-1][x]==='l')ln++;if(ml[y+1][x]==='l')ln++;if(ml[y][x-1]==='l')ln++;if(ml[y][x+1]==='l')ln++;if(ln>=3){ml[y][x]='l';cmf=!0}}}let cmr=!0;for(;cmr;){cmr=!1;for(let y=1;y<GRID_HEIGHT-1;y++)for(let x=1;x<GRID_WIDTH-1;x++)if(ml[y][x]==='l'){let sn=0;if(ml[y-1][x]==='s')sn++;if(ml[y+1][x]==='s')sn++;if(ml[y][x-1]==='s')sn++;if(ml[y][x+1]==='s')sn++;if(sn>=3){ml[y][x]='s';cmr=!0}}}}let dnm=Array(GRID_HEIGHT).fill(null).map(()=>Array(GRID_WIDTH).fill(0));let tad=0;const dp=0.5;const dvo=5;const dif=Math.min(GRID_WIDTH,GRID_HEIGHT)/30;for(let o=0;o<dvo;o++){const fr=Math.pow(2,o);const am=Math.pow(dp,o);tad+=am;const ogw=Math.max(2,Math.floor(GRID_WIDTH/(fr*dif)));const ogh=Math.max(2,Math.floor(GRID_HEIGHT/(fr*dif)));const rg=generateRandomGrid(ogw,ogh);for(let y=0;y<GRID_HEIGHT;y++)for(let x=0;x<GRID_WIDTH;x++)if(ml[y][x]==='l')dnm[y][x]+=simpleNoise2D(x,y,rg,ogw,ogh)*am}for(let y=0;y<GRID_HEIGHT;y++)for(let x=0;x<GRID_WIDTH;x++)if(ml[y][x]==='l')dnm[y][x]/=tad;let fms=[];const bl=0.15;const pl=0.45;const fl=0.70;const mtl=0.90;for(let y=0;y<GRID_HEIGHT;y++){fms[y]=[];for(let x=0;x<GRID_WIDTH;x++){let ty,st,cl;if(ml[y][x]==='s'){if(bnm[y][x]<psl*0.65){ty='sea';st='deep_sea';cl=DEEP_SEA_COLOR}else{ty='sea';st='shallow_sea';cl=SHALLOW_SEA_COLOR}}else{ty='land';const tv=dnm[y][x];if(tv<bl){st='beach';cl=BEACH_COLOR}else if(tv<pl){st='plains';cl=PLAINS_COLOR}else if(tv<fl){st='forest';cl=FOREST_COLOR}else if(tv<mtl){st='mountain';cl=MOUNTAIN_COLOR}else{st='snow_peak';cl=SNOW_PEAK_COLOR}}fms[y][x]={type:ty,subType:st,baseColor:cl}}}return fms}


function calculateTileConquestCost(subType) { 
    if (!subType || TERRAIN_COST_MODIFIERS[subType] === undefined) return BASE_EXPANSION_COST_PER_TILE; 
    return Math.ceil(BASE_EXPANSION_COST_PER_TILE * TERRAIN_COST_MODIFIERS[subType]);
}

function initializeGrid() { 
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
    console.log(`[Server] Griglia ${GRID_WIDTH}x${GRID_HEIGHT} inizializzata.`);
    spawnBots(NUMBER_OF_BOTS); // Chiama la funzione per creare i bot
}

function broadcastGridUpdate() { io.emit('updateGrid', gameGrid); }
function countPlayerTiles(playerId) {
    let count = 0;
    for (let r of gameGrid) for (let cell of r) if (cell.owner === playerId && cell.type === 'land') count++;
    return count;
}
function sendPlayerDetails(socketId) { // Invia dettagli sia a giocatori che a bot (se avessero un socket)
    const player = players[socketId];
    if (player) {
        io.to(socketId).emit('assignPlayerDetails', { 
            id: player.id, 
            color: player.color, 
            capital: player.capital,
            isBot: player.isBot // Invia se è un bot
        });
    }
}

// --- Logica Bot ---
function spawnBots(numBots) {
    for (let i = 0; i < numBots; i++) {
        const botId = `Bot_${BOT_NAMES[i % BOT_NAMES.length]}_${i}`;
        const botColor = BOT_COLORS[i % BOT_COLORS.length];
        players[botId] = {
            id: botId,
            color: botColor,
            troops: INITIAL_TROOPS,
            capital: null,
            isBot: true,
            lastActionTime: 0 // Per temporizzare le azioni dei bot
        };
        console.log(`[Server] Creato Bot: ${botId} con colore ${botColor}`);
        // Il bot cercherà di fondare la capitale nel suo primo ciclo AI
    }
}

function botAttemptClaimFirstTile(botId) {
    const bot = players[botId];
    if (!bot || bot.capital) return false;

    // Cerca una cella di terra valida e non occupata
    let attempts = 0;
    const maxAttempts = GRID_WIDTH * GRID_HEIGHT / 10; // Limita i tentativi
    while (attempts < maxAttempts) {
        const x = Math.floor(Math.random() * GRID_WIDTH);
        const y = Math.floor(Math.random() * GRID_HEIGHT);
        const tile = gameGrid[y]?.[x];

        if (tile && tile.type === 'land' && tile.owner === null) {
            let cost = COST_PER_INITIAL_TILE;
            if (tile.subType && TERRAIN_COST_MODIFIERS[tile.subType]) {
                 cost = Math.ceil(COST_PER_INITIAL_TILE * TERRAIN_COST_MODIFIERS[tile.subType]);
            }
            if (bot.troops >= cost) {
                bot.troops -= cost;
                tile.owner = botId;
                tile.color = bot.color;
                bot.capital = { x, y };
                console.log(`[Server AI] Bot ${botId} ha fondato la capitale a (${x},${y}) su ${tile.subType}.`);
                return true; // Successo
            }
        }
        attempts++;
    }
    console.log(`[Server AI] Bot ${botId} non è riuscito a fondare una capitale.`);
    return false; // Fallimento
}

function botAttemptExpansion(botId) {
    const bot = players[botId];
    if (!bot || !bot.capital) return false;

    // Decisione semplice: espandi se hai abbastanza truppe (es. > 20% in più del costo di qualche cella)
    const minTroopsForExpansion = calculateTileConquestCost('plains') * 5; // Prova a conquistare almeno 5 pianure
    if (bot.troops < minTroopsForExpansion * 1.2) { // Deve avere un po' di margine
        // console.log(`[Server AI] Bot ${botId} ha poche truppe (${bot.troops}) per espandere.`);
        return false;
    }

    const troopsToCommit = Math.floor(bot.troops * (Math.random() * 0.4 + 0.3)); // Impegna 30-70% delle truppe

    // Logica di espansione (simile a quella del giocatore)
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
                    if (neighborTile.owner !== botId) { // Può essere neutra o di un altro
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
            // TODO: Gestire la conquista di celle nemiche (per ora, le sovrascrive)
            if (tile.owner !== null && tile.owner !== botId) {
                 console.log(`[Server AI] Bot ${botId} sta conquistando una cella di ${tile.owner} a (${cell.x},${cell.y})`);
            }
            tile.owner = botId;
            tile.color = bot.color;
            actualTroopsSpent += cell.cost;
            tilesClaimed++;
        }
    }

    if (tilesClaimed > 0) {
        bot.troops -= actualTroopsSpent;
        console.log(`[Server AI] Bot ${botId} ha speso ${actualTroopsSpent} truppe per ${tilesClaimed} celle. Rimanenti: ${bot.troops}`);
        return true;
    }
    return false;
}


// Ciclo AI dei Bot
setInterval(() => {
    let gridChangedByBots = false;
    for (const playerId in players) {
        if (players.hasOwnProperty(playerId) && players[playerId].isBot) {
            const bot = players[playerId];
            // console.log(`[Server AI] Turno del Bot ${bot.id}. Truppe: ${bot.troops}, Capitale: ${bot.capital ? 'Sì' : 'No'}`);

            if (!bot.capital) {
                if (botAttemptClaimFirstTile(bot.id)) {
                    gridChangedByBots = true;
                }
            } else {
                // Decisione casuale se espandere o attendere (semplice)
                if (Math.random() < 0.7) { // 70% probabilità di tentare espansione
                    if (botAttemptExpansion(bot.id)) {
                        gridChangedByBots = true;
                    }
                } else {
                    // console.log(`[Server AI] Bot ${bot.id} decide di attendere.`);
                }
            }
            bot.lastActionTime = Date.now();
        }
    }
    if (gridChangedByBots) {
        broadcastGridUpdate();
    }
}, BOT_AI_INTERVAL);


// Gestione Connessioni Giocatori Umani (invariata, ma sendPlayerDetails ora invia isBot)
setInterval(() => { 
    for (const playerId in players) {
        if (players.hasOwnProperty(playerId) && !players[playerId].isBot) { // Solo per giocatori umani
            const player = players[playerId];
            const numOwnedTiles = countPlayerTiles(playerId);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            player.troops += troopsGenerated;
            io.to(playerId).emit('updatePlayerStats', { troops: player.troops, troopsPerInterval: troopsGenerated });
        } else if (players.hasOwnProperty(playerId) && players[playerId].isBot) { // Aggiorna truppe bot (senza inviare stats)
            const bot = players[playerId];
            const numOwnedTiles = countPlayerTiles(bot.id);
            const troopsGenerated = BASE_TROOPS_PER_INTERVAL + Math.floor(numOwnedTiles / TILES_PER_EXTRA_TROOP);
            bot.troops += troopsGenerated;
        }
    }
}, TROOP_INCREASE_INTERVAL);


io.on('connection', (socket) => { 
    console.log(`[Server] Nuovo giocatore UMANO connesso: ${socket.id}`);
    const initialColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    players[socket.id] = { 
        id: socket.id, 
        color: initialColor, 
        troops: INITIAL_TROOPS, 
        capital: null,
        isBot: false // Giocatore umano
    };
    sendPlayerDetails(socket.id);
    socket.emit('updatePlayerStats', { troops: players[socket.id].troops, troopsPerInterval: BASE_TROOPS_PER_INTERVAL });
    socket.emit('updateGrid', gameGrid);

    socket.on('playerReady', (data) => { 
        const player = players[socket.id];
        if (!player || player.isBot) return;
        if (data && data.color) player.color = data.color;
        sendPlayerDetails(socket.id);
    });

    socket.on('claimFirstTile', (data) => { 
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
        const player = players[socket.id];
        if (!player) return; // Già disconnesso o non trovato
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
        if (changed) broadcastGridUpdate();
    });
});

server.listen(PORT, () => {
    initializeGrid(); // Questo ora chiamerà anche spawnBots
    console.log(`[Server] Server in ascolto sulla porta ${PORT}`);
});

app.get('/', (req, res) => { res.send('<h1>Server del Gioco Territoriale Attivo (v12 - Con Bot)</h1>'); });

