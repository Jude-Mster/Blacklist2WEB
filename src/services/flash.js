'use strict';

/** One-shot messages stored in the session: req.flash('ok' | 'error', text). */
function flash(req, res, next) {
  res.locals.flashes = req.session.flash || [];
  delete req.session.flash;
  req.flash = (type, text) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, text });
  };
  next();
}

module.exports = { flash };
