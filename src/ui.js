'use strict';
// UI for the Rubrik Virtual Stack TCO Calculator, Phase 1. Live recalculation: every input event recomputes.
// No network, storage or cookie APIs are used anywhere in this file.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = defaults();
let lastResult = null;

const CHIP = {
  entered: ['&#10003;', 'Entered by you', 'entered'],
  illus: ['&#9680;', 'Illustrative', 'illus'],
  conf: ['?', 'Needs confirmation', 'conf'],
  req: ['!', 'Required', 'req']
};
const chip = (k, label) => `<span class="chip ${CHIP[k][2]}"><i aria-hidden="true">${CHIP[k][0]}</i>${esc(label || CHIP[k][1])}</span>`;
const flagChip = f => f === 'illustrative' ? chip('illus') : f === 'illustrative-config' ? chip('illus', 'Illustrative configuration') : f === 'needs-confirmation' ? chip('conf') : '';
const FLAG_TEXT = { 'illustrative': 'Illustrative', 'illustrative-config': 'Illustrative configuration (host, CPU and core counts not edited)', 'needs-confirmation': 'Needs confirmation' };

const PLAT = { vmware: 'VMware', nutanix: 'Nutanix', hyperv: 'Hyper-V' };
const val = v => v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? '' : v;
const read = el => el.value.trim() === '' ? null : Number(el.value);
const readStruct = el => el.value.trim() === '' ? NaN : Number(el.value);

function rateField() {
  if (S.platform === 'vmware') return { label: `VMware ${S.vmwareEdition} rate, per core per year`, value: S.rates.vmware[S.vmwareEdition], status: S.rateStatus.vmware[S.vmwareEdition] };
  if (S.platform === 'nutanix') return { label: `Nutanix NCI ${S.nutanixTier} rate, per core per year`, value: S.rates.nutanix[S.nutanixTier], status: S.rateStatus.nutanix[S.nutanixTier] };
  return { label: 'Windows Server Datacenter 16-core pack price (one-time)', value: S.rates.hyperv.pack16, status: S.rateStatus.hyperv.pack16 };
}
function setRate(v) {
  if (S.platform === 'vmware') { S.rates.vmware[S.vmwareEdition] = v; S.rateStatus.vmware[S.vmwareEdition] = 'entered'; }
  else if (S.platform === 'nutanix') { S.rates.nutanix[S.nutanixTier] = v; S.rateStatus.nutanix[S.nutanixTier] = 'entered'; }
  else { S.rates.hyperv.pack16 = v; S.rateStatus.hyperv.pack16 = 'entered'; }
}

const tog = (act, v, label, pressed) => `<button type="button" class="toggle-btn" data-act="${act}" data-v="${v}" aria-pressed="${pressed}">${label}</button>`;

