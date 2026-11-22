// TCK v2 — SRI loader + install/uninstall/upgrade (CA-A5, CA-A6, O-A1).
// node --test, no browser: fetchFn/importFn/confirmFn injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDistant, isInstalled, compareVersions, upgradeAvailable,
  installPatch, uninstallPatch, installedEntry,
} from '../components/shared/logic.js';
import {
  sha384Base64, checkSri, loadRemoteModule, evictModule, cachedModule,
  SriMismatchError, MissingSriError,
} from '../components/shared/loader.js';
import { installFeature, uninstallFeature, upgradeFeature } from '../components/shared/install.js';

const SRC = 'export default 42; // test remote module';

async function sriOf(src) {
  return 'sha384-' + await sha384Base64(new TextEncoder().encode(src).buffer);
}

// ---------------------------------------------------------------- logic v2
test('v2 isDistant: cdn_url + tag required', () => {
  assert.equal(isDistant({ cdn_url: 'https://cdn/x.js', tag: 'x-a' }), true);
  assert.equal(isDistant({ cdn_url: 'https://cdn/x.js' }), false);
  assert.equal(isDistant({ component: 'x-a' }), false);
  assert.equal(isDistant({ 'features:cdn_url': 'u', 'features:tag': 't' }), true); // JSON-LD prefix
});

test('v2 compareVersions: dotted semantic comparison', () => {
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});

test('v2 isInstalled / upgradeAvailable (CA-A5 / CA-A6)', () => {
  const f = { slug: 'weather', cdn_url: 'u', tag: 'x-weather', version: '2.0.0', sri: 'sha384-x' };
  assert.equal(isInstalled(f, {}), false);
  assert.equal(isInstalled(f, { weather: { installed_version: '1.0.0', installed_sri: 'sha384-y' } }), true);
  assert.equal(isInstalled({ slug: 'packaged', component: 'x-p' }, {}), true); // packaged = installed
  assert.equal(upgradeAvailable(f, { weather: { installed_version: '1.0.0', installed_sri: 's' } }), true);
  assert.equal(upgradeAvailable(f, { weather: { installed_version: '2.0.0', installed_sri: 's' } }), false);
  assert.equal(upgradeAvailable(f, {}), false); // never installed → not an "upgrade"
  assert.equal(upgradeAvailable({ slug: 'p', component: 'x' }, {}), false); // packaged: no upgrade
});

test('v2 installPatch / uninstallPatch (form R1 §2.1)', () => {
  assert.deepEqual(installPatch('weather', '2.0.0', 'sha384-x'),
    { weather: { enabled: true, installed_version: '2.0.0', installed_sri: 'sha384-x' } });
  assert.deepEqual(uninstallPatch('weather'),
    { weather: { enabled: false, installed_version: null, installed_sri: null } });
});

// ---------------------------------------------------------------- loader
test('loader sha384Base64: known vector (SHA-384 of "abc")', async () => {
  // SHA-384("abc") = cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-384', new TextEncoder().encode('abc')))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
  const b64 = await sha384Base64(new TextEncoder().encode('abc').buffer);
  assert.equal(b64, Buffer.from(hex, 'hex').toString('base64'));
});

test('loader checkSri: OK / mismatch / absent / invalid format', async () => {
  const buf = new TextEncoder().encode(SRC).buffer;
  const sri = await sriOf(SRC);
  assert.equal(await checkSri(buf, sri), true);
  await assert.rejects(() => checkSri(buf, 'sha384-' + 'A'.repeat(64)), SriMismatchError);
  await assert.rejects(() => checkSri(buf, null), MissingSriError);
  await assert.rejects(() => checkSri(buf, 'sha256-abc'), SriMismatchError); // wrong algo
});

test('loader loadRemoteModule: valid sri → import; invalid sri → NO import (CA-A5)', async () => {
  const sri = await sriOf(SRC);
  let imports = 0;
  const fetchFn = async () => ({ ok: true, status: 200, text: async () => SRC });
  const importFn = async () => { imports += 1; return { default: 42 }; };
  const r = await loadRemoteModule({ cdnUrl: 'https://cdn.test/a.js', sri, tag: 'x-a' }, { fetchFn, importFn });
  assert.equal(imports, 1);
  assert.equal(r.module.default, 42);
  assert.ok(cachedModule('https://cdn.test/a.js'), 'module cached');
  // cache hit: no re-fetch
  await loadRemoteModule({ cdnUrl: 'https://cdn.test/a.js', sri }, { fetchFn: async () => { throw new Error('must not re-fetch'); }, importFn });
  // invalid sri → import NEVER called
  let imports2 = 0;
  await assert.rejects(
    () => loadRemoteModule({ cdnUrl: 'https://cdn.test/bad.js', sri: 'sha384-' + 'B'.repeat(64) },
      { fetchFn, importFn: async () => { imports2 += 1; } }),
    SriMismatchError);
  assert.equal(imports2, 0, 'CA-A5: no import if sri invalid');
  // absent sri → MissingSriError, no import
  await assert.rejects(
    () => loadRemoteModule({ cdnUrl: 'https://cdn.test/nosri.js', sri: null }, { fetchFn, importFn }),
    MissingSriError);
  // revocation: evict → re-fetch on next load
  assert.equal(evictModule('https://cdn.test/a.js'), true);
  assert.equal(cachedModule('https://cdn.test/a.js'), null);
});

