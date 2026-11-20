'use strict';
// The signature the game server checks (docs/GAME_API.md). No database needed.
process.env.GAME_API_SECRET = '0123456789abcdef0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert');
const game = require('../src/game');

test('the Game API signature matches the game server test vector', () => {
  const sig = game.sign('1700000000', '00112233445566778899aabbccddeeff', 'POST', '/v1/accounts',
    JSON.stringify({ accountId: 'abcd', password: 'pw' }));
  assert.strictEqual(sig, 'd57e75f26732beead956561a468f30d3e7a295899c44c91572873883c4018a9c');
});
