# 🗺️ MiddleLands

A real-time multiplayer browser-based territory conquest game inspired by [openfronts.io](https://openfronts.io).  
Built with Node.js, Socket.IO and HTML5 Canvas.

---

## 🎮 Gameplay

Players compete to conquer as many land tiles as possible on a procedurally generated world map.  
Each terrain type has a different troop cost, and troops regenerate over time based on the territory you control.  
AI bots populate the world from the start, expanding their territory autonomously.

**Core loop:**
1. Choose your starting capital on a land tile
2. Commit troops to expand your territory outward from your capital
3. Earn more troops per interval the more land you hold
4. Conquer neutral and enemy tiles — mountains cost more, plains are cheap

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Server framework | Express |
| Real-time communication | Socket.IO (WebSocket) |
| Client rendering | HTML5 Canvas API |
| UI styling | Tailwind CSS (CDN) |

---

## ✨ Features

- **Procedural map generation** — Perlin-like noise with multiple octaves, cosine interpolation and cellular smoothing. Each session generates a unique world with seas, beaches, plains, forests, mountains and snow peaks
- **Real-time multiplayer** — WebSocket-based architecture; all game state lives on the server and is broadcast to all clients on every update
- **Bot AI** — Server-side bots use BFS (Breadth-First Search) to discover and prioritize expansion targets by distance and terrain cost
- **Terrain cost system** — Different terrain types carry different conquest costs (plains ×1.0, forest ×1.75, mountain ×3.0, snow peak ×4.0)
- **Troop economy** — Troop generation scales with territory size, rewarding aggressive expansion
- **Interactive camera** — Pan and zoom on the canvas; minimap for global overview
- **Color customization** — Players can pick their territory color in real time

---

## 🗺️ Terrain Types

| Terrain | Conquest Cost Multiplier |
|---|---|
| Beach | ×1.0 |
| Plains | ×1.0 |
| Forest | ×1.75 |
| Mountain | ×3.0 |
| Snow Peak | ×4.0 |
| Sea | ∞ (impassable) |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18+

### Installation

```bash
# Clone the repository
git clone https://github.com/DavideDelli/middleLands.git
cd middleLands

# Install dependencies
npm install

# Start the server
node Server.js
```

Then open your browser at `http://localhost:3000/client` (or serve `Client.html` directly).

---

## 📁 Project Structure

```
middleLands/
├── Server.js        # Game server: map generation, game logic, bot AI, Socket.IO events
├── Client.html      # Single-page game client: canvas rendering, camera, UI
└── package.json     # Node.js dependencies
```

---

## 🤖 Bot AI

Bots are spawned server-side at game start and act independently every 5 seconds.  
Their decision loop:
1. If no capital → find a free land tile and claim it
2. If capital exists → run BFS from capital to discover reachable tiles
3. Sort candidates by distance, then by terrain cost
4. Spend 30–70% of available troops on the cheapest reachable tiles

---

## 🔧 Configuration

Key constants in `Server.js`:

```js
const GRID_WIDTH = 300;               // Map width in tiles
const GRID_HEIGHT = 180;              // Map height in tiles
const INITIAL_TROOPS = 150;           // Starting troops for each player/bot
const TROOP_INCREASE_INTERVAL = 2000; // Troop regeneration tick (ms)
const BASE_TROOPS_PER_INTERVAL = 2;   // Base troop income per tick
const TILES_PER_EXTRA_TROOP = 8;      // Tiles needed to earn +1 troop/tick
const NUMBER_OF_BOTS = 3;             // Number of AI bots per session
const BOT_AI_INTERVAL = 5000;         // Bot decision interval (ms)
```

---

## 🔮 Roadmap

- [ ] Player vs player direct combat (troop-based attacks)
- [ ] Persistent leaderboard
- [ ] Mobile touch support
- [ ] Refactor client into modular JS files
- [ ] Named rooms / lobby system

---

## 👤 Author

**Davide Delli** — Computer Engineering student @ Università degli Studi di Bergamo  
[GitHub](https://github.com/DavideDelli)

---

## 📄 License

This project is open source. Feel free to fork and experiment.
