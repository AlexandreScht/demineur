/**
 * One-time script: marks all local migration files as already applied
 * in the __drizzle_migrations table, without actually running them.
 *
 * Use this when the DB schema was created manually / out-of-band and
 * the Drizzle migration journal is out of sync.
 *
 * Run once: node scripts/mark-migrations-applied.js
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const journal = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'drizzle', 'meta', '_journal.json'), 'utf8')
);

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to PostgreSQL');

  // Create the migrations table if it doesn't exist yet
  await client.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id        SERIAL PRIMARY KEY,
      hash      TEXT NOT NULL,
      created_at BIGINT
    );
  `);

  for (const entry of journal.entries) {
    const sqlFile = path.join(__dirname, '..', 'drizzle', `${entry.tag}.sql`);
    const sql = fs.existsSync(sqlFile) ? fs.readFileSync(sqlFile, 'utf8') : '';
    const hash = crypto.createHash('sha256').update(sql).digest('hex');

    // Skip if already recorded
    const { rows } = await client.query(
      'SELECT id FROM "__drizzle_migrations" WHERE hash = $1',
      [hash]
    );
    if (rows.length > 0) {
      console.log(`  [skip] ${entry.tag} — already in journal`);
      continue;
    }

    await client.query(
      'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
      [hash, entry.when]
    );
    console.log(`  [ok]   ${entry.tag} — recorded`);
  }

  await client.end();
  console.log('Done — all migrations marked as applied.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
