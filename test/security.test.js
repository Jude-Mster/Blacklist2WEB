'use strict';
// Unit checks for the security helpers (no database needed).
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const log = require('../src/log');
const { verifyHmac } = require('../src/services/webhooks');

test('logs never carry emails, quoted values or tokens', () => {
  const out = log.clean("Duplicate entry 'bob@mail.com' for key 'uq' /verify-email?token=abc123 password=hunter2 jane@x.io");
  assert.doesNotMatch(out, /bob@mail\.com|jane@x\.io|abc123|hunter2/);
});

test('webhook signatures: right one passes, wrong or missing ones fail', () => {
  const secret = 's3cret';
  const payload = '{"amount":"500.37","status":"completed"}';
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  assert.strictEqual(verifyHmac({ secret, payload, signature: sig }), true);
  assert.strictEqual(verifyHmac({ secret, payload: payload + ' ', signature: sig }), false);
  assert.strictEqual(verifyHmac({ secret, payload, signature: 'deadbeef' }), false);
  assert.strictEqual(verifyHmac({ secret, payload, signature: '' }), false);
  assert.strictEqual(verifyHmac({ secret: '', payload, signature: sig }), false);
});
