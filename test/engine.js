'use strict';
const assert = require('assert');
const E = require('../src/engine.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS ' + name); };
const base = () => E.defaults();

t('defaults: no rate, no Rubrik inputs -> incomplete, no number', () => {
  const r = E.compute(base());
  assert.strictEqual(r.total.kind, 'incomplete'); assert.strictEqual(r.total.amount, null);
  assert.strictEqual(r.platform.licensableCores, 96); assert.strictEqual(r.platform.annual, null);
  assert.ok(r.platform.missing.length && r.rubrik.missing.length === 3);
});
t('VMware: 16-core floor raises 12-core CPUs and says so', () => {
  const i = base(); i.coresPerCpu = 12; i.rates.vmware.VVF = 100;
  const p = E.compute(i).platform; assert.strictEqual(p.physicalCores, 72); assert.strictEqual(p.licensableCores, 96); assert.strictEqual(p.floorAdds, 24); assert.strictEqual(p.annual, 9600);
});
t('VMware: no uplift when cores >= 16; edition picks its own rate', () => {
  const i = base(); i.coresPerCpu = 32; i.rates.vmware = { VVF: 100, VCF: 300 };
  assert.strictEqual(E.compute(i).platform.licensableCores, 192);
  i.vmwareEdition = 'VCF'; assert.strictEqual(E.compute(i).platform.annual, 192 * 300);
});
t('Nutanix: no floor, per physical core', () => {
  const i = base(); i.platform = 'nutanix'; i.coresPerCpu = 8; i.rates.nutanix.Pro = 150;
  const p = E.compute(i).platform; assert.strictEqual(p.licensableCores, 48); assert.strictEqual(p.annual, 48 * 150); assert.strictEqual(p.floorAdds, 0);
});
t('Hyper-V: 8-per-CPU and 16-per-server floors, 2-core steps, per-core price from 16-core pack, amortized', () => {
  const i = base(); i.platform = 'hyperv'; i.cpusPerHost = 1; i.coresPerCpu = 4; i.hosts = 2; i.rates.hyperv.pack16 = 6000;
  let p = E.compute(i).platform; assert.strictEqual(p.licensableCores, 32); assert.strictEqual(p.perpetualTotal, 32 * 375); assert.strictEqual(p.annual, 32 * 375 / 3);
  i.cpusPerHost = 2; i.coresPerCpu = 12; i.hosts = 3; p = E.compute(i).platform; assert.strictEqual(p.licensableCores, 72); assert.strictEqual(p.perpetualTotal, 27000); assert.strictEqual(p.annual, 9000);
  i.cpusPerHost = 1; i.coresPerCpu = 17; i.hosts = 1; p = E.compute(i).platform; assert.strictEqual(p.licensableCores, 18);
  i.amortYears = 5; p = E.compute(i).platform; assert.strictEqual(p.amortYears, 5);
});
t('Rubrik FETB: quantity is front-end TB, annual = qty x rate', () => {
  const i = base(); i.rubrik = { ...i.rubrik, metric: 'FETB', frontEndTB: 30, rate: 1000 };
  const r = E.compute(i).rubrik; assert.strictEqual(r.qty, 30); assert.strictEqual(r.annual, 30000); assert.deepStrictEqual(r.flags, ['needs-confirmation']);
});
t('Rubrik BETB: requires a reduction ratio; quantity = front end / ratio', () => {
  const i = base(); i.rubrik = { ...i.rubrik, metric: 'BETB', frontEndTB: 30, rate: 1000, metricConfirmed: true };
  let r = E.compute(i).rubrik; assert.strictEqual(r.annual, null); assert.ok(r.missing.includes('modeled reduction ratio')); assert.deepStrictEqual(r.flags, []);
  i.rubrik.reductionRatio = 3; r = E.compute(i).rubrik; assert.strictEqual(r.qty, 10); assert.strictEqual(r.annual, 10000);
});
t('Rubrik monthly rate is annualized x12', () => {
  const i = base(); i.rubrik = { ...i.rubrik, metric: 'FETB', frontEndTB: 10, rate: 100, rateUnit: 'perTBMonth', metricConfirmed: true };
  assert.strictEqual(E.compute(i).rubrik.annual, 12000);
});
t('Metric is never inferred from the platform', () => {
  for (const pf of ['vmware', 'nutanix', 'hyperv']) { const i = base(); i.platform = pf; i.rubrik.frontEndTB = 30; i.rubrik.rate = 1000; assert.strictEqual(E.compute(i).rubrik.annual, null); assert.strictEqual(E.compute(i).rubrik.metric, null); }
});
t('Totals: complete, partial-platform, partial-rubrik, incomplete; never a silent zero', () => {
  const i = E.illustrative(); let r = E.compute(i); assert.strictEqual(r.total.kind, 'complete'); assert.strictEqual(r.total.amount, 96 * 100 + 30000);
  i.rubrik.rate = null; r = E.compute(i); assert.strictEqual(r.total.kind, 'partial-platform'); assert.strictEqual(r.total.amount, 9600);
  const j = E.illustrative(); j.rates.vmware.VVF = null; r = E.compute(j); assert.strictEqual(r.total.kind, 'partial-rubrik'); assert.strictEqual(r.total.amount, 30000);
  const k = E.illustrative(); k.rates.vmware.VVF = null; k.rubrik.rate = null; r = E.compute(k); assert.strictEqual(r.total.kind, 'incomplete'); assert.strictEqual(r.total.amount, null);
});
t('Zero rate is treated as not entered, not as a free product', () => {
  const i = E.illustrative(); i.rubrik.rate = 0; assert.strictEqual(E.compute(i).total.kind, 'partial-platform');
});
t('Illustrative values carry the illustrative flag; entering a rate clears it for that rate', () => {
  const i = E.illustrative(); let r = E.compute(i); assert.ok(r.total.flags.includes('illustrative'));
  i.rateStatus.vmware.VVF = 'entered'; i.rubrik.rateStatus = 'entered'; r = E.compute(i); assert.ok(!r.total.flags.includes('illustrative') || r.platform.flags.length === 0);
  assert.deepStrictEqual(r.platform.flags, []); assert.ok(r.rubrik.flags.includes('needs-confirmation'));
});
t('Illustrative sample rates are round numbers, not price points', () => {
  const s = E.illustrative(); const vals = [...Object.values(s.rates.vmware), ...Object.values(s.rates.nutanix), s.rates.hyperv.pack16, s.rubrik.rate];
  assert.ok(vals.every(v => v % 50 === 0));
});
t('Validation: bad structure blocks computation of the affected model only', () => {
  const i = E.illustrative(); i.hosts = 0; let r = E.compute(i); assert.strictEqual(r.platform, null); assert.ok(r.rubrik.annual === 30000); assert.strictEqual(r.total.kind, 'partial-rubrik');
  const j = E.illustrative(); j.rubrik.frontEndTB = -5; r = E.compute(j); assert.strictEqual(r.rubrik, null); assert.strictEqual(r.total.kind, 'partial-platform');
});
t('Reduction ratio below 1 warns, above 0 required', () => {
  const i = base(); i.rubrik = { ...i.rubrik, metric: 'BETB', frontEndTB: 10, reductionRatio: 0.5, rate: 10, metricConfirmed: true };
  assert.ok(E.compute(i).rubrik.warnings.length === 1); i.rubrik.reductionRatio = 0; assert.ok(E.compute(i).errors.length === 1);
});
t('Deterministic: identical inputs give identical output', () => {
  const a = JSON.stringify(E.compute(E.illustrative())), b = JSON.stringify(E.compute(E.illustrative())); assert.strictEqual(a, b);
});
t('Exclusions list names the unmodeled contract mechanics', () => {
  const s = E.EXCLUSIONS.join('|'); assert.ok(/Scale Reviews/.test(s) && /Capacity Burst/.test(s) && /Utility/.test(s));
});
console.log(`\n${n} engine tests passed`);
