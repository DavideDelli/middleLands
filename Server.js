// server.js
// Import moduli necessari
const express = require('express');
const http = require('http');
const { Server } = require("socket.io"); // Importa Server da socket.io
const cors = 'cors'; // Questo non è il modo corretto di importare cors, lo correggerò dopo

// --- Configurazione Iniziale ---
const app = express();
const server = http.createServer(app);

// Configurazione CORS - IMPORTANTE per permettere al client (su un'altra porta/dominio) di connettersi
// Il client HTML viene solitamente aperto come file:// o su un server di sviluppo live (es. porta 5500)
// mentre il nostro server Node.js sarà su un'altra porta (es. 3000).
const io = new Server(server, {
    cors: {
        origin: "*", // Permette connessioni da qualsiasi origine. Per produzione, dovresti restringerlo.
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- Logica di Gioco del Server ---
const GRID_WIDTH = 30;
const GRID_HEIGHT = 20;
const DEFAULT_CELL_COLOR = '#2D3748'; // Colore di sfondo delle celle vuote

let gameGrid = []; // Array 2D per memorizzare lo stato della griglia [y][x]
let players = {}; // Oggetto per memorizzare i dettagli dei giocatori { socketId: { id, color, score... } }

// Inizializza la griglia di gioco
function initializeGrid() {
    gameGrid = []; // Resetta la griglia
    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            row.push({ owner: null, color: DEFAULT_CELL_COLOR }); // Nessun proprietario, colore di default
        }
        gameGrid.push(row);
    }
    console.log("Griglia di gioco inizializzata.");
}

// Funzione per inviare l'intera griglia a tutti i client
function broadcastGridUpdate() {
    io.emit('updateGrid', gameGrid);
}

// --- Gestione Connessioni Socket.IO ---
io.on('connection', (socket) => {
    console.log(`Nuovo giocatore connesso: ${socket.id}`);

    // Inizializza il giocatore
    // Scegli un colore casuale per il nuovo giocatore se non specificato
    const initialColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    players[socket.id] = {
        id: socket.id,
        color: initialColor,
        // Aggiungi altre proprietà del giocatore qui (punteggio, ecc.)
    };

    // Invia i dettagli al nuovo giocatore (ID e colore)
    socket.emit('assignPlayerDetails', players[socket.id]);
    
    // Invia la griglia corrente al nuovo giocatore
    socket.emit('updateGrid', gameGrid);
    
    // Informa il client che è pronto (se il client invia 'playerReady')
    socket.on('playerReady', (data) => {
        console.log(`Giocatore ${socket.id} è pronto con colore: ${data.color}`);
        if (data && data.color) {
            players[socket.id].color = data.color;
            socket.emit('assignPlayerDetails', players[socket.id]); // Riconferma colore
        }
        // Potresti voler inviare un messaggio di benvenuto o altre info qui
    });


    // Gestione evento 'claimTile' (quando un giocatore clicca una cella)
    socket.on('claimTile', (data) => {
        const { x, y } = data;
        const player = players[socket.id];

        if (!player) {
            socket.emit('errorOccurred', 'Giocatore non trovato.');
            return;
        }
        
        const playerColor = player.color; // Usa il colore memorizzato del giocatore

        if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
            // Logica di conquista semplice: il giocatore conquista la cella
            // Potresti aggiungere logica più complessa (es. solo celle adiacenti, costo, ecc.)
            if (gameGrid[y] && gameGrid[y][x]) {
                gameGrid[y][x].owner = socket.id;
                gameGrid[y][x].color = playerColor;
                console.log(`Giocatore ${socket.id} ha conquistato la cella (${x}, ${y}) con colore ${playerColor}`);
                broadcastGridUpdate(); // Invia la griglia aggiornata a tutti
            } else {
                 socket.emit('errorOccurred', 'Cella non valida o errore di sistema.');
                 console.error(`Errore: tentativo di accesso a gameGrid[${y}][${x}] fallito.`);
            }
        } else {
            socket.emit('errorOccurred', 'Coordinate della cella non valide.');
            console.warn(`Tentativo di conquista cella non valida: (${x},${y}) da ${socket.id}`);
        }
    });

    // Gestione cambio colore giocatore
    socket.on('changePlayerColor', (data) => {
        if (players[socket.id] && data.newColor) {
            players[socket.id].color = data.newColor;
            console.log(`Giocatore ${socket.id} ha cambiato colore in ${data.newColor}`);
            // Invia conferma al giocatore che ha cambiato colore
            socket.emit('playerColorUpdated', { playerId: socket.id, newColor: data.newColor });
            // Potresti voler aggiornare le celle già possedute dal giocatore con il nuovo colore
            // e poi fare un broadcastGridUpdate(). Per ora, solo le nuove celle avranno il nuovo colore.
        } else {
            socket.emit('errorOccurred', 'Impossibile cambiare colore.');
        }
    });

    // Gestione disconnessione
    socket.on('disconnect', () => {
        console.log(`Giocatore disconnesso: ${socket.id}`);
        delete players[socket.id]; // Rimuovi il giocatore dall'elenco
        // Potresti voler gestire la rimozione dei territori del giocatore disconnesso
        // o renderli neutrali. Per ora, i territori rimangono colorati.
        // Esempio: rendi neutrali le celle del giocatore disconnesso
        /*
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (gameGrid[y][x].owner === socket.id) {
                    gameGrid[y][x].owner = null;
                    gameGrid[y][x].color = DEFAULT_CELL_COLOR;
                }
            }
        }
        broadcastGridUpdate(); // Aggiorna tutti se hai cambiato le celle
        */
    });
});

// Avvio del server
server.listen(PORT, () => {
    initializeGrid(); // Inizializza la griglia quando il server parte
    console.log(`Server in ascolto sulla porta ${PORT}`);
    console.log(`Accessibile da http://localhost:${PORT} (anche se non serve una pagina qui)`);
    console.log(`Il client HTML (il file .html) dovrebbe connettersi a questo server.`);
});

// Endpoint di base per testare se il server è attivo (opzionale)
app.get('/', (req, res) => {
    res.send('<h1>Server del Gioco Territoriale Attivo</h1><p>Connettiti tramite client Socket.IO.</p>');
});
