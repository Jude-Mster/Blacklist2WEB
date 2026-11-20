'use strict';
const express = require('express');
const db = require('../db');
const game = require('../game');
const log = require('../log');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** The newest published news; an empty list (logged) when the database is not ready, so the
 *  home and news pages still open instead of showing an error page. */
async function latestNews(limit, req) {
  try {
    return await db.all('SELECT id, tag, title, summary, created_at FROM news WHERE published = 1 ORDER BY created_at DESC LIMIT ?', [limit]);
  } catch (e) {
    log.requestError(req, e);
    return [];
  }
}

const TYPES = { level: 'Level', pk: 'PK points', duel: 'Duel wins', guild: 'Guilds' };

router.get('/', wrap(async (req, res) => {
  const news = await latestNews(3, req);
  let top = [];
  try { top = (await game.rankings('level')).slice(0, 5); } catch { /* game offline */ }
  res.render('pages/home', { title: null, news, top });
}));

router.get('/news/:id', wrap(async (req, res, next) => {
  const item = await db.one('SELECT * FROM news WHERE id = ? AND published = 1', [Number(req.params.id) || 0]);
  if (!item) return next();
  res.render('pages/news', { title: item.title, item });
}));

router.get('/news', wrap(async (req, res) => {
  const news = await latestNews(50, req);
  res.render('pages/news-list', { title: 'News', news });
}));

router.get('/download', (req, res) => res.render('pages/download', { title: 'Download' }));
router.get('/support', (req, res) => res.render('pages/support', { title: 'Guide, rules & terms' }));

router.get('/rankings', wrap(async (req, res) => {
  const type = TYPES[req.query.type] ? req.query.type : 'level';
  let rows = [];
  let factions = [];
  let offline = false;
  try { [rows, factions] = await Promise.all([game.rankings(type), game.factions()]); } catch { offline = true; }
  res.render('pages/rankings', { title: 'Rankings', type, types: TYPES, rows, factions, offline });
}));

module.exports = router;
