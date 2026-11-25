'use strict';
(function () {
  const { test, assert, load, loadText } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const STATUS = ['confirmed', 'coach', 'proposed', 'open'], CONF = ['high', 'moderate', 'low'];

  test('rules.json: every rule has a status, a confidence, a title, a use and known references', async () => {
    const r = await load('data/rules.json');
    assert.equal(r.app, 'dynamfuel'); assert.ok(r.version);
    for (const [id, x] of Object.entries(r.rules)) {
      assert.ok(STATUS.includes(x.status), `${id}: status`);
      assert.ok(CONF.includes(x.confidence), `${id}: confidence`);
      assert.ok(x.title && x.use, `${id}: title + use`);
      assert.ok(Array.isArray(x.refs), `${id}: refs`);
      for (const ref of x.refs) assert.ok(r.refs[ref], `${id}: unknown ref ${ref}`);
      if (x.status === 'confirmed') assert.ok(x.refs.some(ref => ref !== 'COACH'), `${id}: confirmed needs a source`);
    }
  });

  test('rules.json ⇄ docs/evidence-table.md: the same rule IDs (local only)', async () => {
    const md = await loadText('../docs/evidence-table.md');
    if (md == null) return;                                   // docs/ is not published: skipped on the test site
    const r = await load('data/rules.json');
    const mdIds = [...md.matchAll(/^\| ([A-Z]+-[A-Z0-9-]+) \|/gm)].map(m => m[1]).filter(id => r.rules[id] || /^(CHO|INT|GOAL|TIME|FLU|NA|PRE|CAF|REC|EE|RND|MATCH|AGE|METH|HEAT|MAN)-/.test(id));
    const jsonIds = Object.keys(r.rules);
    assert.deepEqual([...mdIds].sort(), [...jsonIds].sort());
    for (const id of jsonIds) {
      const row = md.split('\n').find(l => l.startsWith(`| ${id} |`));
      const st = row.split('|').map(s => s.trim().replace(/\*/g, '')).filter(Boolean).pop();
      assert.equal(st, r.rules[id].status, `${id}: status in table`);
    }
  });

  test('rules.json: duration bands are ordered and end with an open band', async () => {
    const R = (await load('data/rules.json')).rules;
    const b = ['CHO-DUR-01', 'CHO-DUR-02', 'CHO-DUR-03', 'CHO-DUR-04', 'CHO-DUR-05'].map(id => R[id]);
    for (let i = 1; i < b.length - 1; i++) assert.ok(b[i].maxMin > b[i - 1].maxMin);
    assert.equal(b[4].maxMin, null);
    assert.ok(b.every(x => (x.hi || 0) <= R['CHO-CAP-01'].guidelineMaxGph));
  });
})();
