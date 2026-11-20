'use strict';
// Orders saved to bot/data/orders.json (git-ignored). Written atomically (temp file + rename),
// so a crash can't leave half a file. Codes are never stored here, only their last 4 characters.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'orders.json');

let state = { seq: 0, orders: {} };

function load() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return state;
}

function save() {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function nextId() {
  state.seq += 1;
  save();
  return String(state.seq).padStart(4, '0');
}

const get = (id) => state.orders[id] || null;
const byChannel = (channelId) => Object.values(state.orders).find((o) => o.channelId === channelId) || null;

function put(order) {
  state.orders[order.id] = { ...order, updatedAt: new Date().toISOString() };
  save();
  return state.orders[order.id];
}

/** Changes status only if it is currently one of `from` (a simple lock against double clicks). */
function transition(id, from, to, extra = {}) {
  const o = state.orders[id];
  if (!o || !from.includes(o.status)) return null;
  return put({ ...o, ...extra, status: to });
}

const OPEN = ['pending_review', 'approving'];
const openFor = (userId) => Object.values(state.orders).find((o) => o.userId === userId && OPEN.includes(o.status)) || null;
const countSince = (userId, ms) => Object.values(state.orders).filter((o) => o.userId === userId && Date.now() - Date.parse(o.createdAt) < ms).length;

module.exports = { load, save, nextId, get, byChannel, put, transition, openFor, countSince, _state: () => state };
