/**
 * Tests for the snapshot naming and rotation rules.
 *
 * Run with `npm test` in macOS/. Compiled to dist-electron alongside everything
 * else and excluded from the packaged app (see electron-builder.yml).
 *
 * The rotation test below is the one that matters. Its scenario is a real bug
 * this code shipped with for a day: a shared three-slot pool, plus a downgrade
 * dialog that deliberately leaves the version unstamped when the user backs
 * out, meant three hesitant relaunches of an older build silently deleted the
 * pre-upgrade snapshot the user was trying to get back to.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SNAPSHOT_KEEP,
  hasSnapshotFor,
  isSnapshotName,
  isSnapshotPartName,
  safeVersion,
  selectForPruning,
  snapshotFileName,
  stampFor,
} from './snapshot-names';

const T = new Date('2026-08-18T14:23:45.678Z');

test('names carry both versions, the direction, and a UTC stamp', () => {
  assert.equal(
    snapshotFileName('upgrade', '3.12.1', '3.13.0', T),
    'preupgrade-3.12.1-to-3.13.0-20260818-142345.zip',
  );
  assert.equal(
    snapshotFileName('downgrade', '3.13.0', '3.12.1', T),
    'predowngrade-3.13.0-to-3.12.1-20260818-142345.zip',
  );
});

test('a library with no stamp is named unknown, not left blank', () => {
  assert.equal(
    snapshotFileName('upgrade', null, '3.13.0', T),
    'preupgrade-unknown-to-3.13.0-20260818-142345.zip',
  );
});

test('a hand-edited version cannot steer the write out of the folder', () => {
  for (const hostile of ['../../../../etc/passwd', '/etc/passwd', '..', '....//....//', '']) {
    const name = snapshotFileName('upgrade', hostile, '3.13.0', T);
    assert.ok(!name.includes('/'), `separator survived: ${name}`);
    assert.ok(!name.includes('\\'), `separator survived: ${name}`);
    assert.ok(isSnapshotName(name), `not recognised as ours: ${name}`);
  }
  assert.equal(safeVersion('x'.repeat(200)).length, 32);
});

test('our names are recognised and the backend rotation is left alone', () => {
  assert.ok(isSnapshotName('preupgrade-3.12.1-to-3.13.0-20260818-142345.zip'));
  assert.ok(isSnapshotName('predowngrade-3.13.0-to-3.12.1-20260818-142345.zip'));
  // The backend prunes openmemo-*.db.gz. Never ours, and we never touch theirs.
  assert.ok(!isSnapshotName('openmemo-20260818-120000.db.gz'));
  assert.ok(!isSnapshotName('openmemo.db'));
  assert.ok(!isSnapshotName('preupgrade-3.12.1-to-3.13.0-20260818-142345.zip.part'));
  assert.ok(isSnapshotPartName('preupgrade-3.12.1-to-3.13.0-20260818-142345.zip.part'));
});

test('rotation keeps each direction in its own pool', () => {
  // The regression: one upgrade snapshot, then a user who opens the older build
  // and backs out of the warning several times.
  const entries = [
    { name: 'preupgrade-3.12.1-to-3.13.0-20260818-100000.zip', at: 100 },
    { name: 'predowngrade-3.13.0-to-3.12.1-20260818-110000.zip', at: 110 },
    { name: 'predowngrade-3.13.0-to-3.12.1-20260818-120000.zip', at: 120 },
    { name: 'predowngrade-3.13.0-to-3.12.1-20260818-130000.zip', at: 130 },
    { name: 'predowngrade-3.13.0-to-3.12.1-20260818-140000.zip', at: 140 },
  ];
  const doomed = selectForPruning(entries, SNAPSHOT_KEEP);
  assert.ok(
    !doomed.includes('preupgrade-3.12.1-to-3.13.0-20260818-100000.zip'),
    'the pre-upgrade snapshot must survive downgrade churn',
  );
  assert.deepEqual(doomed, ['predowngrade-3.13.0-to-3.12.1-20260818-110000.zip']);
});

test('rotation drops the oldest first and never the backend snapshots', () => {
  const entries = [
    { name: 'preupgrade-a-to-b-20260818-100000.zip', at: 100 },
    { name: 'preupgrade-a-to-b-20260818-110000.zip', at: 110 },
    { name: 'preupgrade-a-to-b-20260818-120000.zip', at: 120 },
    { name: 'preupgrade-a-to-b-20260818-130000.zip', at: 130 },
    { name: 'openmemo-20260818-090000.db.gz', at: 90 },
    { name: 'yt_cookies.txt', at: 1 },
  ];
  assert.deepEqual(selectForPruning(entries, 3), ['preupgrade-a-to-b-20260818-100000.zip']);
  assert.deepEqual(selectForPruning(entries.slice(4), 3), []);
});

test('a switch already captured is not captured again', () => {
  const names = ['predowngrade-3.13.0-to-3.12.1-20260818-110000.zip'];
  assert.ok(hasSnapshotFor(names, 'downgrade', '3.13.0', '3.12.1'));
  // A different pair, or the other direction, is a different switch.
  assert.ok(!hasSnapshotFor(names, 'downgrade', '3.13.1', '3.12.1'));
  assert.ok(!hasSnapshotFor(names, 'upgrade', '3.13.0', '3.12.1'));
  assert.ok(!hasSnapshotFor([], 'downgrade', '3.13.0', '3.12.1'));
  // A .part is not a captured switch.
  assert.ok(
    !hasSnapshotFor(
      ['predowngrade-3.13.0-to-3.12.1-20260818-110000.zip.part'],
      'downgrade',
      '3.13.0',
      '3.12.1',
    ),
  );
});

test('stamps are UTC and sort chronologically as strings', () => {
  const a = stampFor(new Date('2026-08-18T23:59:59Z'));
  const b = stampFor(new Date('2026-08-19T00:00:01Z'));
  assert.equal(a, '20260818-235959');
  assert.ok(a < b);
});

test('rotation trusts the name, not the mtime, when a clock jumps back', () => {
  // NTP corrects a stale clock mid-session: the newest snapshot by name ends up
  // with the oldest mtime. Sorting on mtime would delete exactly the wrong one.
  const entries = [
    { name: 'preupgrade-a-to-b-20260818-100000.zip', at: 5000 },
    { name: 'preupgrade-a-to-b-20260818-110000.zip', at: 4000 },
    { name: 'preupgrade-a-to-b-20260818-120000.zip', at: 3000 },
    { name: 'preupgrade-a-to-b-20260818-130000.zip', at: 10 },
  ];
  assert.deepEqual(selectForPruning(entries, 3), ['preupgrade-a-to-b-20260818-100000.zip']);
});
