const { drizzle } = require('drizzle-orm/node-postgres');
const { Client } = require('pg');
const schema = require('./schema');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(client, { schema });

// Called once at startup — connect then run pending migrations
async function connectAndMigrate() {
    await client.connect();
    console.log('Connected to PostgreSQL database');

    const { migrate } = require('drizzle-orm/node-postgres/migrator');
    const path = require('path');
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    console.log('Migrations applied');
}

module.exports = { db, connectAndMigrate };
