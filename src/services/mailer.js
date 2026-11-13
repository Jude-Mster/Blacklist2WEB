'use strict';
// Sends mail through SMTP (Hostinger: smtp.hostinger.com, port 465). Without SMTP settings,
// outside production the message is kept in memory (used by the tests) and never logged.
const nodemailer = require('nodemailer');
const config = require('../config');

const outbox = []; // dev/test only
let transport = null;

function getTransport() {
  if (!config.smtp.host) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transport;
}

/** Returns true when the mail was handed to the mail server (or stored in dev). */
async function send({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) {
    if (config.isProd) return false;
    outbox.push({ to, subject, text, html });
    return true;
  }
  try {
    await t.sendMail({ from: config.smtp.from, to, subject, text, html });
    return true;
  } catch (e) {
    console.error('mail: sending failed:', e.code || e.name); // no addresses or contents in logs
    return false;
  }
}

module.exports = { send, outbox };
