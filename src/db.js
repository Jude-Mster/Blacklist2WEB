'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: false,
  timezone: 'Z',
});

/** Run fn(conn) inside a transaction; commits on success, rolls back on error. */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function one(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function all(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function run(sql, params) {
  const [res] = await pool.query(sql, params);
  return res;
}

module.exports = { pool, tx, one, all, run };