function renderForm() {
  const rf = rateField(), r = S.rubrik;
  const sub = S.platform === 'vmware' ? `<div class="toggle-group" role="group" aria-label="VMware edition">${tog('edition', 'VVF', 'VVF', S.vmwareEdition === 'VVF')}${tog('edition', 'VCF', 'VCF', S.vmwareEdition === 'VCF')}</div>`
    : S.platform === 'nutanix' ? `<div class="toggle-group" role="group" aria-label="Nutanix tier">${tog('tier', 'Pro', 'NCI Pro', S.nutanixTier === 'Pro')}${tog('tier', 'Ultimate', 'NCI Ultimate', S.nutanixTier === 'Ultimate')}</div>` : '';
  const amort = S.platform === 'hyperv' ? `<div class="field" id="fld-amortYears"><label for="f-amort">Amortization period, years ${chip(S.amortStatus === 'illustrative' ? 'illus' : 'entered')}</label><input id="f-amort" type="number" min="1" max="10" step="1" inputmode="numeric" value="${val(S.amortYears)}"><div class="hint">Spreads the one-time price over this period. The result is an amortized figure, not a subscription cost.</div></div>` : '';
  $('form').innerHTML = `
  <div class="card-actions">
    <button type="button" class="action-btn" data-act="example">Load illustrative example</button>
    <button type="button" class="link-btn" data-act="clear">Clear rates and Rubrik inputs</button>
  </div>
  <section class="card" aria-labelledby="h-platform">
    <div class="section-label" id="h-platform">Platform licensing</div>
    <div class="toggle-group" role="group" aria-label="Platform">${['vmware', 'nutanix', 'hyperv'].map(p => tog('platform', p, PLAT[p], S.platform === p)).join('')}</div>
    ${sub}
    <div class="grid3">
      <div class="field" id="fld-hosts"><label for="f-hosts">Hosts</label><input id="f-hosts" type="number" min="1" step="1" inputmode="numeric" value="${val(S.hosts)}"></div>
      <div class="field" id="fld-cpusPerHost"><label for="f-cpus">CPUs per host</label><input id="f-cpus" type="number" min="1" step="1" inputmode="numeric" value="${val(S.cpusPerHost)}"></div>
      <div class="field" id="fld-coresPerCpu"><label for="f-cores">Cores per CPU</label><input id="f-cores" type="number" min="1" step="1" inputmode="numeric" value="${val(S.coresPerCpu)}"></div>
    </div>
    <div class="field" id="fld-rate"><label for="f-rate">${esc(rf.label)} <span id="chip-rate"></span></label><input id="f-rate" type="number" min="0" step="any" inputmode="decimal" value="${val(rf.value)}" placeholder="Enter your rate"><div class="hint">Use the rate from your quote or agreement. Nothing is prefilled from a price list.</div></div>
    ${amort}
    <div class="derived" id="derived-platform"></div>
  </section>
  <section class="card" aria-labelledby="h-rubrik">
    <div class="section-label" id="h-rubrik">Rubrik protection</div>
    <div class="flabel hint mb12">Licensing metric in your order <span id="chip-metric"></span></div>
    <div class="toggle-group" role="group" aria-label="Rubrik licensing metric">${tog('metric', 'FETB', 'FETB: front-end', r.metric === 'FETB')}${tog('metric', 'BETB', 'BETB: back-end', r.metric === 'BETB')}</div>
    <label class="check"><input type="checkbox" id="f-confirm" ${r.metricConfirmed ? 'checked' : ''}><span>My order or quote states this metric</span></label>
    <div class="hint mb12">Platform choice does not set the metric. The licensing guide's default for Rubrik Scale on-premises workloads is BETB, with FETB on-premises by approval, and for cloud workloads FETB (Rubrik Licensing Guide v10152026, p. 10). Your order governs.</div>
    <div class="grid2">
      <div class="field" id="fld-frontEndTB"><label for="f-fetb">Protected front-end capacity, TB</label><input id="f-fetb" type="number" min="0" step="any" inputmode="decimal" value="${val(r.frontEndTB)}" placeholder="TB of source data"></div>
      ${r.metric === 'BETB' ? `<div class="field" id="fld-reductionRatio"><label for="f-ratio">Modeled reduction ratio, front-end : back-end</label><input id="f-ratio" type="number" min="0" step="any" inputmode="decimal" value="${val(r.reductionRatio)}" placeholder="e.g. 3 for 3:1"></div>` : '<div></div>'}
    </div>
    ${r.metric === 'BETB' ? '<div class="hint mb12">A modeled assumption, not a contract term. A license conversion of 1 BETB to 1 FETB between on-premises and cloud (guide p. 11) is a different thing from a data-reduction ratio.</div>' : ''}
    <div class="field" id="fld-rubrikRate"><label for="f-rrate">Quoted Rubrik rate <span id="chip-rrate"></span></label>
      <div class="inline"><input id="f-rrate" type="number" min="0" step="any" inputmode="decimal" value="${val(r.rate)}" placeholder="Enter your rate"><select id="f-runit" aria-label="Rate unit"><option value="perTBYear" ${r.rateUnit === 'perTBYear' ? 'selected' : ''}>per TB per year</option><option value="perTBMonth" ${r.rateUnit === 'perTBMonth' ? 'selected' : ''}>per TB per month</option></select></div>
      <div class="hint">The rate applies to the metric you selected.</div></div>
    <div class="derived" id="derived-rubrik"></div>
  </section>`;
}

