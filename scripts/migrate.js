'use strict';
// Applies every migrations/*.sql file once, in name order. Runs automatically when the
// server starts, and can also be run by hand: npm run migrate
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

async function migrate(log = console.log) {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
    const [doneRows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set(doneRows.map((r) => r.name));
    const dir = path.join(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await conn.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
      log(`migration applied: ${f}`);
    }
  } finally {
    await conn.end();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate().then(() => console.log('migrations up to date')).catch((e) => { console.error(e.message); process.exit(1); });
}
