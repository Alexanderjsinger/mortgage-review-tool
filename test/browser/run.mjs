// Runs every browser check. Exits non-zero if any of them fail, so this can
// gate a build.
//
//     npm run test:browser
import { launch } from './harness.mjs';
import * as checks from './checks.mjs';

const only = process.argv[2];
const ORDER = ['printFits', 'markupToggle', 'freeAndClear', 'escrowWaiver',
               'shortfall', 'partialWaiver', 'programMatrix', 'secondLienEdges', 'optionEdges', 'secondLien', 'sideBySideOptions',
               'heavyFile', 'newReviewClears', 'savedWork', 'optionsFolded',
               'phoneWidth', 'disclosures',
               'offlineBuild', 'pdfBuilds'];

const browser = await launch();
let passed = 0, failed = 0;
for (const name of ORDER) {
  if (only && name !== only) continue;
  try {
    const ok = await checks[name](browser);
    ok ? passed++ : failed++;
  } catch (e) {
    console.log(`FAIL ${name} — threw`);
    console.log('   ' + String(e).split('\n').slice(0, 3).join('\n   '));
    failed++;
  }
}
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
