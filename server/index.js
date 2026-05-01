const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const MinesweeperGame = require('./gameLogic');
const { db, connect } = require('./db');
const { users, friendships } = require('./db/schema');
const { eq, lt, and, isNotNull, or } = require('drizzle-orm');

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

// Shared difficulty presets — keep create_room and restart_game in sync
function getDifficultyPreset(difficulty) {
    switch (difficulty) {
        case 'easy':     return { rows: 10, cols: 10, mines: 15 };
        case 'hard':     return { rows: 16, cols: 30, mines: 110 };
        case 'hardcore': return { rows: 20, cols: 35, mines: 150 };
        case 'medium':
        default:         return { rows: 16, cols: 16, mines: 50 };
    }
}

// === Tag generation (avoid 0/O/1/I to keep it readable) ===
const TAG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateTag() {
    let tag = '';
    for (let i = 0; i < 4; i++) {
        tag += TAG_ALPHABET[Math.floor(Math.random() * TAG_ALPHABET.length)];
    }
    return tag;
}

function sanitizePseudo(p) {
    return (typeof p === 'string' ? p.trim().slice(0, 32) : '');
}

function isValidAccount(acc) {
    return acc && typeof acc.pseudo === 'string' && acc.pseudo.length > 0
        && typeof acc.tag === 'string' && acc.tag.length === 4;
}

// === Presence + invites state (in-memory) ===
const accountSockets = new Map();           // accountKey -> Set<socketId>
const pendingJoinRequests = new Map();      // recipientKey -> Map<senderKey, { fromPseudo, fromTag, roomId, ts }>
const joinRequestRate = new Map();          // senderKey -> array<timestamp>
const pendingFriendRequests = new Map();    // recipientKey -> Map<senderKey, { fromPseudo, fromTag, ts }>
const friendRequestRate = new Map();        // senderKey -> array<timestamp>
const JOIN_REQ_WINDOW_MS = 30_000;
const JOIN_REQ_MAX_PER_WINDOW = 3;
const JOIN_REQ_TTL_MS = 60_000;
const FRIEND_REQ_WINDOW_MS = 60_000;
const FRIEND_REQ_MAX_PER_WINDOW = 5;

function accKey(p, t) { return `${p}#${t}`; }

function bindSocketToAccount(socket, pseudo, tag) {
    if (socket.userAccount) unbindSocket(socket);
    socket.userAccount = { pseudo, tag };
    const key = accKey(pseudo, tag);
    if (!accountSockets.has(key)) accountSockets.set(key, new Set());
    accountSockets.get(key).add(socket.id);
}

function unbindSocket(socket) {
    const acc = socket.userAccount;
    if (!acc) return;
    const key = accKey(acc.pseudo, acc.tag);
    const set = accountSockets.get(key);
    if (set) {
        set.delete(socket.id);
        if (set.size === 0) accountSockets.delete(key);
    }
    socket.userAccount = null;
}

function isOnline(pseudo, tag) {
    const set = accountSockets.get(accKey(pseudo, tag));
    return !!(set && set.size > 0);
}

// Build the public status payload for a given account, used by both
// fetch_friends and friend_status_update broadcasts.
async function buildFriendStatus(pseudo, tag) {
    try {
        const userRow = await db.select().from(users)
            .where(and(eq(users.pseudo, pseudo), eq(users.tag, tag)))
            .limit(1);

        if (userRow.length === 0) {
            return { pseudo, tag, online: false, inGame: false, gameMode: null, gameDifficulty: null, gameLevel: null, roomId: null, notFound: true };
        }

        const u = userRow[0];
        const online = isOnline(pseudo, tag);
        const hasLiveGame = !!(u.currentRoomId && games[u.currentRoomId]);
        // A user only counts as "in game" while they're connected. A stale DB
        // currentRoomId (left over from a disconnect) must not show as in game.
        const inGame = online && hasLiveGame;

        return {
            pseudo,
            tag,
            online,
            inGame,
            gameMode: inGame ? u.gameMode : null,
            gameDifficulty: inGame ? u.gameDifficulty : null,
            gameLevel: inGame ? u.gameLevel : null,
            roomId: inGame ? u.currentRoomId : null,
        };
    } catch (err) {
        console.error('buildFriendStatus error:', err);
        return { pseudo, tag, online: false, inGame: false, gameMode: null, gameDifficulty: null, gameLevel: null, roomId: null };
    }
}

