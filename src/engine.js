'use strict';
// Rubrik Virtual Stack TCO Calculator, Phase 1 engine. Pure functions, no DOM, no I/O.
// Design rules (Phase 1):
//  - Platform licensing and Rubrik protection are separate models. A platform choice never decides a Rubrik metric.
//  - No vendor price is embedded. Every rate is user-supplied; the "illustrative example" values are round sample numbers.
//  - A missing value is never shown as zero. A line is either computed, or reports what it still needs.
//  - Rubrik capacity is a MODELED quantity until the user confirms the metric in their order.

const RATE_UNITS = { perTBYear: 'per TB per year', perTBMonth: 'per TB per month' };
const GUIDE = 'Rubrik Licensing Guide (v10152026), effective October 15, 2026';

const isNum = v => typeof v === 'number' && isFinite(v);
const pos = v => isNum(v) && v > 0;
const evenUp = n => Math.ceil(n / 2) * 2;

function defaults() {
  return {
    platform: 'vmware',
    hosts: 3, cpusPerHost: 2, coresPerCpu: 16,
    vmwareEdition: 'VVF', nutanixTier: 'Pro',
    // rate: number|null. status: 'entered'|'illustrative' (only meaningful when the rate is non-null)
    rates: { vmware: { VVF: null, VCF: null }, nutanix: { Pro: null, Ultimate: null }, hyperv: { pack16: null } },
    rateStatus: { vmware: { VVF: 'entered', VCF: 'entered' }, nutanix: { Pro: 'entered', Ultimate: 'entered' }, hyperv: { pack16: 'entered' } },
    amortYears: 3, amortStatus: 'illustrative',
    // Host, CPU and core counts start as sample values. 'entered' once the user edits any of them.
    configStatus: 'illustrative',
    rubrik: { metric: null, metricConfirmed: false, frontEndTB: null, reductionRatio: null, rate: null, rateUnit: 'perTBYear', rateStatus: 'entered' }
  };
}

// Round sample values. Deliberately not real price points, so they cannot be mistaken for a quote or a list price.
function illustrative() {
  const s = defaults();
  s.rates = { vmware: { VVF: 100, VCF: 300 }, nutanix: { Pro: 150, Ultimate: 250 }, hyperv: { pack16: 6000 } };
  for (const g of Object.keys(s.rateStatus)) for (const k of Object.keys(s.rateStatus[g])) s.rateStatus[g][k] = 'illustrative';
  s.rubrik = { metric: 'FETB', metricConfirmed: false, frontEndTB: 30, reductionRatio: null, rate: 1000, rateUnit: 'perTBYear', rateStatus: 'illustrative' };
  return s;
}

function validate(i) {
  const errs = [];
  for (const [k, label] of [['hosts', 'Hosts'], ['cpusPerHost', 'CPUs per host'], ['coresPerCpu', 'Cores per CPU']])
    if (!(Number.isInteger(i[k]) && i[k] >= 1)) errs.push({ field: k, msg: label + ' must be a whole number of 1 or more.' });
  if (i.platform === 'hyperv' && !(isNum(i.amortYears) && i.amortYears >= 1 && i.amortYears <= 10)) errs.push({ field: 'amortYears', msg: 'Amortization must be between 1 and 10 years.' });
  const r = i.rubrik;
  if (r.frontEndTB !== null && !pos(r.frontEndTB)) errs.push({ field: 'frontEndTB', msg: 'Protected front-end capacity must be greater than 0 TB.' });
  if (r.reductionRatio !== null && !pos(r.reductionRatio)) errs.push({ field: 'reductionRatio', msg: 'Reduction ratio must be greater than 0.' });
  if (r.rate !== null && !(isNum(r.rate) && r.rate >= 0)) errs.push({ field: 'rubrikRate', msg: 'Rubrik rate cannot be negative.' });
  return errs;
}

function currentRate(i) {
  if (i.platform === 'vmware') return { v: i.rates.vmware[i.vmwareEdition], st: i.rateStatus.vmware[i.vmwareEdition] };
  if (i.platform === 'nutanix') return { v: i.rates.nutanix[i.nutanixTier], st: i.rateStatus.nutanix[i.nutanixTier] };
  return { v: i.rates.hyperv.pack16, st: i.rateStatus.hyperv.pack16 };
}

