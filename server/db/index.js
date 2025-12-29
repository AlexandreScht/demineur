const { drizzle } = require('drizzle-orm/node-postgres');
const { Client } = require('pg');
const schema = require('./schema');
require('dotenv').config();

// Create a client with connection string from environment
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

// Connect immediately
client.connect().then(() => {
    console.log('Connected to PostgreSQL database');
}).catch(err => {
    console.error('Failed to connect to database. Make sure DATABASE_URL is set in .env', err);
});

const db = drizzle(client, { schema });

module.exports = { db };