function renderDerived(R) {
  const rf = rateField();
  $('chip-rate').innerHTML = rf.value === null || !(rf.value > 0) ? chip('req') : chip(rf.status === 'illustrative' ? 'illus' : 'entered');
  $('chip-rrate').innerHTML = S.rubrik.rate === null || !(S.rubrik.rate > 0) ? chip('req') : chip(S.rubrik.rateStatus === 'illustrative' ? 'illus' : 'entered');
  $('chip-metric').innerHTML = !S.rubrik.metric ? chip('req') : S.rubrik.metricConfirmed ? chip('entered', 'Confirmed by you') : chip('conf');
  const p = R.platform;
  const cfg = S.configStatus === 'illustrative' ? chip('illus', 'Illustrative sample configuration') : chip('entered', 'Configuration entered by you');
  $('derived-platform').innerHTML = p ? `Physical cores <b>${fmtN(p.physicalCores, 0)}</b> &rarr; licensable <b>${fmtN(p.licensableCores, 0)}</b>${p.floorAdds > 0 ? ` <span class="adds">(+${fmtN(p.floorAdds, 0)} from the platform floor)</span>` : ''}<br>${esc(p.floorNote)}<div class="cfgrow">${cfg}</div>` : 'Fix the highlighted platform inputs to see licensable cores.';
  const q = R.rubrik;
  $('derived-rubrik').innerHTML = rubrikDerived(R);
  const errs = R.errors;
  $('errs').hidden = errs.length === 0; $('errs').innerHTML = errs.length ? '<ul>' + errs.map(e => `<li>${esc(e.msg)}</li>`).join('') + '</ul>' : '';
  document.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  errs.forEach(e => { const f = $('fld-' + e.field); if (f) f.classList.add('invalid'); });
}

function rubrikDerived(R) {
  const r = S.rubrik, q = R.rubrik;
  const prov = r.metric && !r.metricConfirmed ? '<br><b class="prov">Provisional:</b> the metric is not confirmed in your order, so this is not a billing figure.' : '';
  if (!r.metric) return 'Choose a metric and enter protected capacity to see the modeled quantity.';
  if (r.metric === 'FETB') {
    return (q && q.qty !== null ? `Your rate applies to the protected front-end capacity: modeled quantity <b>${fmtN(q.qty, 2)} FETB</b>.` : 'Your rate applies to the protected front-end capacity. Enter that capacity to see the modeled quantity.') + prov;
  }
  if (!(r.reductionRatio > 0)) return 'Your rate applies to modeled back-end capacity, which is front-end capacity divided by a reduction ratio. <b>Enter a reduction ratio to calculate it.</b> The ratio is your assumption, not a Rubrik figure.' + prov;
  return (q && q.qty !== null ? `Your rate applies to modeled back-end capacity: ${fmtN(r.frontEndTB, 2)} TB front-end &divide; ${fmtN(r.reductionRatio, 2)} = <b>${fmtN(q.qty, 2)} BETB</b>.` : 'Enter protected front-end capacity to see the modeled back-end quantity.') + '<br>The ratio is your assumption, not a Rubrik figure.' + prov;
}