// Insert a mutual friendship: A→B and B→A in a single shot, ignoring conflicts.
async function insertMutualFriendship(aP, aT, bP, bT) {
    const pairs = [
        { ownerPseudo: aP, ownerTag: aT, friendPseudo: bP, friendTag: bT },
        { ownerPseudo: bP, ownerTag: bT, friendPseudo: aP, friendTag: aT },
    ];
    for (const p of pairs) {
        try {
            await db.insert(friendships).values(p);
        } catch (err) {
            if (!err || err.code !== '23505') throw err;
        }
    }
}

// Notify everyone who has (pseudo, tag) in their friend list of a status change.
// Used so friends see game/online updates without waiting for the next 8s poll.
async function notifyFriendsAboutMe(pseudo, tag) {
    try {
        const status = await buildFriendStatus(pseudo, tag);
        const owners = await db.select().from(friendships)
            .where(and(eq(friendships.friendPseudo, pseudo), eq(friendships.friendTag, tag)));

        for (const f of owners) {
            const ownerKey = accKey(f.ownerPseudo, f.ownerTag);
            const sockets = accountSockets.get(ownerKey);
            if (!sockets || sockets.size === 0) continue;
            for (const sId of sockets) {
                io.to(sId).emit('friend_status_update', status);
            }
        }
    } catch (err) {
        console.error('notifyFriendsAboutMe error:', err);
    }
}

// Cleanup function for old games (older than 30 days)
async function cleanupOldGames() {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const inactiveUsers = await db.select()
            .from(users)
            .where(
                and(
                    lt(users.lastActive, thirtyDaysAgo),
                    isNotNull(users.currentRoomId)
                )
            );

        if (inactiveUsers.length > 0) {
            console.log(`Cleaning up ${inactiveUsers.length} inactive games...`);
            inactiveUsers.forEach(user => {
                const roomId = user.currentRoomId;
                if (roomId && games[roomId]) {
                    delete games[roomId];
                    console.log(`Deleted game ${roomId} from memory (User: ${user.pseudo}#${user.tag})`);
                }
            });
        }

        await db.update(users)
            .set({ currentRoomId: null, gameMode: null, gameDifficulty: null, gameLevel: null })
            .where(lt(users.lastActive, thirtyDaysAgo));

    } catch (error) {
        console.error('Error cleaning up old games:', error);
    }
}

cleanupOldGames();
setInterval(cleanupOldGames, 24 * 60 * 60 * 1000);

