/**
 * Tests for the app-lock PIN hashing.
 *
 * These call the real KDF, which is the point: the cost parameters have to be
 * ones node will actually accept (N=32768 needs maxmem raised by hand, and the
 * first version of this threw "Invalid scrypt params" for every PIN, which
 * would have locked out anyone who set one).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { isKeychainBlob, makePinBlob, verifyPinBlob } from './pin-hash';

test('the right PIN unlocks and a wrong one does not', () => {
  const blob = makePinBlob('4821');
  assert.equal(verifyPinBlob(blob, '4821').ok, true);
  assert.equal(verifyPinBlob(blob, '4822').ok, false);
  assert.equal(verifyPinBlob(blob, '').ok, false);
});

test('the PIN itself is nowhere in what gets stored', () => {
  const blob = makePinBlob('1234');
  const decoded = Buffer.from(blob.slice(3), 'base64').toString('utf-8');
  assert.equal(blob.startsWith('v2:'), true);
  assert.equal(decoded.includes('1234'), false);
  assert.match(decoded, /"hash":"[0-9a-f]{64}"/);
});

test('the same PIN hashes differently every time, so the salt is real', () => {
  assert.notEqual(makePinBlob('0000'), makePinBlob('0000'));
});

test('a keychain-era blob is recognised and never verifies', () => {
  // What safeStorage.encryptString used to produce, as far as this code sees it.
  const legacy = 'v1:' + Buffer.from('not readable without the keychain').toString('base64');
  assert.equal(isKeychainBlob(legacy), true);
  assert.equal(verifyPinBlob(legacy, '1234').ok, false);
  assert.equal(isKeychainBlob(makePinBlob('1234')), false);
});

test('a pre-keychain raw blob still opens, and comes back as scrypt', () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(`${salt}:9090`).digest('hex');
  const raw = 'raw:' + Buffer.from(JSON.stringify({ salt, hash }), 'utf-8').toString('base64');

  const wrong = verifyPinBlob(raw, '9091');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.upgraded, null);

  const right = verifyPinBlob(raw, '9090');
  assert.equal(right.ok, true);
  assert.equal(right.upgraded?.startsWith('v2:'), true);
  // The rewritten blob must accept the same PIN, or the upgrade locks the user out.
  assert.equal(verifyPinBlob(right.upgraded as string, '9090').ok, true);
});

test('a corrupt or empty blob is a failed attempt, never an unlock', () => {
  assert.equal(verifyPinBlob(undefined, '1234').ok, false);
  assert.equal(verifyPinBlob('', '1234').ok, false);
  assert.equal(verifyPinBlob('v2:!!!not base64!!!', '1234').ok, false);
  assert.equal(verifyPinBlob('v2:' + Buffer.from('{}').toString('base64'), '1234').ok, false);
  assert.equal(verifyPinBlob('something else entirely', '1234').ok, false);
});
