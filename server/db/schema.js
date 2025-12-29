const { pgTable, serial, varchar, timestamp } = require('drizzle-orm/pg-core');

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  pseudo: varchar('pseudo', { length: 255 }).unique().notNull(),
  currentRoomId: varchar('current_room_id', { length: 50 }),
  lastActive: timestamp('last_active').defaultNow(),
});

module.exports = { users };
