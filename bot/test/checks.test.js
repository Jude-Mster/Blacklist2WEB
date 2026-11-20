'use strict';
// Unit checks for the bot (no Discord connection needed).
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { cleanAccount, cleanReference, imageType, packLabel } = require('../src/checks');
const { sign } = require('../src/api');

test('account and reference inputs are validated', () => {
  assert.strictEqual(cleanAccount(' juts_01 '), 'juts_01');
  assert.strictEqual(cleanAccount('a b'), null);
  assert.strictEqual(cleanAccount('<script>'), null);
  assert.strictEqual(cleanReference('5012  3456 7890'), '5012 3456 7890');
  assert.strictEqual(cleanReference('12'), null);
  assert.strictEqual(cleanReference('ref`@everyone'), null);
});

test('screenshots are recognised by their bytes, not their name', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
  assert.strictEqual(imageType(png), 'png');
  assert.strictEqual(imageType(jpg), 'jpg');
  assert.strictEqual(imageType(webp), 'webp');
  assert.strictEqual(imageType(Buffer.from('MZ this is an exe file')), null);
  assert.strictEqual(imageType(Buffer.from('<svg onload=alert(1)>....')), null);
});

test('signature matches the website format', () => {
  const s = sign('k'.repeat(40), '1790000000', 'POST', '/internal/bot/mint', '{"a":1}');
  const e = crypto.createHmac('sha256', 'k'.repeat(40)).update('1790000000.POST./internal/bot/mint.{"a":1}').digest('hex');
  assert.strictEqual(s, e);
});

test('pack labels fit Discord limits', () => {
  const l = packLabel({ coins: 10000, bonus: 2000, pricePhp: 5000, priceUsd: 100 });
  assert.match(l, /12,000 GP .*PHP 5,000 \/ USD 100/);
  assert.ok(l.length <= 100);
});
