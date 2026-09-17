import * as fs from 'fs';
import * as assert from 'assert';
import {
  getDocumentSymbols,
  getDefinition,
  getReferences,
  getFoldingRanges
} from '../features';

const FALLBACK_WORKFLOW = `// @compiler_hint_start {"region":"scatter","phase":"setup","method":"round_robin"}
<l0, {(p1, d1)}, 
  exec(s1, {(p1, d1)} -> {(p2, d2)}, {l0})
  .
  send(d2 -> p2, l0, l1)
> |
<l1, {}, 
  recv(p2 -> d2, l0, l1)
  .
  exec(s2, {(p2, d2)} -> {}, {l1})
>
// @compiler_hint_end
`;

function runFeatureTests() {
  console.log('Running Swirl Tier 1 Feature tests (Outline, Definition, References, Folding)...');

  const testFile = '/home/tommo/Coding/Alpha/swirlc-tmp/build/workflow.swirl';
  const hasLocalFile = fs.existsSync(testFile);
  const content = hasLocalFile ? fs.readFileSync(testFile, 'utf8') : FALLBACK_WORKFLOW;
  const uri = 'file:///test/workflow.swirl';

  // 1. Document Symbols (Outline)
  const symbols = getDocumentSymbols(content);
  assert(symbols.length >= 2, 'Should extract locations');
  assert.strictEqual(symbols[0].name, '<l0>');
  assert(symbols[0].children && symbols[0].children.length > 0, 'l0 should have nested children');

  // 2. Go to Definition (F12)
  const lines = content.split('\n');
  let l1Line = -1;
  let l1Char = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i].includes('move(') || lines[i].includes('send(')) && lines[i].includes('l1')) {
      l1Line = i;
      l1Char = lines[i].lastIndexOf('l1');
      break;
    }
  }
  assert(l1Line !== -1, 'Could not find l1 reference line');

  const def = getDefinition(content, uri, { line: l1Line, character: l1Char });
  assert(def !== null, 'Definition for l1 should not be null');
  assert.strictEqual((def as any).uri, uri);
  console.log('✓ Go to Definition: passed (l1 in trace jumps to <l1> definition)');

  // 3. Find References (Shift+F12)
  const refs = getReferences(content, uri, { line: l1Line, character: l1Char }, true);
  assert(refs.length >= 2, 'References to l1 should find multiple occurrences');
  console.log(`✓ Find References: passed (found ${refs.length} references to l1)`);

  // 4. Folding Ranges
  const folding = getFoldingRanges(content);
  assert(folding.length >= 2, 'Should find folding ranges');

  // Check location folding
  const locFolds = folding.filter((f) => f.kind === 'region');
  assert(locFolds.length >= 2, 'Should have at least 2 region folds for locations');

  console.log(`✓ Code Folding: passed (found ${folding.length} folding ranges)`);
  console.log('\nAll Tier 1 Feature tests passed successfully!');
}

runFeatureTests();
