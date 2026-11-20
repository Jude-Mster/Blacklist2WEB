'use strict';
// Applies every migrations/*.sql file once, in name order. Runs automatically when the
// server starts, and can also be run by hand: npm run migrate
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

// Errors that mean "this statement was applied before" (column, index, table or key exists).
const ALREADY_DONE = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_FK_DUP_NAME', 'ER_DUP_CONSTRAINT_NAME']);

/** Splits a migration file into its statements (each ends with ";" at the end of a line, maybe followed by a -- comment). */
function statements(sql) {
  return sql.split(/;[ \t]*(?:--[^\n]*)?(?:\r?\n|$)/)
    .map((x) => x.split(/\r?\n/).filter((line) => !/^\s*--/.test(line)).join('\n').trim())
    .filter(Boolean);
}

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
      for (const stmt of statements(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        try {
          await conn.query(stmt);
        } catch (e) {
          // A restart in the middle of a migration leaves some statements applied but the file not
          // recorded. On the next start those report "already exists"; skip them and go on.
          if (!ALREADY_DONE.has(e.code)) throw e;
          log(`migration ${f}: already applied, skipped (${e.code})`);
        }
      }
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
      log(`migration applied: ${f}`);
    }
  } finally {
    await conn.end();
  }
}

module.exports = { migrate, statements };

if (require.main === module) {
  migrate().then(() => console.log('migrations up to date')).catch((e) => { console.error(e.message); process.exit(1); });
}