function bridgeHTML(R) {
  const r = S.rubrik, q = R.rubrik;
  const fe = r.frontEndTB > 0 ? r.frontEndTB : null;
  const ratio = r.reductionRatio;
  const haveRatio = ratio > 0;
  const feBilled = r.metric === 'FETB', beBilled = r.metric === 'BETB';
  const beQty = fe && haveRatio ? fe / ratio : null;
  const beW = haveRatio ? Math.max(4, Math.min(100, 100 / ratio)) : 100;
  const label = !fe ? 'Enter protected front-end capacity to draw the bridge.' : !r.metric ? 'Choose a licensing metric to mark the modeled quantity.' : '';
  const ratioTxt = haveRatio ? `Modeled reduction ratio ${fmtN(ratio, 2)}:1. An assumption, not a contract term.` : (beBilled ? 'Reduction ratio required for BETB.' : 'Reduction ratio not entered. It only matters if the order is metered in BETB.');
  const aria = `Front-end capacity ${fe ? fmtN(fe, 2) + ' TB' : 'not entered'}. Back-end capacity ${beQty ? fmtN(beQty, 2) + ' TB modeled' : 'not modeled'}. ${r.metric ? 'Modeled quantity is on the ' + r.metric + ' side.' : 'No metric chosen.'}`;
  return `<div class="bridge" role="img" aria-label="${esc(aria)}">
    <div class="bt">Metric bridge: where the modeled quantity sits</div>
    <div class="br-row"><span class="br-k">FETB</span><div class="br-track"><div class="br-bar full ${feBilled ? 'billed' : ''} ${fe ? '' : 'pending'}"></div></div><span class="br-v ${fe ? '' : 'na'}">${fe ? fmtN(fe, 2) + ' TB' : 'needed'}</span></div>
    <div class="br-mid"><span></span><div class="br-ratio">${esc(ratioTxt)}</div></div>
    <div class="br-row"><span class="br-k">BETB</span><div class="br-track"><div class="br-bar ${beBilled ? 'billed' : ''} ${fe && haveRatio ? '' : 'pending'}" data-w="${beW}"></div></div><span class="br-v ${beQty ? '' : 'na'}">${beQty ? fmtN(beQty, 2) + ' TB' : 'needed'}</span></div>
    <div class="br-note">${esc(label)}${label ? ' ' : ''}Highlighted bar: the quantity the selected metric would be applied to. Modeled, not billed.</div>
  </div>`;
}

function lineChips(p) {
  const f = p.flags.map(flagChip).join('');
  if (p.missing.length) return chip('req') + f;
  return f || chip('entered');
}

function renderResults(R) {
  const t = R.total, p = R.platform, q = R.rubrik;
  let head;
  const fl = t.flags.map(flagChip).join('');
  const prov = t.flags.includes('needs-confirmation');
  if (t.kind === 'complete') head = `<div class="total complete ${prov ? 'prov' : ''}"><div class="tl">Annualized stack total${prov ? ', provisional' : ''}</div><div class="tv">${fmt(t.amount)}</div><div class="ts">Platform plus Rubrik, per year. Excludes the items listed below.${prov ? ' Provisional: the Rubrik metric is not confirmed in your order.' : ''}</div><div class="chips">${fl}</div></div>`;
  else if (t.kind === 'incomplete') head = `<div class="total empty"><div class="tl">No total yet</div><div class="tv">Enter your rates to begin.</div><div class="ts">Each model needs its own inputs. A missing value is never counted as zero. <button type="button" class="link-btn" data-act="example">Load illustrative example</button></div></div>`;
  else {
    const which = t.kind === 'partial-platform' ? 'platform only' : 'Rubrik only';
    const need = t.kind === 'partial-platform' ? (q ? q.missing : ['Rubrik inputs']) : (p ? p.missing : ['platform inputs']);
    head = `<div class="total partial"><div class="tl">Partial total: ${which}${prov ? ', provisional' : ''}</div><div class="tv">${fmt(t.amount)}</div><div class="ts">${t.kind === 'partial-platform' ? 'Rubrik' : 'Platform'} is not included. Still needed: ${esc(need.join(', '))}.</div><div class="chips">${fl}</div></div>`;
  }
  let pl = '';
  if (p) {
    pl = `<div class="line"><div class="lh"><span class="lt">${esc(p.label)}</span>${p.annual !== null ? `<span class="la">${fmt(p.annual)}/yr</span>` : '<span class="la na">no figure yet</span>'}</div>
      <div class="lm">${fmtN(p.licensableCores, 0)} licensable cores from ${fmtN(p.physicalCores, 0)} physical${p.kind === 'amortized-perpetual' && p.perpetualTotal !== null ? `<br>One-time ${fmt(p.perpetualTotal)} spread over ${p.amortYears} years (amortized, not a subscription)` : p.kind === 'subscription' && p.annual !== null ? '<br>Subscription, per year' : ''}${p.missing.length ? `<br><span class="need">Needs: ${esc(p.missing.join(', '))}</span>` : ''}</div>
      <div class="chips">${lineChips(p)}</div></div>`;
  } else pl = '<div class="line"><div class="lh"><span class="lt">Platform</span><span class="la na">fix inputs</span></div></div>';
  let rl = '';
  if (q) {
    rl = `<div class="line"><div class="lh"><span class="lt">Rubrik protection</span>${q.annual !== null ? `<span class="la">${fmt(q.annual)}/yr</span>` : '<span class="la na">no figure yet</span>'}</div>
      <div class="lm">${q.qty !== null ? `Modeled quantity ${fmtN(q.qty, 2)} ${q.qtyUnit}${q.annual !== null ? ` at ${fmt(q.annualRate)} per TB per year` : ''}` : 'No quantity yet'}${q.warnings.length ? `<br><span class="warn">${esc(q.warnings[0])}</span>` : ''}${q.missing.length ? `<br><span class="need">Needs: ${esc(q.missing.join(', '))}</span>` : ''}</div>
      <div class="chips">${q.missing.length ? chip('req') : ''}${q.flags.map(flagChip).join('')}${!q.missing.length && !q.flags.length ? chip('entered') : ''}</div></div>`;
  } else rl = '<div class="line"><div class="lh"><span class="lt">Rubrik protection</span><span class="la na">fix inputs</span></div></div>';
  $('rp').innerHTML = head + pl + rl + bridgeHTML(R) +
    `<details class="excl"><summary>What this estimate excludes</summary><ul>${EXCLUSIONS.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>
     <div class="hint">Rates are the ones you entered. This is a calculation, not a quote.</div>
     <div class="action-row"><button type="button" class="action-btn" data-act="copy" id="btn-copy">Copy results</button><button type="button" class="action-btn secondary" data-act="print">Print / Save PDF</button></div>`;
  // Bar widths are set through the DOM: the CSP forbids inline style attributes.
  $('rp').querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  const summary = t.kind === 'incomplete' ? 'No total yet' : (t.kind === 'complete' ? 'Annualized stack total ' : 'Partial total ') + fmt(t.amount);
  $('mbar-amt').textContent = t.amount === null ? 'No total yet' : fmt(t.amount);
  $('mbar-st').textContent = t.kind === 'complete' ? (prov ? 'Provisional' : 'Annualized') : t.kind === 'incomplete' ? 'Enter rates' : 'Partial';
  $('live').textContent = summary;
}

