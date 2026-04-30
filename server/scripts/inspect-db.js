require('dotenv').config();
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const r = await c.query(
    `SELECT tablename, schemaname FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname, tablename`
  );
  console.log('Tables in DB:');
  r.rows.forEach(row => console.log(`  ${row.schemaname}.${row.tablename}`));
  await c.end();
}).catch(e => { console.error(e.message); c.end(); });
