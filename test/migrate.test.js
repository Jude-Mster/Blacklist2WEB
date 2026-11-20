'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { statements } = require('../scripts/migrate');

test('migration files split into whole statements', () => {
  const sql = '-- note; with a semicolon\nCREATE TABLE a (x INT); -- trailing\nALTER TABLE a ADD COLUMN y INT; \r\nINSERT INTO a VALUES (1);';
  assert.deepStrictEqual(statements(sql), ['CREATE TABLE a (x INT)', 'ALTER TABLE a ADD COLUMN y INT', 'INSERT INTO a VALUES (1)']);
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    for (const s of statements(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      assert.match(s, /^(CREATE|ALTER|INSERT|UPDATE)\b/i, `${f}: ${s.slice(0, 40)}`);
    }
  }
});
