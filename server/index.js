const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const MinesweeperGame = require('./gameLogic');
const { generateNextRow } = require('./infiniteLogic');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // A restreindre en prod
    methods: ["GET", "POST"]
  }
});

const games = {}; // stocke les instances de jeu par roomId

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', ({ mode, difficulty, hp }) => {
      const roomId = uuidv4().substring(0, 6).toUpperCase();
      
      // Presets de difficulté updated for higher density
      let rows = 16, cols = 16, mines = 40;
      if (difficulty === 'easy') { rows = 9; cols = 9; mines = 12; } // Was 10
      if (difficulty === 'medium') { rows = 16; cols = 16; mines = 50; } // Was 40
      if (difficulty === 'hard') { rows = 16; cols = 30; mines = 110; } // Was 99
      if (difficulty === 'hardcore') { rows = 20; cols = 35; mines = 150; } // New Hardcore

      // Création d'une nouvelle partie with difficulty passed to constructor
      games[roomId] = new MinesweeperGame(rows, cols, mines, mode || 'classic', hp || 3, difficulty);
      games[roomId].initializeEmptyGrid();
      
      socket.join(roomId);
      socket.emit('room_created', roomId);
      
      // Send initial game state to creator immediately so they can play solo
      socket.emit('init_game', { 
            grid: games[roomId].grid, 
            hp: games[roomId].hp,
            rows: games[roomId].rows,
            cols: games[roomId].cols,
            mines: games[roomId].minesCount, // Re-added
            role: 'P1'
      });
  });
  
  socket.on('join_room', (roomId) => {
    if (games[roomId]) {
        socket.join(roomId);
        
        // Determine player role based on room size (simple heuristic)
        const room = io.sockets.adapter.rooms.get(roomId);
        const playerCount = room ? room.size : 0;
        const role = playerCount === 1 ? 'P1' : 'P2'; 
        
        // Emitting init_game
        socket.emit('init_game', { 
            grid: games[roomId].grid, 
            hp: games[roomId].hp,
            rows: games[roomId].rows,
            cols: games[roomId].cols,
            mines: games[roomId].minesCount, // Re-added
            role: 'P2' 
        });
    } else {
        socket.emit('error', 'Room not found');
    }
  });

  socket.on('leave_room', (roomId) => {
      socket.leave(roomId);
  });

  socket.on('cursor_move', ({ x, y, roomId, role }) => {
    // Relayer la position et le role aux autres joueurs
    socket.to(roomId).emit('partner_cursor', { 
      id: socket.id, 
      x, y,
      role
    });
  });

  socket.on('cursor_leave', ({ roomId }) => {
    socket.to(roomId).emit('partner_leave', { id: socket.id });
  });

  socket.on('flag_cell', ({ x, y, roomId }) => {
    const game = games[roomId];
    if (!game) return;
    if (game.hp <= 0) return;

    const cell = game.toggleFlag(x, y);
    if (cell) {
        io.to(roomId).emit('update_grid', [cell]);
    }
  });

  socket.on('click_cell', ({ x, y, roomId }) => {
    const game = games[roomId];
    if (!game) return;
    if (game.hp <= 0) return; // Prevent moves if dead

    const wasGenerated = game.isGenerated;
    const result = game.processClick(x, y); // Vérifie mine, calcule cascade...
    
    if (wasGenerated !== game.isGenerated) {
        io.to(roomId).emit('update_mines', { mines: game.minesCount });
    }
    
    if (result.hitMine) {
       // Gestion des HP partagés 
       game.hp -= 1;
       io.to(roomId).emit('explosion', { x, y, hp: game.hp });
       if (game.hp <= 0) io.to(roomId).emit('game_over');
    } else {
       io.to(roomId).emit('update_grid', result.changes);
       
       // Check for Win / Level Complete
       if (game.checkWin()) {
           if (game.mode === 'hardcore') {
               // Infinite Mode Logic
               if (!games[roomId].score) games[roomId].score = 0;
               games[roomId].score += 1;
               
               // Prepare next level
               const lastRow = game.grid[game.rows - 1];
               game.initializeNextLevel(lastRow);
               
               // Emit Level Complete event with new grid and score
               // We include 'mines' because generation might change it (though logic says consistent, roughening might vary)
               // Actually initializeNextLevel resets generation, so mines will be 0 until first click?
               // game.initializeNextLevel sets isGenerated = false.
               // So new grid is empty (except row 0).
               // Frontend should display this.
               io.to(roomId).emit('level_complete', { 
                   grid: game.grid, 
                   score: games[roomId].score,
                   mines: game.minesCount // This is target count
               });
           } else {
               // Classic Win (Optional, just clear for now or simple alert)
               io.to(roomId).emit('game_win');
           }
       }
    }
  });

  socket.on('restart_game', ({ roomId, mode, difficulty, hp }) => {
    if (!games[roomId]) return;

    let rows = 16, cols = 16, mines = 40;
    if (difficulty === 'easy') { rows = 9; cols = 9; mines = 12; }
    if (difficulty === 'medium') { rows = 16; cols = 16; mines = 50; }
    if (difficulty === 'hard') { rows = 16; cols = 30; mines = 110; }
    if (difficulty === 'hardcore') { rows = 20; cols = 35; mines = 150; }

    games[roomId] = new MinesweeperGame(rows, cols, mines, mode || 'classic', hp || 3, difficulty);
    games[roomId].initializeEmptyGrid();

    io.to(roomId).emit('init_game', {
        grid: games[roomId].grid, 
        hp: games[roomId].hp,
        rows: games[roomId].rows,
        cols: games[roomId].cols,
        mines: games[roomId].minesCount // Re-added
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
