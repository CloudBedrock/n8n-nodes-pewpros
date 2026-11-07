const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const {
  parseSignatureHeader,
  verifySignature,
  rememberEventId,
} = require('../dist/utils/webhookSecurity');

const SECRET = 'whsec_test_secret';
const BODY = '{"id":"evt_1","type":"waiver.signed","data":{}}';
const NOW = 1_800_000_000;

function sign(secret, t, body) {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}

test('accepts a valid signature', () => {
  const header = `t=${NOW},v1=${sign(SECRET, NOW, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'ok');
});

test('accepts uppercase hex', () => {
  const header = `t=${NOW},v1=${sign(SECRET, NOW, BODY).toUpperCase()}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'ok');
});

test('rejects the wrong secret', () => {
  const header = `t=${NOW},v1=${sign('other', NOW, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'mismatch');
});

test('rejects a tampered body', () => {
  const header = `t=${NOW},v1=${sign(SECRET, NOW, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY.replace('evt_1', 'evt_2'), NOW), 'mismatch');
});

test('rejects a re-serialised body (exact bytes only)', () => {
  const header = `t=${NOW},v1=${sign(SECRET, NOW, BODY)}`;
  const reserialised = JSON.stringify(JSON.parse(BODY), null, 1);
  assert.equal(verifySignature(SECRET, header, reserialised, NOW), 'mismatch');
});

test('rejects a timestamp older than 300 seconds', () => {
  const t = NOW - 301;
  const header = `t=${t},v1=${sign(SECRET, t, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'stale');
});

test('rejects a timestamp more than 300 seconds in the future', () => {
  const t = NOW + 301;
  const header = `t=${t},v1=${sign(SECRET, t, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'stale');
});

test('accepts a timestamp exactly at the 300 second edge', () => {
  const t = NOW - 300;
  const header = `t=${t},v1=${sign(SECRET, t, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'ok');
});

test('a stale timestamp cannot be forged by editing t (signature covers t)', () => {
  const old = NOW - 3600;
  const header = `t=${NOW},v1=${sign(SECRET, old, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'mismatch');
});

test('rejects missing and malformed headers', () => {
  for (const header of [
    undefined,
    null,
    '',
    'garbage',
    `v1=${sign(SECRET, NOW, BODY)}`,
    `t=${NOW}`,
    `t=abc,v1=${sign(SECRET, NOW, BODY)}`,
    `t=${NOW},v1=not-hex`,
    `t=${NOW},t=${NOW},v1=${sign(SECRET, NOW, BODY)}`,
  ]) {
    assert.equal(verifySignature(SECRET, header, BODY, NOW), 'malformed', String(header));
  }
});

test('accepts several v1 values when any one matches (secret rotation)', () => {
  const header = `t=${NOW},v1=${sign('old_secret', NOW, BODY)},v1=${sign(SECRET, NOW, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'ok');
  assert.deepEqual(parseSignatureHeader(header).v1.length, 2);
});

test('rejects several v1 values when none match', () => {
  const header = `t=${NOW},v1=${sign('a', NOW, BODY)},v1=${sign('b', NOW, BODY)}`;
  assert.equal(verifySignature(SECRET, header, BODY, NOW), 'mismatch');
});

test('rememberEventId flags a repeated id', () => {
  const state = {};
  assert.equal(rememberEventId(state, 'evt_a'), true);
  assert.equal(rememberEventId(state, 'evt_b'), true);
  assert.equal(rememberEventId(state, 'evt_a'), false);
});

test('rememberEventId stays bounded and forgets the oldest ids', () => {
  const state = {};
  for (let i = 0; i < 5; i++) rememberEventId(state, `evt_${i}`, 3);
  assert.deepEqual(state.seenEventIds, ['evt_2', 'evt_3', 'evt_4']);
  assert.equal(rememberEventId(state, 'evt_4', 3), false);
  assert.equal(rememberEventId(state, 'evt_0', 3), true);
});
