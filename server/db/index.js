const { drizzle } = require('drizzle-orm/node-postgres');
const { Client } = require('pg');
const schema = require('./schema');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = drizzle(client, { schema });

// Called once at startup — connect to the database only.
// Run migrations manually via: pnpm db:migrate
async function connect() {
    await client.connect();
    console.log('Connected to PostgreSQL database');
}

module.exports = { db, connect };
