const { pgTable, serial, varchar, integer, timestamp, unique, index } = require('drizzle-orm/pg-core');

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  pseudo: varchar('pseudo', { length: 32 }).notNull(),
  tag: varchar('tag', { length: 4 }).notNull(),
  currentRoomId: varchar('current_room_id', { length: 50 }),
  gameMode: varchar('game_mode', { length: 32 }),
  gameDifficulty: varchar('game_difficulty', { length: 32 }),
  gameLevel: integer('game_level'),
  fingerprintHash: varchar('fingerprint_hash', { length: 64 }),
  localStorageToken: varchar('local_storage_token', { length: 64 }),
  lastActive: timestamp('last_active').defaultNow(),
}, (table) => [
  unique('users_pseudo_tag_unique').on(table.pseudo, table.tag),
]);

const friendships = pgTable('friendships', {
  id: serial('id').primaryKey(),
  ownerPseudo: varchar('owner_pseudo', { length: 32 }).notNull(),
  ownerTag: varchar('owner_tag', { length: 4 }).notNull(),
  friendPseudo: varchar('friend_pseudo', { length: 32 }).notNull(),
  friendTag: varchar('friend_tag', { length: 4 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  unique('friendships_unique').on(table.ownerPseudo, table.ownerTag, table.friendPseudo, table.friendTag),
  index('friendships_owner_idx').on(table.ownerPseudo, table.ownerTag),
]);

module.exports = { users, friendships };
