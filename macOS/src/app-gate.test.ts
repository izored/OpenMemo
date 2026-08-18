/**
 * Tests for the app-lock gate and the openAppWindow run tokens.
 *
 * Run with `npm test` in macOS/. Compiled to dist-electron alongside everything
 * else and excluded from the packaged app (see electron-builder.yml).
 *
 * The last test is the one that matters: it is a security bug the shell shipped
 * with, and reproducing it by hand needs the window closed inside the couple of
 * seconds the backend takes to answer its health check.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppGate } from './app-gate';

test('the newest run owns the window; older ones are refused', () => {
  const gate = new AppGate();
  const first = gate.beginRun();
  assert.equal(gate.mayNavigate(first), true);
  const second = gate.beginRun();
  assert.equal(gate.mayNavigate(first), false);
  assert.equal(gate.mayNavigate(second), true);
});

test('a caller with no run of its own is allowed while the gate is down', () => {
  const gate = new AppGate();
  gate.beginRun();
  assert.equal(gate.mayNavigate(), true);
});

test('the gate refuses everyone, run token or not', () => {
  const gate = new AppGate();
  const run = gate.beginRun();
  void gate.showGate();
  assert.equal(gate.locked, true);
  assert.equal(gate.mayNavigate(run), false);
  // The openmemo:// deep link took this path: warm backend, no run token, and
  // no idea the window was showing a PIN prompt.
  assert.equal(gate.mayNavigate(), false);
});

test('unlocking clears the gate and lets the current run through', async () => {
  const gate = new AppGate();
  const run = gate.beginRun();
  const waiting = gate.showGate();
  assert.equal(gate.unlock(), true);
  assert.equal(await waiting, true);
  assert.equal(gate.locked, false);
  assert.equal(gate.mayNavigate(run), true);
});

test('unlocking with no gate up reports that nothing was waiting', () => {
  const gate = new AppGate();
  assert.equal(gate.unlock(), false);
});

test('a second gate abandons the first one rather than stranding its opener', async () => {
  const gate = new AppGate();
  gate.beginRun();
  const abandoned = gate.showGate();
  gate.beginRun();
  const live = gate.showGate();
  assert.equal(await abandoned, false); // would hang forever without the hand-off
  gate.unlock();
  assert.equal(await live, true);
});

test('closing the window mid-boot cannot paint the app over a new PIN gate', async () => {
  const gate = new AppGate();
  let loads = 0;

  // Run 1: the user unlocks, and the shell starts the backend. This await is
  // seconds long in the real thing.
  const first = gate.beginRun();
  const firstGate = gate.showGate();
  gate.unlock();
  assert.equal(await firstGate, true);

  // The user closes the window while that boot is still running, then clicks
  // the Dock icon. Run 2 makes a new window and puts a fresh gate in it.
  const second = gate.beginRun();
  const secondGate = gate.showGate();

  // Run 1's backend comes up and it goes to load the UI. This is the bug: the
  // window it would load into is the new one, showing the PIN prompt.
  if (gate.mayNavigate(first)) loads++;
  assert.equal(loads, 0, 'a superseded run must not load the app');
  assert.equal(gate.locked, true, 'the new gate is still waiting for a PIN');

  // Only the correct PIN opens the library.
  gate.unlock();
  assert.equal(await secondGate, true);
  if (gate.mayNavigate(second)) loads++;
  assert.equal(loads, 1);
});