io.on('connection', (socket) => {

  // === Identify a returning visitor by localStorage token + fingerprint hash ===
  socket.on('identify_visitor', async ({ localStorageToken, fingerprintHash }) => {
      const token = typeof localStorageToken === 'string' ? localStorageToken.slice(0, 64) : null;
      const hash  = typeof fingerprintHash  === 'string' ? fingerprintHash.slice(0, 64)  : null;
      if (!token && !hash) return socket.emit('visitor_identified', { accounts: [] });

      try {
          const byToken = token
              ? await db.select({ pseudo: users.pseudo, tag: users.tag }).from(users)
                    .where(eq(users.localStorageToken, token))
              : [];

          const byHash = hash
              ? await db.select({ pseudo: users.pseudo, tag: users.tag }).from(users)
                    .where(eq(users.fingerprintHash, hash))
              : [];

          const seen = new Set();
          const found = [];
          for (const acc of [...byToken, ...byHash]) {
              const key = accKey(acc.pseudo, acc.tag);
              if (!seen.has(key)) {
                  seen.add(key);
                  found.push({ pseudo: acc.pseudo, tag: acc.tag });
              }
          }
          socket.emit('visitor_identified', { accounts: found });
      } catch (err) {
          console.error('identify_visitor error:', err);
          socket.emit('visitor_identified', { accounts: [] });
      }
  });

  // === Update fingerprint/token when a returning visitor selects an account ===
  socket.on('update_visitor_identity', async ({ pseudo, tag, fingerprintHash, localStorageToken }) => {
      if (!isValidAccount({ pseudo, tag })) return;
      const hash  = typeof fingerprintHash  === 'string' ? fingerprintHash.slice(0, 64)  : null;
      const token = typeof localStorageToken === 'string' ? localStorageToken.slice(0, 64) : null;
      if (!hash && !token) return;

      try {
          const rows = await db.select({ id: users.id, fingerprintHash: users.fingerprintHash, localStorageToken: users.localStorageToken })
              .from(users)
              .where(and(eq(users.pseudo, pseudo), eq(users.tag, tag)))
              .limit(1);
          if (rows.length === 0) return;

          const current = rows[0];
          const updates = {};
          if (hash  && current.fingerprintHash  !== hash)  updates.fingerprintHash  = hash;
          if (token && current.localStorageToken !== token) updates.localStorageToken = token;
          if (Object.keys(updates).length > 0) {
              updates.lastActive = new Date();
              await db.update(users).set(updates)
                  .where(and(eq(users.pseudo, pseudo), eq(users.tag, tag)));
          }
      } catch (err) {
          console.error('update_visitor_identity error:', err);
      }
  });

  // === Create a brand-new account: pseudo provided, tag generated server-side ===
  socket.on('create_account', async ({ pseudo, fingerprintHash, localStorageToken }) => {
      const cleanPseudo = sanitizePseudo(pseudo);
      if (!cleanPseudo) {
          return socket.emit('account_error', { reason: 'Pseudo cannot be empty' });
      }
      const hash  = typeof fingerprintHash  === 'string' ? fingerprintHash.slice(0, 64)  : null;
      const token = typeof localStorageToken === 'string' ? localStorageToken.slice(0, 64) : null;

      // Try a few tags until we find one that doesn't collide
      for (let attempt = 0; attempt < 10; attempt++) {
          const tag = generateTag();
          try {
              await db.insert(users).values({
                  pseudo: cleanPseudo,
                  tag,
                  fingerprintHash: hash,
                  localStorageToken: token,
                  lastActive: new Date()
              });
              return socket.emit('account_created', { pseudo: cleanPseudo, tag });
          } catch (err) {
              // 23505 = unique_violation in Postgres
              if (err && err.code === '23505') continue;
              console.error('Account creation error:', err);
              return socket.emit('account_error', { reason: 'Server error' });
          }
      }

      socket.emit('account_error', { reason: 'Could not allocate a unique tag, please retry' });
  });

  // === Fetch info (active game, mode, level) for the accounts saved in this browser ===
  socket.on('fetch_accounts_info', async (accountList) => {
      if (!Array.isArray(accountList) || accountList.length === 0) {
          return socket.emit('accounts_info', []);
      }

      const results = [];
      for (const acc of accountList) {
          if (!isValidAccount(acc)) continue;
          try {
              const rows = await db.select().from(users)
                  .where(and(eq(users.pseudo, acc.pseudo), eq(users.tag, acc.tag)))
                  .limit(1);

              if (rows.length === 0) {
                  // Account no longer exists in DB (e.g. cleaned up)
                  results.push({
                      pseudo: acc.pseudo,
                      tag: acc.tag,
                      currentRoomId: null,
                      gameMode: null,
                      gameDifficulty: null,
                      gameLevel: null,
                      notFound: true
                  });
                  continue;
              }

              const u = rows[0];
              // Only consider the saved game valid if the room still exists in memory
              const hasLiveGame = !!(u.currentRoomId && games[u.currentRoomId]);

              results.push({
                  pseudo: u.pseudo,
                  tag: u.tag,
                  currentRoomId: hasLiveGame ? u.currentRoomId : null,
                  gameMode: hasLiveGame ? u.gameMode : null,
                  gameDifficulty: hasLiveGame ? u.gameDifficulty : null,
                  gameLevel: hasLiveGame ? u.gameLevel : null,
              });
          } catch (err) {
              console.error('fetch_accounts_info error:', err);
          }
      }
      socket.emit('accounts_info', results);
  });

  // === Bind this socket to an account (for presence + invites) ===
  socket.on('register_account', ({ pseudo, tag }) => {
      if (!isValidAccount({ pseudo, tag })) return;
      const wasOnline = isOnline(pseudo, tag);
      bindSocketToAccount(socket, pseudo, tag);
      // Push status to friends only if this is the first connection for this account
      if (!wasOnline) notifyFriendsAboutMe(pseudo, tag);

      // Replay any pending friend requests addressed to this account
      const myKey = accKey(pseudo, tag);
      const pending = pendingFriendRequests.get(myKey);
      if (pending && pending.size > 0) {
          for (const [, req] of pending) {
              socket.emit('friend_request_received', {
                  fromPseudo: req.fromPseudo,
                  fromTag: req.fromTag,
                  ts: req.ts,
              });
          }
      }
  });

  socket.on('unregister_account', () => {
      const acc = socket.userAccount;
      unbindSocket(socket);
      if (acc && !isOnline(acc.pseudo, acc.tag)) {
          notifyFriendsAboutMe(acc.pseudo, acc.tag);
      }
  });

  // === Friend list ===
  socket.on('fetch_friends', async () => {
      const me = socket.userAccount;
      if (!me) return socket.emit('friends_list', []);

      try {
          const rows = await db.select().from(friendships)
              .where(and(
                  eq(friendships.ownerPseudo, me.pseudo),
                  eq(friendships.ownerTag, me.tag)
              ));

          const list = [];
          for (const f of rows) {
              list.push(await buildFriendStatus(f.friendPseudo, f.friendTag));
          }
          socket.emit('friends_list', list);

          // Replay any pending incoming friend requests to this socket
          const myKey = accKey(me.pseudo, me.tag);
          const pending = pendingFriendRequests.get(myKey);
          if (pending && pending.size > 0) {
              for (const [, req] of pending) {
                  socket.emit('friend_request_received', {
                      fromPseudo: req.fromPseudo,
                      fromTag: req.fromTag,
                      ts: req.ts,
                  });
              }
          }
      } catch (err) {
          console.error('fetch_friends error:', err);
          socket.emit('friends_list', []);
      }
  });

  // === Friend request: send (target must accept) ===
  socket.on('send_friend_request', async ({ friendPseudo, friendTag }) => {
      const me = socket.userAccount;
      if (!me) return socket.emit('friend_error', { reason: 'Not logged in' });

      const fp = sanitizePseudo(friendPseudo);
      const ft = (typeof friendTag === 'string' ? friendTag.trim().toUpperCase() : '');
      if (!fp || ft.length !== 4) return socket.emit('friend_error', { reason: 'Invalid friend identifier' });
      if (fp === me.pseudo && ft === me.tag) return socket.emit('friend_error', { reason: "Can't add yourself" });

      const senderKey = accKey(me.pseudo, me.tag);
      const recipientKey = accKey(fp, ft);

      // Rate limit
      const now = Date.now();
      const recent = (friendRequestRate.get(senderKey) || []).filter(t => now - t < FRIEND_REQ_WINDOW_MS);
      if (recent.length >= FRIEND_REQ_MAX_PER_WINDOW) {
          return socket.emit('friend_error', { reason: 'Too many requests, slow down' });
      }
      recent.push(now);
      friendRequestRate.set(senderKey, recent);

      try {
          const exists = await db.select().from(users)
              .where(and(eq(users.pseudo, fp), eq(users.tag, ft)))
              .limit(1);
          if (exists.length === 0) return socket.emit('friend_error', { reason: 'Account not found' });

          // Already friends?
          const already = await db.select().from(friendships)
              .where(and(
                  eq(friendships.ownerPseudo, me.pseudo),
                  eq(friendships.ownerTag, me.tag),
                  eq(friendships.friendPseudo, fp),
                  eq(friendships.friendTag, ft),
              ))
              .limit(1);
          if (already.length > 0) return socket.emit('friend_error', { reason: 'Already in your list' });

          // Already a pending request from sender → recipient ?
          let pending = pendingFriendRequests.get(recipientKey);
          if (pending && pending.has(senderKey)) {
              return socket.emit('friend_error', { reason: 'Request already pending' });
          }

          // Did they already send US a request? → auto-accept (mutual)
          const reverse = pendingFriendRequests.get(senderKey);
          if (reverse && reverse.has(recipientKey)) {
              const r = reverse.get(recipientKey);
              reverse.delete(recipientKey);
              if (reverse.size === 0) pendingFriendRequests.delete(senderKey);
              await insertMutualFriendship(me.pseudo, me.tag, r.fromPseudo, r.fromTag);
              socket.emit('friend_added', { pseudo: r.fromPseudo, tag: r.fromTag });
              const otherSockets = accountSockets.get(recipientKey);
              if (otherSockets) {
                  for (const sId of otherSockets) {
                      io.to(sId).emit('friend_added', { pseudo: me.pseudo, tag: me.tag });
                  }
              }
              return;
          }

          // Otherwise: create pending request and notify recipient if online
          if (!pending) { pending = new Map(); pendingFriendRequests.set(recipientKey, pending); }
          pending.set(senderKey, { fromPseudo: me.pseudo, fromTag: me.tag, ts: now });

          socket.emit('friend_request_sent', { friendPseudo: fp, friendTag: ft });

          const recipientSockets = accountSockets.get(recipientKey);
          if (recipientSockets && recipientSockets.size > 0) {
              for (const sId of recipientSockets) {
                  io.to(sId).emit('friend_request_received', {
                      fromPseudo: me.pseudo,
                      fromTag: me.tag,
                      ts: now,
                  });
              }
          }
      } catch (err) {
          console.error('send_friend_request error:', err);
          socket.emit('friend_error', { reason: 'Server error' });
      }
  });

  socket.on('accept_friend_request', async ({ fromPseudo, fromTag }) => {
      const me = socket.userAccount;
      if (!me) return;

      const recipientKey = accKey(me.pseudo, me.tag);
      const senderKey = accKey(fromPseudo, fromTag);
      const pending = pendingFriendRequests.get(recipientKey);
      if (!pending || !pending.has(senderKey)) return;

      pending.delete(senderKey);
      if (pending.size === 0) pendingFriendRequests.delete(recipientKey);

      try {
          await insertMutualFriendship(me.pseudo, me.tag, fromPseudo, fromTag);
          // Notify both sides
          socket.emit('friend_added', { pseudo: fromPseudo, tag: fromTag });
          const senderSockets = accountSockets.get(senderKey);
          if (senderSockets) {
              for (const sId of senderSockets) {
                  io.to(sId).emit('friend_added', { pseudo: me.pseudo, tag: me.tag });
                  io.to(sId).emit('friend_request_accepted', { byPseudo: me.pseudo, byTag: me.tag });
              }
          }
      } catch (err) {
          console.error('accept_friend_request error:', err);
      }
  });

  socket.on('decline_friend_request', ({ fromPseudo, fromTag }) => {
      const me = socket.userAccount;
      if (!me) return;

      const recipientKey = accKey(me.pseudo, me.tag);
      const senderKey = accKey(fromPseudo, fromTag);
      const pending = pendingFriendRequests.get(recipientKey);
      if (!pending || !pending.has(senderKey)) return;

      pending.delete(senderKey);
      if (pending.size === 0) pendingFriendRequests.delete(recipientKey);

      const senderSockets = accountSockets.get(senderKey);
      if (senderSockets) {
          for (const sId of senderSockets) {
              io.to(sId).emit('friend_request_declined', { byPseudo: me.pseudo, byTag: me.tag });
          }
      }
  });

  socket.on('remove_friend', async ({ friendPseudo, friendTag }) => {
      const me = socket.userAccount;
      if (!me) return;

      try {
          await db.delete(friendships).where(and(
              eq(friendships.ownerPseudo, me.pseudo),
              eq(friendships.ownerTag, me.tag),
              eq(friendships.friendPseudo, friendPseudo),
              eq(friendships.friendTag, friendTag)
          ));
          socket.emit('friend_removed', { pseudo: friendPseudo, tag: friendTag });
      } catch (err) {
          console.error('remove_friend error:', err);
      }
  });

  // === Request to join a friend's game ===
  socket.on('request_join', async ({ friendPseudo, friendTag }) => {
      const me = socket.userAccount;
      if (!me) return socket.emit('join_request_error', { reason: 'Not logged in' });

      const senderKey = accKey(me.pseudo, me.tag);
      const recipientKey = accKey(friendPseudo, friendTag);
      if (senderKey === recipientKey) return;

      // Rate limit: max N per window
      const now = Date.now();
      const recent = (joinRequestRate.get(senderKey) || []).filter(t => now - t < JOIN_REQ_WINDOW_MS);
      if (recent.length >= JOIN_REQ_MAX_PER_WINDOW) {
          return socket.emit('join_request_error', { reason: 'Too many requests, slow down' });
      }
      recent.push(now);
      joinRequestRate.set(senderKey, recent);

      try {
          const userRow = await db.select().from(users)
              .where(and(eq(users.pseudo, friendPseudo), eq(users.tag, friendTag)))
              .limit(1);
          if (userRow.length === 0 || !userRow[0].currentRoomId || !games[userRow[0].currentRoomId]) {
              return socket.emit('join_request_error', { reason: 'Friend is not in a game' });
          }

          const targetRoomId = userRow[0].currentRoomId;
          const recipientSockets = accountSockets.get(recipientKey);
          if (!recipientSockets || recipientSockets.size === 0) {
              return socket.emit('join_request_error', { reason: 'Friend is offline' });
          }

          // Dedupe: replace any prior pending request from same sender
          let pending = pendingJoinRequests.get(recipientKey);
          if (!pending) { pending = new Map(); pendingJoinRequests.set(recipientKey, pending); }
          pending.set(senderKey, { fromPseudo: me.pseudo, fromTag: me.tag, roomId: targetRoomId, ts: now });

          // Auto-expire
          setTimeout(() => {
              const p = pendingJoinRequests.get(recipientKey);
              const entry = p && p.get(senderKey);
              if (entry && entry.ts === now) {
                  p.delete(senderKey);
                  if (p.size === 0) pendingJoinRequests.delete(recipientKey);
              }
          }, JOIN_REQ_TTL_MS);

          // Notify recipient (every device they're logged in on)
          for (const sId of recipientSockets) {
              io.to(sId).emit('join_request', {
                  fromPseudo: me.pseudo,
                  fromTag: me.tag,
                  roomId: targetRoomId,
                  expiresInMs: JOIN_REQ_TTL_MS,
              });
          }

          socket.emit('join_request_sent', { friendPseudo, friendTag });
      } catch (err) {
          console.error('request_join error:', err);
          socket.emit('join_request_error', { reason: 'Server error' });
      }
  });

  socket.on('accept_join_request', ({ fromPseudo, fromTag }) => {
      const me = socket.userAccount;
      if (!me) return;

      const recipientKey = accKey(me.pseudo, me.tag);
      const senderKey = accKey(fromPseudo, fromTag);
      const pending = pendingJoinRequests.get(recipientKey);
      const req = pending && pending.get(senderKey);
      if (!req) return;

      pending.delete(senderKey);
      if (pending.size === 0) pendingJoinRequests.delete(recipientKey);

      // Verify the recipient is still in the requested room
      if (!games[req.roomId]) return;

      const senderSockets = accountSockets.get(senderKey);
      if (!senderSockets) return;
      for (const sId of senderSockets) {
          io.to(sId).emit('join_request_accepted', {
              roomId: req.roomId,
              fromPseudo: me.pseudo,
              fromTag: me.tag,
          });
      }
  });

  socket.on('decline_join_request', ({ fromPseudo, fromTag }) => {
      const me = socket.userAccount;
      if (!me) return;

      const recipientKey = accKey(me.pseudo, me.tag);
      const senderKey = accKey(fromPseudo, fromTag);
      const pending = pendingJoinRequests.get(recipientKey);
      if (!pending || !pending.has(senderKey)) return;
      pending.delete(senderKey);
      if (pending.size === 0) pendingJoinRequests.delete(recipientKey);

      const senderSockets = accountSockets.get(senderKey);
      if (!senderSockets) return;
      for (const sId of senderSockets) {
          io.to(sId).emit('join_request_declined', {
              fromPseudo: me.pseudo,
              fromTag: me.tag,
          });
      }
  });

  socket.on('create_room', async ({ mode, difficulty, hp, pseudo, tag, rows, cols, mines, scansAvailable, allowLying, lyingChance }) => {
      const roomId = uuidv4().substring(0, 6).toUpperCase();

      let dRows, dCols, dMines;
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
      } else {
          const preset = getDifficultyPreset(difficulty);
          dRows = preset.rows;
          dCols = preset.cols;
          dMines = preset.mines;
      }

      games[roomId] = new MinesweeperGame(dRows, dCols, dMines, mode || 'classic', hp || 3, difficulty, dScans, dAllowLying, dLyingChance);
      games[roomId].initializeEmptyGrid();
      games[roomId].level = 1;

      // Persist game info to the (pseudo, tag) account
      if (pseudo && tag) {
          try {
              await db.update(users)
                  .set({
                      currentRoomId: roomId,
                      gameMode: mode || 'classic',
                      gameDifficulty: difficulty || 'medium',
                      gameLevel: 1,
                      lastActive: new Date()
                  })
                  .where(and(eq(users.pseudo, pseudo), eq(users.tag, tag)));
          } catch(e) {
              console.error("DB Error (create_room):", e);
          }
      }

      socket.join(roomId);
      socket.emit('room_created', roomId);

      socket.emit('init_game', {
            grid: games[roomId].grid,
            hp: games[roomId].hp,
            rows: games[roomId].rows,
            cols: games[roomId].cols,
            mines: games[roomId].minesCount,
            scansAvailable: games[roomId].scansAvailable,
            role: 'P1',
            mode: games[roomId].mode,
            difficulty: games[roomId].difficulty,
            level: games[roomId].level
      });

      if (pseudo && tag) notifyFriendsAboutMe(pseudo, tag);
  });

  socket.on('join_room', async (roomId, pseudo, tag) => {
    if (games[roomId]) {
        // Leave any other game rooms this socket might still be subscribed to
        for (const r of socket.rooms) {
            if (r !== socket.id && r !== roomId) socket.leave(r);
        }
        socket.join(roomId);

        if (pseudo && tag) {
             try {
                await db.update(users)
                    .set({
                        currentRoomId: roomId,
                        gameMode: games[roomId].mode,
                        gameDifficulty: games[roomId].difficulty,
                        gameLevel: games[roomId].level || 1,
                        lastActive: new Date()
                    })
                    .where(and(eq(users.pseudo, pseudo), eq(users.tag, tag)));
            } catch(e) {
                console.error("DB Error (join_room):", e);
            }
        }

        const room = io.sockets.adapter.rooms.get(roomId);
        const playerCount = room ? room.size : 0;
        const role = playerCount === 1 ? 'P1' : 'P2';

        socket.emit('init_game', {
            grid: games[roomId].grid,
            hp: games[roomId].hp,
            rows: games[roomId].rows,
            cols: games[roomId].cols,
            mines: games[roomId].minesCount,
            scansAvailable: games[roomId].scansAvailable,
            role: role,
            mode: games[roomId].mode,
            difficulty: games[roomId].difficulty,
            level: games[roomId].level
        });

        if (pseudo && tag) notifyFriendsAboutMe(pseudo, tag);

    } else {
        socket.emit('error', 'Room not found');
    }
  });

  socket.on('leave_room', async (roomId, pseudo, tag) => {
      socket.leave(roomId);
      if (pseudo && tag) {
          try {
              await db.update(users)
                  .set({ currentRoomId: null, gameMode: null, gameDifficulty: null, gameLevel: null })
                  .where(and(eq(users.pseudo, pseudo), eq(users.tag, tag)));
              notifyFriendsAboutMe(pseudo, tag);
          } catch(e) {
              console.error("DB Error (leave_room):", e);
          }
      }
  });

  socket.on('cursor_move', ({ x, y, roomId, role }) => {
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
        io.to(roomId).emit('update_grid', [result.cell]);
        io.to(roomId).emit('update_scans', { scansAvailable: result.scansAvailable });
    }
  });

  socket.on('click_cell', async ({ x, y, roomId }) => {
    const game = games[roomId];
    if (!game) return;
    if (game.hp <= 0) return;

    const wasGenerated = game.isGenerated;
    const result = game.processClick(x, y);

    if (wasGenerated !== game.isGenerated) {
        io.to(roomId).emit('update_mines', { mines: game.minesCount });
    }

    if (result.hitMine) {
       game.hp -= 1;
       io.to(roomId).emit('explosion', { x, y, hp: game.hp });
       if (game.hp <= 0) {
           const allMines = [];
           for(let r=0; r<game.rows; r++) {
               for(let c=0; c<game.cols; c++) {
                   if(game.grid[r][c].isMine) {
                       allMines.push({ ...game.grid[r][c], isOpen: true });
                   }
               }
           }
           io.to(roomId).emit('game_over', { mines: allMines });

           // Clear current room reference for every account in this room
           try {
               const affected = await db.select().from(users).where(eq(users.currentRoomId, roomId));
               await db.update(users)
                   .set({ currentRoomId: null, gameMode: null, gameDifficulty: null, gameLevel: null })
                   .where(eq(users.currentRoomId, roomId));
               for (const u of affected) notifyFriendsAboutMe(u.pseudo, u.tag);
           } catch(e) {
               console.error("DB Error (game_over):", e);
           }
       }
    } else {
       io.to(roomId).emit('update_grid', result.changes);

       if (game.checkWin()) {
           if (game.mode === 'hardcore') {
               if (!games[roomId].score) games[roomId].score = 0;
               games[roomId].score += 1;
               if (!games[roomId].level) games[roomId].level = 1;
               games[roomId].level += 1;

               const lastRow = game.grid[game.rows - 1];
               game.initializeNextLevel(lastRow);
               io.to(roomId).emit('level_complete', {
                   grid: game.grid,
                   score: games[roomId].score,
                   level: games[roomId].level,
                   mines: game.minesCount,
                   scansAvailable: game.scansAvailable
               });

               // Persist new level for all accounts in this room
               try {
                   const affected = await db.select().from(users).where(eq(users.currentRoomId, roomId));
                   await db.update(users)
                       .set({ gameLevel: games[roomId].level, lastActive: new Date() })
                       .where(eq(users.currentRoomId, roomId));
                   for (const u of affected) notifyFriendsAboutMe(u.pseudo, u.tag);
               } catch(e) {
                   console.error("DB Error (level_complete):", e);
               }
           } else {
               io.to(roomId).emit('game_win');
               try {
                   const affected = await db.select().from(users).where(eq(users.currentRoomId, roomId));
                   await db.update(users)
                       .set({ currentRoomId: null, gameMode: null, gameDifficulty: null, gameLevel: null })
                       .where(eq(users.currentRoomId, roomId));
                   for (const u of affected) notifyFriendsAboutMe(u.pseudo, u.tag);
               } catch(e) {
                   console.error("DB Error (game_win):", e);
               }
           }
       }
    }
  });

  socket.on('restart_game', async ({ roomId }) => {
    if (!games[roomId]) return;

    // Restart uses the previous game's config as source of truth.
    // Client-sent params are ignored: after a page reload the client's setup
    // state is at defaults, so trusting it would shrink a custom board into
    // a tiny easy-like board.
    const oldGame = games[roomId];
    const safeMode = oldGame.mode || 'classic';
    const safeDiff = oldGame.difficulty || 'medium';
    const safeHp = oldGame.initialHp || 3;

    let dRows, dCols, dMines;
    let dScans = 0;
    let dAllowLying = false;
    let dLyingChance = 12.5;

    if (safeDiff === 'custom') {
        dRows = oldGame.rows;
        dCols = oldGame.cols;
        dMines = oldGame.initialMinesCount || oldGame.minesCount;
        dScans = oldGame.customScans || 0;
        dAllowLying = oldGame.allowLying || false;
        dLyingChance = oldGame.lyingChance || 12.5;
    } else {
        const preset = getDifficultyPreset(safeDiff);
        dRows = preset.rows;
        dCols = preset.cols;
        dMines = preset.mines;
    }

    games[roomId] = new MinesweeperGame(dRows, dCols, dMines, safeMode, safeHp, safeDiff, dScans, dAllowLying, dLyingChance);
    games[roomId].initializeEmptyGrid();
    games[roomId].level = 1;

    // Reset game info for accounts in this room
    try {
        const affected = await db.select().from(users).where(eq(users.currentRoomId, roomId));
        await db.update(users)
            .set({ gameMode: safeMode, gameDifficulty: safeDiff, gameLevel: 1, lastActive: new Date() })
            .where(eq(users.currentRoomId, roomId));
        for (const u of affected) notifyFriendsAboutMe(u.pseudo, u.tag);
    } catch(e) {
        console.error("DB Error (restart_game):", e);
    }

    io.to(roomId).emit('init_game', {
        grid: games[roomId].grid,
        hp: games[roomId].hp,
        rows: games[roomId].rows,
        cols: games[roomId].cols,
        mines: games[roomId].minesCount,
        scansAvailable: games[roomId].scansAvailable,
        mode: games[roomId].mode,
        difficulty: games[roomId].difficulty,
        level: games[roomId].level
    });
  });

  socket.on('disconnect', () => {
      const acc = socket.userAccount;
      unbindSocket(socket);
      if (acc && !isOnline(acc.pseudo, acc.tag)) {
          notifyFriendsAboutMe(acc.pseudo, acc.tag);
      }
  });
});

const PORT = process.env.PORT || 3005;

connect()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('Startup failed:', err);
        process.exit(1);
    });
