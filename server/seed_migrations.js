// Run once to tell Drizzle that migration 0000 was already applied manually.
// Usage: node seed_migrations.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
        await client.query(`
            CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
                id SERIAL PRIMARY KEY,
                hash text NOT NULL,
                created_at bigint
            )
        `);

        const sql0000 = fs.readFileSync(
            path.join(__dirname, 'drizzle', '0000_sleepy_vance_astro.sql'),
            'utf8'
        );
        const hash0000 = crypto.createHash('sha256').update(sql0000).digest('hex');
        const when0000 = 1767048500286;

        // Remove any stale entry for this migration slot (hash may have changed if file was edited)
        await client.query(
            `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
            [when0000]
        );
        await client.query(
            `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
            [hash0000, when0000]
        );
        console.log(`Migration 0000 marked as applied (hash: ${hash0000})`);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
