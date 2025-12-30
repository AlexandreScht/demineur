const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const MinesweeperGame = require('./gameLogic');
const { db } = require('./db');
const { users } = require('./db/schema');
const { eq, lt, and, isNotNull } = require('drizzle-orm');

const app = express();
app.use(cors());

app.get('/', (req, res) => {

  
  res.send('Server is alive');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // A restreindre en prod
    methods: ["GET", "POST"]
  }
});

const games = {}; // stocke les instances de jeu par roomId

// Cleanup function for old games (older than 30 days)
async function cleanupOldGames() {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // 1. Recover inactive users with a room
        const inactiveUsers = await db.select()
            .from(users)
            .where(
                and(
                    lt(users.lastActive, thirtyDaysAgo),
                    isNotNull(users.currentRoomId)
                )
            );

        // 2. Cleanup memory
        if (inactiveUsers.length > 0) {
            console.log(`Cleaning up ${inactiveUsers.length} inactive games...`);
            inactiveUsers.forEach(user => {
                const roomId = user.currentRoomId;
                if (roomId && games[roomId]) {
                    delete games[roomId];
                    console.log(`Deleted game ${roomId} from memory (User: ${user.pseudo})`);
                }
            });
        }
        
        // 3. Update DB
        await db.update(users)
            .set({ currentRoomId: null })
            .where(lt(users.lastActive, thirtyDaysAgo));
            

    } catch (error) {
        console.error('Error cleaning up old games:', error);
    }
}

// Run cleanup on start and every 24 hours
cleanupOldGames();
setInterval(cleanupOldGames, 24 * 60 * 60 * 1000);