function statusText(flags, missing) { return missing && missing.length ? 'Required: ' + missing.join(', ') : (flags.length ? flags.map(f => FLAG_TEXT[f] || f).join('; ') : 'Entered by you'); }

function summaryText(R) {
  const t = R.total, p = R.platform, q = R.rubrik, r = S.rubrik, L = [];
  L.push('Rubrik Virtual Stack TCO Calculator (rack2cloud.com)');
  if (t.flags.includes('needs-confirmation')) L.push('PROVISIONAL: the Rubrik licensing metric is not confirmed in the order.');
  L.push((t.kind === 'complete' ? 'Annualized stack total: ' : t.kind === 'incomplete' ? 'No total yet' : 'Partial total (' + (t.kind === 'partial-platform' ? 'platform only' : 'Rubrik only') + '): ') + (t.amount === null ? '' : fmt(t.amount)));
  if (p) L.push(`Platform: ${p.label}; ${S.hosts} hosts x ${S.cpusPerHost} CPUs x ${S.coresPerCpu} cores (${S.configStatus === 'illustrative' ? 'illustrative sample configuration' : 'entered by you'}); rate ${p.rate === null ? 'not entered' : fmtN(p.rate, 2) + (S.platform === 'hyperv' ? ' per 16-core pack, one-time' : ' per core per year')}; ${fmtN(p.licensableCores, 0)} licensable cores; ${p.annual === null ? 'no figure yet' : fmt(p.annual) + ' per year' + (p.kind === 'amortized-perpetual' ? ` (one-time ${fmt(p.perpetualTotal)} amortized over ${p.amortYears} years)` : '')} [${statusText(p.flags, p.missing)}]`);
  if (q) L.push(`Rubrik: metric ${r.metric || 'not chosen'}; protected front-end ${r.frontEndTB === null ? 'not entered' : r.frontEndTB + ' TB'}${r.metric === 'BETB' && r.reductionRatio ? '; modeled reduction ratio ' + r.reductionRatio + ':1' : ''}; modeled quantity ${q.qty === null ? 'n/a' : fmtN(q.qty, 2) + ' ' + q.qtyUnit}; ${q.annual === null ? 'no figure yet' : fmt(q.annual) + ' per year at ' + r.rate + ' ' + RATE_UNITS[r.rateUnit]} [${statusText(q.flags, q.missing)}]`);
  L.push('Status key: Entered by you = your value; Illustrative = sample value, not a price; Illustrative configuration = host, CPU and core counts left at the sample values; Needs confirmation = metric not confirmed in your order; Required = a missing value blocks the figure.');
  L.push('Excludes: ' + EXCLUSIONS.join('; ') + '.');
  L.push('Rates are user-supplied. This is a calculation, not a quote.');
  return L.join('\n');
}