// ---- platform model ----
function platformModel(i) {
  const hosts = i.hosts, cpus = i.cpusPerHost, cpc = i.coresPerCpu;
  const physical = hosts * cpus * cpc;
  let licensable, unit, floor, kind, label;
  if (i.platform === 'vmware') {
    licensable = hosts * cpus * Math.max(16, cpc);
    unit = 'cores'; kind = 'subscription'; label = 'VMware ' + i.vmwareEdition;
    floor = '16-core-per-CPU minimum applied (carried over from the previous version). Order minimums may also apply; check them against your quote.';
  } else if (i.platform === 'nutanix') {
    licensable = physical;
    unit = 'cores'; kind = 'subscription'; label = 'Nutanix NCI ' + i.nutanixTier;
    floor = 'No per-CPU floor is modeled. Check your quote for minimums.';
  } else {
    const perHost = evenUp(Math.max(16, cpus * Math.max(8, cpc)));
    licensable = perHost * hosts;
    unit = 'cores'; kind = 'amortized-perpetual'; label = 'Hyper-V Windows Server Datacenter';
    floor = 'Windows Server core rules modeled: 8-core minimum per processor, 16-core minimum per server, licensed in 2-core steps. Check them against your agreement.';
  }
  const { v: rate, st } = currentRate(i);
  const out = { label, unit, kind, physicalCores: physical, licensableCores: licensable, floorNote: floor, floorAdds: licensable - physical, rate, rateStatus: st, missing: [], annual: null, perpetualTotal: null, amortYears: null, flags: [] };
  if (!pos(rate)) { out.missing.push(i.platform === 'hyperv' ? 'Datacenter 16-core pack price' : 'rate per core per year'); return out; }
  if (i.platform === 'hyperv') {
    out.perpetualTotal = licensable * (rate / 16);
    out.amortYears = i.amortYears;
    out.annual = out.perpetualTotal / i.amortYears;
    if (i.amortStatus === 'illustrative') out.flags.push('illustrative');
  } else out.annual = licensable * rate;
  if (st === 'illustrative') out.flags.push('illustrative');
  if (i.configStatus === 'illustrative') out.flags.push('illustrative-config');
  out.flags = [...new Set(out.flags)];
  return out;
}

// ---- Rubrik protection model ----
function rubrikModel(i) {
  const r = i.rubrik, out = { metric: r.metric, qty: null, qtyUnit: null, annual: null, annualRate: null, missing: [], flags: [], reductionUsed: null, warnings: [] };
  if (!r.metric) out.missing.push('licensing metric (FETB or BETB)');
  if (!pos(r.frontEndTB)) out.missing.push('protected front-end capacity (TB)');
  if (r.metric === 'BETB' && !pos(r.reductionRatio)) out.missing.push('modeled reduction ratio');
  if (!(isNum(r.rate) && r.rate > 0)) out.missing.push('quoted rate');
  if (pos(r.frontEndTB) && r.metric) {
    if (r.metric === 'FETB') { out.qty = r.frontEndTB; out.qtyUnit = 'FETB'; }
    else if (pos(r.reductionRatio)) { out.qty = r.frontEndTB / r.reductionRatio; out.qtyUnit = 'BETB'; out.reductionUsed = r.reductionRatio; if (r.reductionRatio < 1) out.warnings.push('Reduction ratio is below 1: the back-end quantity is larger than the front end. Check the value.'); }
  }
  if (out.missing.length === 0) {
    out.annualRate = r.rateUnit === 'perTBMonth' ? r.rate * 12 : r.rate;
    out.annual = out.qty * out.annualRate;
  }
  if (r.metric && !r.metricConfirmed) out.flags.push('needs-confirmation');
  if (r.rate !== null && r.rateStatus === 'illustrative') out.flags.push('illustrative');
  return out;
}

function compute(i) {
  const errors = validate(i);
  const bad = new Set(errors.map(e => e.field));
  const platformOk = !['hosts', 'cpusPerHost', 'coresPerCpu', 'amortYears'].some(f => bad.has(f));
  const platform = platformOk ? platformModel(i) : null;
  const rubrik = ['frontEndTB', 'reductionRatio', 'rubrikRate'].some(f => bad.has(f)) ? null : rubrikModel(i);
  const p = platform && platform.annual !== null ? platform.annual : null, r = rubrik && rubrik.annual !== null ? rubrik.annual : null;
  let kind = 'incomplete', amount = null;
  if (p !== null && r !== null) { kind = 'complete'; amount = p + r; }
  else if (p !== null) { kind = 'partial-platform'; amount = p; }
  else if (r !== null) { kind = 'partial-rubrik'; amount = r; }
  const flags = [...new Set([...(platform ? platform.flags : []), ...(rubrik ? rubrik.flags : [])])];
  return { errors, platform, rubrik, total: { kind, amount, flags } };
}

const EXCLUSIONS = [
  'Hardware and appliances, including Rubrik-branded hardware',
  'Customer Resilience Manager and support bundles',
  'Add-on products: Rubrik Cloud Vault, Universal Cloud License, SaaS, identity and other add-ons',
  'Capacity growth, Scale Reviews, Capacity Burst events and Utility on-demand charges',
  'Edition entitlements and workload-specific counting rules',
  'Discounts, taxes, services and training'
];

const fmt = n => n === null || n === undefined ? 'n/a' : '$' + Math.round(n).toLocaleString('en-US');
const fmtN = (n, d) => n === null || n === undefined ? 'n/a' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d === undefined ? 1 : d });

if (typeof module !== 'undefined') module.exports = { defaults, illustrative, validate, compute, platformModel, rubrikModel, EXCLUSIONS, RATE_UNITS, GUIDE, fmt, fmtN };
