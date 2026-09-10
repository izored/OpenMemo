/**
 * Tests for picking the .dmg out of a release payload.
 *
 * The fixtures are shaped like the real `/releases/latest` response, blockmap
 * included: that file is what a substring match grabs by mistake, and it is
 * the whole reason this function exists.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickDmgUrl } from './release-assets';

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/izored/OpenMemo/releases/download/v3.21.2/${name}`,
});

test('picks the disk image, not the blockmap beside it', () => {
  const url = pickDmgUrl([
    asset('OpenMemo-3.21.2-arm64.dmg.blockmap'),
    asset('OpenMemo-3.21.2-arm64.dmg'),
  ]);
  assert.equal(url, 'https://github.com/izored/OpenMemo/releases/download/v3.21.2/OpenMemo-3.21.2-arm64.dmg');
});

test('prefers the arm64 image when a release carries more than one', () => {
  const url = pickDmgUrl([asset('OpenMemo-3.21.2-x64.dmg'), asset('OpenMemo-3.21.2-arm64.dmg')]);
  assert.match(url as string, /arm64\.dmg$/);
});

test('takes the only image when nothing names an architecture', () => {
  assert.match(pickDmgUrl([asset('OpenMemo.dmg')]) as string, /OpenMemo\.dmg$/);
});

test('undefined when the release has no image yet, so the caller opens the page', () => {
  assert.equal(pickDmgUrl([asset('Source code.zip')]), undefined);
  assert.equal(pickDmgUrl([]), undefined);
  assert.equal(pickDmgUrl(undefined), undefined);
});

test('ignores an asset with no download URL', () => {
  assert.equal(pickDmgUrl([{ name: 'OpenMemo.dmg' }]), undefined);
});