// ---------------------------------------------------------------- install.js
function fakeAppStore(calls) {
  return {
    patches: calls,
    async patchPrefs(p) { calls.push(p); },
    getPrefs() { return {}; },
  };
}

test('installFeature packaged → simple toggle (v1 unchanged)', async () => {
  const calls = [];
  const r = await installFeature(fakeAppStore(calls), { slug: 'dashboard', component: 'x-d' }, {});
  assert.deepEqual(r, { installed: true });
  assert.deepEqual(calls, [{ dashboard: { enabled: true } }]);
});

test('installFeature remote: confirmation refused → nothing; accepted → SRI verified then prefs installPatch', async () => {
  const sri = await sriOf(SRC);
  const feature = { slug: 'weather', cdn_url: 'https://cdn.test/m.js', sri, version: '1.2.0', npm_package: '@facis/weather', tag: 'x-weather' };
  // refused → no load, no patch
  let calls = [];
  let r = await installFeature(fakeAppStore(calls), feature, { confirmFn: async () => false });
  assert.deepEqual(r, { installed: false });
  assert.equal(calls.length, 0);
  // accepted → load + installPatch patch
  calls = [];
  const seen = [];
  const fetchFn = async () => ({ ok: true, text: async () => SRC });
  const importFn = async () => ({});
  r = await installFeature(fakeAppStore(calls), feature, {
    confirmFn: async (info) => { seen.push(info); return true; },
    fetchFn, importFn,
  });
  assert.deepEqual(r, { installed: true, version: '1.2.0', sri });
  assert.equal(seen[0].npmPackage, '@facis/weather');
  assert.equal(seen[0].sri, sri); // the sri is shown in the confirmation (§2.2.3)
  assert.deepEqual(calls, [installPatch('weather', '1.2.0', sri)]);
  // invalid sri → SriMismatchError, NO prefs patch
  calls = [];
  await assert.rejects(
    () => installFeature(fakeAppStore(calls), { ...feature, cdn_url: 'https://cdn.test/bad2.js', sri: 'sha384-' + 'C'.repeat(64) },
      { confirmFn: async () => true, fetchFn, importFn }),
    SriMismatchError);
  assert.equal(calls.length, 0, 'CA-A5: no prefs written if the sri does not match');
});

test('uninstallFeature: remote → evict + patch; packaged → refused (§2.2.4)', async () => {
  const calls = [];
  const sri = await sriOf(SRC);
  const feature = { slug: 'weather', cdn_url: 'https://cdn.test/m2.js', sri, version: '1.0.0', tag: 'x-m' };
  await loadRemoteModule({ cdnUrl: feature.cdn_url, sri }, { fetchFn: async () => ({ ok: true, text: async () => SRC }), importFn: async () => ({}) });
  assert.ok(cachedModule(feature.cdn_url));
  await uninstallFeature(fakeAppStore(calls), feature);
  assert.equal(cachedModule(feature.cdn_url), null, 'module removed from cache');
  assert.deepEqual(calls, [uninstallPatch('weather')]);
  await assert.rejects(() => uninstallFeature(fakeAppStore([]), { slug: 'dashboard', component: 'x-d' }), /not uninstallable/);
});

test('upgradeFeature (CA-A6): catalogue version > installed → re-check sri + patch; else no-op', async () => {
  const sri = await sriOf(SRC);
  const feature = { slug: 'weather', cdn_url: 'https://cdn.test/m3.js', sri, version: '2.0.0', tag: 'x-m' };
  const prefs = { weather: { enabled: true, installed_version: '1.0.0', installed_sri: sri } };
  const calls = [];
  const fetchFn = async () => ({ ok: true, text: async () => SRC });
  const r = await upgradeFeature(fakeAppStore(calls), feature, prefs, { confirmFn: async () => true, fetchFn, importFn: async () => ({}) });
  assert.equal(r.installed, true);
  assert.deepEqual(calls, [installPatch('weather', '2.0.0', sri)]); // new version recorded
  // up to date → no-op
  const r2 = await upgradeFeature(fakeAppStore(calls), feature, { weather: { installed_version: '2.0.0', installed_sri: sri } }, {});
  assert.deepEqual(r2, { upgraded: false });
});

test('loader cache: a cache hit does not skip the sri (CA-A5) — different sri → refused', async () => {
  const sri = await sriOf(SRC);
  const url = 'https://cdn.test/cached.js';
  evictModule(url);
  const fetchFn = async () => ({ ok: true, text: async () => SRC });
  const importFn = async () => ({ default: 1 });
  await loadRemoteModule({ cdnUrl: url, sri }, { fetchFn, importFn });
  // same url, same sri → OK hit
  await loadRemoteModule({ cdnUrl: url, sri }, { fetchFn: async () => { throw new Error('no refetch'); }, importFn });
  // same url, different sri (catalogue upgraded without evict) → refused
  await assert.rejects(
    () => loadRemoteModule({ cdnUrl: url, sri: 'sha384-' + 'D'.repeat(64) }, { fetchFn, importFn }),
    SriMismatchError);
  evictModule(url);
});
