#!/usr/bin/env bash
# Full local release gate. The privacy statement is only built in after the claim-free build passes network capture,
# and the claim build is then captured and tested again. Leaves dist/ as the claim build.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== engine tests"; node test/engine.js
echo "== build (no privacy claim)"; node scripts/build.js
echo "== tests against the built app"; node test/ui.js
echo "== privacy gate, claim-free build"; node scripts/privacy-check.js
echo "== build with privacy claim"; node scripts/build.js --claim
echo "== privacy gate, claim build"; node scripts/privacy-check.js --expect-claim
echo "== tests against the claim build"; node test/ui.js
echo "RELEASE CHECK PASSED"
