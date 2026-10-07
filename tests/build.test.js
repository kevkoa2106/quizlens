import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('Chrome and Firefox packages use their own supported sidebar manifests', () => {
  execFileSync(process.execPath, ['scripts/build.mjs']);
  const chrome = JSON.parse(readFileSync('dist/chrome/manifest.json'));
  const firefox = JSON.parse(readFileSync('dist/firefox/manifest.json'));
  assert.ok(chrome.background.service_worker);
  assert.ok(chrome.permissions.includes('sidePanel'));
  assert.equal(chrome.side_panel.default_path, 'panel.html');
  assert.deepEqual(firefox.background.scripts, ['background.js']);
  assert.equal(firefox.sidebar_action.default_panel, 'panel.html');
  assert.equal(firefox.permissions.includes('sidePanel'), false);
  assert.equal(firefox.side_panel, undefined);
  assert.equal(firefox.browser_specific_settings.gecko.id, 'quizlens@kevkoa2106.github.io');
});
