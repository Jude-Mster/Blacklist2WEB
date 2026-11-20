'use strict';
// Input checks. Uploaded screenshots are checked by their first bytes (not the file name),
// kept in memory only, and never saved to disk or run.

const ACCOUNT_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const REFERENCE_RE = /^[A-Za-z0-9 -]{4,40}$/;

function cleanAccount(s) {
  const v = String(s || '').trim();
  return ACCOUNT_RE.test(v) ? v : null;
}

function cleanReference(s) {
  const v = String(s || '').trim().replace(/\s+/g, ' ');
  return REFERENCE_RE.test(v) ? v : null;
}

/** Returns 'png' | 'jpg' | 'webp' for real image bytes, otherwise null. */
function imageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Downloads an uploaded attachment from Discord's CDN with a hard size cap. */
async function fetchProof(attachment, maxBytes) {
  if (!attachment || attachment.size > maxBytes) return { error: 'too_big' };
  let url;
  try { url = new URL(attachment.url); } catch { return { error: 'bad_url' }; }
  if (url.protocol !== 'https:' || !/(^|\.)discordapp\.(com|net)$|(^|\.)discord\.com$/.test(url.hostname)) return { error: 'bad_url' };
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { error: 'download_failed' };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) return { error: 'too_big' };
  const type = imageType(buf);
  if (!type) return { error: 'not_image' };
  return { buf, type };
}

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function packLabel(p) {
  const gp = `${(p.coins + p.bonus).toLocaleString('en-US')} GP`;
  const bonus = p.bonus ? ` (incl. ${p.bonus.toLocaleString('en-US')} bonus)` : '';
  const usd = p.priceUsd != null ? ` / USD ${money(p.priceUsd)}` : '';
  return `${gp}${bonus} — PHP ${money(p.pricePhp)}${usd}`.slice(0, 100);
}

module.exports = { cleanAccount, cleanReference, imageType, fetchProof, packLabel };