function printReport(R) {
  const t = R.total, p = R.platform, q = R.rubrik, r = S.rubrik;
  const row = (a, b) => `<tr><th>${esc(a)}</th><td>${b}</td></tr>`;
  $('rpt-body').innerHTML = `<h1>Rubrik Virtual Stack TCO Calculator</h1><div>rack2cloud.com</div>
  <section><h2>Result</h2>${t.flags.includes('needs-confirmation') ? '<div><b>PROVISIONAL:</b> the Rubrik licensing metric is not confirmed in the order.</div>' : ''}<div class="big">${t.amount === null ? 'No total yet' : fmt(t.amount)}</div><div>${t.kind === 'complete' ? 'Annualized stack total (platform plus Rubrik, per year)' : t.kind === 'incomplete' ? 'Inputs are incomplete. No figure is shown.' : 'Partial total: ' + (t.kind === 'partial-platform' ? 'platform only; Rubrik is not included' : 'Rubrik only; platform is not included')}</div></section>
  <section><h2>Platform</h2><table>${p ? row('Platform', esc(p.label)) + row('Hosts, CPUs, cores', `${S.hosts} x ${S.cpusPerHost} x ${S.coresPerCpu} (${S.configStatus === 'illustrative' ? 'illustrative sample configuration' : 'entered by you'})`) + row('Licensable cores', fmtN(p.licensableCores, 0) + ' (physical ' + fmtN(p.physicalCores, 0) + ')') + row('Rate', p.rate === null ? 'not entered' : fmtN(p.rate, 2) + (S.platform === 'hyperv' ? ' per 16-core pack, one-time' : ' per core per year')) + (p.perpetualTotal !== null ? row('One-time total', fmt(p.perpetualTotal) + ', amortized over ' + p.amortYears + ' years') : '') + row('Annual', p.annual === null ? 'no figure yet' : fmt(p.annual)) + row('Status', esc(statusText(p.flags, p.missing))) + row('Basis note', esc(p.floorNote)) : row('Platform', 'inputs need correction')}</table></section>
  <section><h2>Rubrik protection</h2><table>${q ? row('Metric', esc(r.metric || 'not chosen') + (r.metricConfirmed ? ' (confirmed by you in your order)' : ' (not confirmed)')) + row('Protected front-end', r.frontEndTB === null ? 'not entered' : r.frontEndTB + ' TB') + (r.metric === 'BETB' ? row('Modeled reduction ratio', r.reductionRatio ? r.reductionRatio + ':1 (an assumption, not a contract term)' : 'not entered') : '') + row('Modeled quantity', q.qty === null ? 'n/a' : fmtN(q.qty, 2) + ' ' + q.qtyUnit) + row('Rate', r.rate === null ? 'not entered' : r.rate + ' ' + RATE_UNITS[r.rateUnit]) + row('Annual', q.annual === null ? 'no figure yet' : fmt(q.annual)) + row('Status', esc(statusText(q.flags, q.missing))) : row('Rubrik', 'inputs need correction')}</table></section>
  <section><h2>Status key</h2><ul><li>Entered by you: a value you supplied.</li><li>Illustrative: a sample value, not a price. Illustrative configuration: host, CPU and core counts left at the sample values.</li><li>Needs confirmation: the metric is not confirmed in your order.</li><li>Required: a missing value blocks the figure.</li></ul></section>
  <section><h2>Excluded from this estimate</h2><ul>${EXCLUSIONS.map(e => `<li>${esc(e)}</li>`).join('')}</ul></section>
  <section><h2>Basis</h2><p>Rates are the ones you entered. This is a calculation, not a quote. Rubrik licensing terms referenced: ${esc(GUIDE)}.</p></section>`;
}

