'use strict';
/* DynamFuel test harness: the same test files run in the browser (tests.html) and in Node (node --test app/tests/).
   In a test file:  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
   load('tests/fixtures/x.json') and req('engine.js') are relative to the app/ folder. */
(function (root) {
  const inNode = typeof module === 'object' && module.exports && typeof process !== 'undefined' && process.versions && process.versions.node;
  if (inNode) {
    const nt = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
    const base = path.join(__dirname, '..');
    module.exports = {
      test: (name, fn) => nt.test(name, fn),
      pending: (name, why) => nt.test(name, { skip: why || 'pending' }, () => { }),
      assert,
      load: async rel => JSON.parse(fs.readFileSync(path.join(base, rel), 'utf8')),
      loadText: async rel => { try { return fs.readFileSync(path.join(base, rel), 'utf8'); } catch (e) { return null; } },
      req: file => require(path.join(base, file))
    };
    return;
  }
  /* ---- browser: a minimal node:assert look-alike ---- */
  function fail(msg, a, b) { throw new Error(msg + (arguments.length > 1 ? `\n  actual:   ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}` : '')); }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const assert = {
    ok: (v, m) => { if (!v) fail(m || 'expected truthy', v, true); },
    equal: (a, b, m) => { if (a !== b) fail(m || 'not equal', a, b); },
    strictEqual: (a, b, m) => { if (a !== b) fail(m || 'not equal', a, b); },
    notEqual: (a, b, m) => { if (a === b) fail(m || 'should differ', a, b); },
    deepEqual: (a, b, m) => { if (!same(a, b)) fail(m || 'not deep-equal', a, b); },
    deepStrictEqual: (a, b, m) => { if (!same(a, b)) fail(m || 'not deep-equal', a, b); },
    throws: (fn, m) => { try { fn(); } catch (e) { return; } fail(m || 'expected an error'); }
  };
  const mods = { 'fmt.js': 'DFFmt', 'workout.js': 'DFWorkout', 'engine.js': 'DFEngine', 'match.js': 'DFMatch', 'rides.js': 'DFRides', 'backup.js': 'DFBackup', 'i18n.js': 'DFI18N' };
  const list = [];
  root.DFTest = {
    list,
    test: (name, fn) => { list.push({ name, fn }); },
    pending: (name, why) => { list.push({ name, pending: why || 'pending' }); },
    assert,
    load: rel => fetch(rel, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`cannot load ${rel} (${r.status})`); return r.json(); }),
    loadText: rel => fetch(rel, { cache: 'no-store' }).then(r => r.ok ? r.text() : null).catch(() => null),
    req: file => { const g = root[mods[file]]; if (!g) throw new Error(`module ${file} not loaded`); return g; },
    async run(onResult) {
      for (const t of list) {
        if (t.pending) { onResult({ name: t.name, status: 'pending', msg: t.pending }); continue; }
        try { await t.fn(); onResult({ name: t.name, status: 'pass' }); }
        catch (e) { onResult({ name: t.name, status: 'fail', msg: (e && e.message) || String(e) }); }
      }
    }
  };
})(typeof self !== 'undefined' ? self : this);
