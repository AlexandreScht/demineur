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

  socket.on('create_room', async ({ mode, difficulty, hp, pseudo, rows, cols, mines, scansAvailable, allowLying, lyingChance }) => {
      const roomId = uuidv4().substring(0, 6).toUpperCase();
      
      // Presets de difficulté updated for higher density
      let dRows = 16, dCols = 16, dMines = 50;
      let dScans = 0;
      let dAllowLying = false;
      let dLyingChance = 12.5;

      if (difficulty === 'custom') {
          dRows = rows || 16;
          dCols = cols || 16;
          dMines = mines || 50;
          dScans = scansAvailable || 0;
          dAllowLying = !!allowLying;
          dLyingChance = lyingChance || 12.5;
      }
      if (difficulty === 'easy') { dRows = 10; dCols = 10; dMines = 15; } // Was 10
      if (difficulty === 'medium') { dRows = 16; dCols = 16; dMines = 50; } // Was 40
      if (difficulty === 'hard') { dRows = 16; dCols = 30; dMines = 110; } // Was 99
      if (difficulty === 'hardcore') { dRows = 20; dCols = 35; dMines = 150; } // New Hardcore

      // Création d'une nouvelle partie with difficulty passed to constructor
      games[roomId] = new MinesweeperGame(dRows, dCols, dMines, mode || 'classic', hp || 3, difficulty, dScans, dAllowLying, dLyingChance);
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

  socket.on('restart_game', ({ roomId, mode, difficulty, hp, rows, cols, mines, scansAvailable, allowLying, lyingChance }) => {
    if (!games[roomId]) return;

    const oldGame = games[roomId];
    // Use provided params OR fallback to existing game settings
    const safeMode = mode || oldGame.mode || 'classic';
    const safeDiff = difficulty || oldGame.difficulty || 'medium';
    const safeHp = hp || oldGame.hp || 3;

    let dRows = 16, dCols = 16, dMines = 40;
    let dScans = 0;
    let dAllowLying = false;
    let dLyingChance = 12.5;

    if (safeDiff === 'custom') {
        dRows = rows || oldGame.rows;
        dCols = cols || oldGame.cols;
        dMines = mines || oldGame.initialMinesCount || oldGame.minesCount;
        dScans = scansAvailable !== undefined ? scansAvailable : (oldGame.customScans || 0);
        dAllowLying = allowLying !== undefined ? allowLying : (oldGame.allowLying || false);
        dLyingChance = lyingChance !== undefined ? lyingChance : (oldGame.lyingChance || 12.5);
    }
    if (safeDiff === 'easy') { dRows = 9; dCols = 9; dMines = 12; }
    if (safeDiff === 'medium') { dRows = 16; dCols = 16; dMines = 50; }
    if (safeDiff === 'hard') { dRows = 16; dCols = 30; dMines = 110; }
    if (safeDiff === 'hardcore') { dRows = 20; dCols = 35; dMines = 150; }

    games[roomId] = new MinesweeperGame(dRows, dCols, dMines, safeMode, safeHp, safeDiff, dScans, dAllowLying, dLyingChance);
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