function recalc() { const R = compute(S); lastResult = R; renderDerived(R); renderResults(R); }

function keepFocus(sel) { const el = document.querySelector(sel); if (el) el.focus(); }

document.addEventListener('input', e => {
  const id = e.target.id;
  if (!id || !id.startsWith('f-')) return;
  if (id === 'f-hosts') { S.hosts = readStruct(e.target); S.configStatus = 'entered'; }
  else if (id === 'f-cpus') { S.cpusPerHost = readStruct(e.target); S.configStatus = 'entered'; }
  else if (id === 'f-cores') { S.coresPerCpu = readStruct(e.target); S.configStatus = 'entered'; }
  else if (id === 'f-rate') setRate(read(e.target));
  else if (id === 'f-amort') { S.amortYears = readStruct(e.target); S.amortStatus = 'entered'; }
  else if (id === 'f-fetb') S.rubrik.frontEndTB = read(e.target);
  else if (id === 'f-ratio') S.rubrik.reductionRatio = read(e.target);
  else if (id === 'f-rrate') { S.rubrik.rate = read(e.target); S.rubrik.rateStatus = 'entered'; }
  else if (id === 'f-runit') S.rubrik.rateUnit = e.target.value;
  else if (id === 'f-confirm') S.rubrik.metricConfirmed = e.target.checked;
  else return;
  recalc();
});

// Platform configuration survives Load example and Clear: only rates and Rubrik inputs are reset.
function structural() { return { platform: S.platform, hosts: S.hosts, cpusPerHost: S.cpusPerHost, coresPerCpu: S.coresPerCpu, vmwareEdition: S.vmwareEdition, nutanixTier: S.nutanixTier, configStatus: S.configStatus, amortYears: S.amortYears, amortStatus: S.amortStatus }; }

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, v = b.dataset.v;
  if (act === 'platform') { S.platform = v; renderForm(); recalc(); keepFocus(`[data-act=platform][data-v=${v}]`); }
  else if (act === 'edition') { S.vmwareEdition = v; renderForm(); recalc(); keepFocus(`[data-act=edition][data-v=${v}]`); }
  else if (act === 'tier') { S.nutanixTier = v; renderForm(); recalc(); keepFocus(`[data-act=tier][data-v=${v}]`); }
  else if (act === 'metric') { S.rubrik.metric = v; renderForm(); recalc(); keepFocus(`[data-act=metric][data-v=${v}]`); }
  else if (act === 'example') { const s = structural(); S = illustrative(); Object.assign(S, s); renderForm(); recalc(); keepFocus('[data-act=example]'); }
  else if (act === 'clear') { const s = structural(), d = defaults(); S = Object.assign(d, s); renderForm(); recalc(); keepFocus('[data-act=clear]'); }
  else if (act === 'copy') {
    const txt = summaryText(lastResult);
    try { await navigator.clipboard.writeText(txt); b.textContent = '✓ Copied'; } catch (_) { b.textContent = 'Copy blocked by browser'; }
    setTimeout(() => { const c = $('btn-copy'); if (c) c.textContent = 'Copy results'; }, 2000);
  }
  else if (act === 'print') {
    printReport(lastResult);
    // The logo is in the DOM from page load; wait for it to decode so the print preview never shows an empty block.
    const im = document.querySelector('#print-report .rpt-logo');
    await Promise.race([im && im.decode ? im.decode().catch(() => {}) : Promise.resolve(), new Promise(r => setTimeout(r, 1500))]);
    window.print();
  }
});
$('mbar').addEventListener('click', () => { $('results').scrollIntoView(); $('results').focus(); });
// Hide the mobile bar while the full result is on screen, so it never covers the result it summarizes.
if ('IntersectionObserver' in window) new IntersectionObserver(en => { $('mbar').classList.toggle('hide', en[0].isIntersecting); }, { threshold: 0.15 }).observe($('results'));

renderForm();
recalc();