io.on('connection', (socket) => {


  socket.on('check_recovery', async (pseudo) => {
      if (!pseudo) return;
      try {
          // Normalize pseudo
          const normalizedPseudo = pseudo.toLowerCase();

          
          const user = await db.select().from(users).where(eq(users.pseudo, normalizedPseudo)).limit(1);

          
          if (user.length > 0 && user[0].currentRoomId) {
              const roomId = user[0].currentRoomId;
              
              if (games[roomId]) {
                  socket.emit('recovery_available', { 
                      roomId, 
                      mode: games[roomId].mode, 
                      difficulty: games[roomId].difficulty 
                  });
              } else {
              }
          } else {
          }
      } catch (error) {
          console.error('Error checking recovery:', error);
      }
  });

  socket.on('create_room', async ({ mode, difficulty, hp, pseudo }) => {
      const roomId = uuidv4().substring(0, 6).toUpperCase();
      
      // Presets de difficulté updated for higher density
      let rows = 16, cols = 16, mines = 40;
      if (difficulty === 'easy') { rows = 10; cols = 10; mines = 15; } // Was 10
      if (difficulty === 'medium') { rows = 16; cols = 16; mines = 50; } // Was 40
      if (difficulty === 'hard') { rows = 16; cols = 30; mines = 110; } // Was 99
      if (difficulty === 'hardcore') { rows = 20; cols = 35; mines = 150; } // New Hardcore

      // Création d'une nouvelle partie with difficulty passed to constructor
      games[roomId] = new MinesweeperGame(rows, cols, mines, mode || 'classic', hp || 3, difficulty);
      games[roomId].initializeEmptyGrid();
      
      // Save User to DB
      if (pseudo) {
          try {
              const normalizedPseudo = pseudo.toLowerCase();
              await db.insert(users).values({
                  pseudo: normalizedPseudo,
                  currentRoomId: roomId,
                  lastActive: new Date()
              }).onConflictDoUpdate({
                  target: users.pseudo,
                  set: { currentRoomId: roomId, lastActive: new Date() }
              });
          } catch(e) {
              console.error("DB Error:", e);
          }
      }

      socket.join(roomId);
      socket.emit('room_created', roomId);
      
      // Send initial game state to creator immediately so they can play solo
      socket.emit('init_game', { 
            grid: games[roomId].grid, 
            hp: games[roomId].hp,
            rows: games[roomId].rows,
            cols: games[roomId].cols,
            mines: games[roomId].minesCount, 
            scansAvailable: games[roomId].scansAvailable, // Scanner count
            role: 'P1',
            mode: games[roomId].mode,
            difficulty: games[roomId].difficulty
      });
  });
  
  socket.on('join_room', async (roomId, pseudo) => { // pseudo param optional
    if (games[roomId]) {
        socket.join(roomId);
        
        // Save User logic (update room ID for this user)
        if (pseudo) {
             try {
                const normalizedPseudo = pseudo.toLowerCase();
                await db.insert(users).values({
                    pseudo: normalizedPseudo,
                    currentRoomId: roomId,
                    lastActive: new Date()
                }).onConflictDoUpdate({
                    target: users.pseudo,
                    set: { currentRoomId: roomId, lastActive: new Date() }
                });
            } catch(e) {
                console.error("DB Error:", e);
            }
        }

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
            mines: games[roomId].minesCount, 
            scansAvailable: games[roomId].scansAvailable, // Scanner count
            role: role, // Use calculated role
            mode: games[roomId].mode,
            difficulty: games[roomId].difficulty
        });
    } else {
        socket.emit('error', 'Room not found');
    }
  });

  socket.on('leave_room', async (roomId, pseudo) => {
      socket.leave(roomId);
      if (pseudo) {
          try {
              const normalizedPseudo = pseudo.toLowerCase();
              await db.update(users)
                  .set({ currentRoomId: null })
                  .where(eq(users.pseudo, normalizedPseudo));
          } catch(e) {
              console.error("DB Error clearing room:", e);
          }
      }
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

  socket.on('scan_cell', ({ x, y, roomId }) => {
    const game = games[roomId];
    if (!game) return;
    if (game.hp <= 0) return;

    const result = game.scanCell(x, y);
    if (result) {
        // Emit updated grid cell (with scanned property) AND updated scan count
        io.to(roomId).emit('update_grid', [result.cell]);
        io.to(roomId).emit('update_scans', { scansAvailable: result.scansAvailable });
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
       if (game.hp <= 0) {
           // Reveal all mines
           const allMines = [];
           for(let r=0; r<game.rows; r++) {
               for(let c=0; c<game.cols; c++) {
                   if(game.grid[r][c].isMine) {
                       allMines.push({ ...game.grid[r][c], isOpen: true });
                   }
               }
           }
           io.to(roomId).emit('game_over', { mines: allMines });
       }
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
               io.to(roomId).emit('level_complete', { 
                   grid: game.grid, 
                   score: games[roomId].score,
                   mines: game.minesCount,
                   scansAvailable: game.scansAvailable // Reset to 1
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

    const oldGame = games[roomId];
    // Use provided params OR fallback to existing game settings
    const safeMode = mode || oldGame.mode || 'classic';
    const safeDiff = difficulty || oldGame.difficulty || 'medium';
    const safeHp = hp || oldGame.hp || 3;

    let rows = 16, cols = 16, mines = 40;
    if (safeDiff === 'easy') { rows = 9; cols = 9; mines = 12; }
    if (safeDiff === 'medium') { rows = 16; cols = 16; mines = 50; }
    if (safeDiff === 'hard') { rows = 16; cols = 30; mines = 110; }
    if (safeDiff === 'hardcore') { rows = 20; cols = 35; mines = 150; }

    games[roomId] = new MinesweeperGame(rows, cols, mines, safeMode, safeHp, safeDiff);
    games[roomId].initializeEmptyGrid();

    io.to(roomId).emit('init_game', {
        grid: games[roomId].grid, 
        hp: games[roomId].hp,
        rows: games[roomId].rows,
        rows: games[roomId].rows,
        cols: games[roomId].cols,
        mines: games[roomId].minesCount,
        scansAvailable: games[roomId].scansAvailable,
        mode: games[roomId].mode,
        difficulty: games[roomId].difficulty
    });
  });

  socket.on('disconnect', () => {

  });
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
