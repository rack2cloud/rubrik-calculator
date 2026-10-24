# Rubrik Virtual Stack TCO Calculator

Annualizes platform licensing (VMware, Nutanix, Hyper-V) and Rubrik protection cost on one line. You supply every rate. Nothing is prefilled from a price list, and each line shows where its numbers came from.

Live: https://rvstc.rack2cloud.com/ | Write-up: https://www.rack2cloud.com/rubrik-virtual-stack-tco-calculator/

## What it does

- Two separate models. Platform licensing and Rubrik protection are calculated independently. A platform choice never sets the Rubrik metric.
- Platform: VMware (VVF/VCF, 16-core-per-CPU minimum), Nutanix NCI (Pro/Ultimate, per physical core), Hyper-V Windows Server Datacenter (8-per-CPU and 16-per-server floors, 2-core steps, 16-core pack amortized over N years).
- Rubrik: you choose FETB or BETB and confirm it against your order. BETB quantity is front-end capacity divided by a modeled reduction ratio, which is an assumption and not a contract term. Rates can be per TB per year or per month.
- A missing value is never zero. A line either computes or says what it still needs.
- Outputs: live result, metric bridge, copy-as-text, print / save as PDF.

## Status labels

Every figure carries one: **Entered by you**, **Illustrative** (sample value from the example loader), **Required** (missing input), **Needs confirmation** (Rubrik metric not confirmed in your order). Each has a text label, an icon and a distinct border style, so meaning never depends on colour.

## Not modeled in this version

Capacity growth over a term, Scale Review and Capacity Burst triggers, Utility reserve versus on-demand billing, edition entitlements, workload classes, hardware, support bundles and add-ons. A contract-exposure analysis covering the commercial mechanics is planned and is not part of this release.

Rubrik terms referenced: Rubrik Licensing Guide v10152026, effective October 15, 2026. Your order governs.

## Stack

Single static page. Vanilla JS, no framework, no runtime dependencies. Self-hosted WOFF2 fonts (Inter, JetBrains Mono), same-origin icon.

```
src/engine.js      pure calculation functions, no DOM, no I/O
src/ui.js          rendering and events
src/ui.body.html   markup
src/ui.css         styles
scripts/build.js   concatenates src/ into dist/index.html, computes sha256 CSP hashes
scripts/privacy-check.js   static scan, header check, headless-Chromium network capture
test/engine.js     engine tests
test/ui.js         Playwright behaviour tests against the built page
dist/              committed build output, never hand-edited
```

## Privacy

`connect-src 'none'`, script and style locked to sha256 hashes, no cookies, no web storage, no analytics. The privacy statement is built into the page only when `scripts/privacy-check.js` has passed; it records every request across a full interaction session and fails on anything other than the page, local fonts and the local icon.

## Develop

```
npm install
node test/engine.js
node scripts/build.js            # pre-claim build
node scripts/privacy-check.js    # gate
node scripts/build.js --claim    # adds the privacy statement
node scripts/privacy-check.js --expect-claim
node test/ui.js
```

Set `CHROMIUM_PATH` if the Playwright-managed browser is not installed. `node scripts/serve.js` serves `dist/` with the production headers on port 8123.

## Deployment

Vercel, framework preset none, output directory `dist`, Vercel Analytics off. Custom domain `rvstc.rack2cloud.com`: CNAME to `cname.vercel-dns.com`, Cloudflare proxy off (DNS only).

## Roadmap

1. Quote and contract inputs with validation
2. Workload-class FETB/BETB model
3. Growth and contract-trigger simulation
4. Utility reserve versus on-demand optimization
5. Clause-linked quote lint
6. Exportable report

## Disclaimer

A calculation from the rates and assumptions you enter. It is not a quote and not Rubrik pricing. Not affiliated with or endorsed by Rubrik, VMware, Nutanix or Microsoft.

## License

MIT
