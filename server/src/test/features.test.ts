import * as fs from 'fs';
import * as assert from 'assert';
import {
  getDocumentSymbols,
  getDefinition,
  getReferences,
  getFoldingRanges
} from '../features';

function runFeatureTests() {
  console.log('Running Swirl Tier 1 Feature tests (Outline, Definition, References, Folding)...');

  const testFile = '/home/tommo/Coding/Alpha/swirlc-tmp/build/workflow.swirl';
  if (!fs.existsSync(testFile)) {
    console.warn(`File ${testFile} not found, skipping.`);
    return;
  }

  const content = fs.readFileSync(testFile, 'utf8');
  const uri = 'file:///test/workflow.swirl';

  // 1. Document Symbols (Outline)
  const symbols = getDocumentSymbols(content);
  assert(symbols.length >= 6, 'Should extract all locations (l0 to l5)');
  assert.strictEqual(symbols[0].name, '<l0>');
  assert(symbols[0].children && symbols[0].children.length > 0, 'l0 should have nested children');
  
  const l0ChildrenNames = symbols[0].children!.map((c) => c.name);
  assert(l0ChildrenNames.includes('exec: s_sc'), 'l0 outline should include exec: s_sc');
  assert(l0ChildrenNames.some((n) => n.startsWith('move:')), 'l0 outline should include move');
  assert(l0ChildrenNames.some((n) => n.startsWith('send:')), 'l0 outline should include send');
  assert(l0ChildrenNames.some((n) => n.startsWith('Region:')), 'l0 outline should include compiler hint region');
  console.log('✓ Document Symbols / Outline: passed (found 6 locations with nested predicates and regions)');

  // 2. Go to Definition (F12)
  // Finding position of 'l1' inside l0 at line 8
  const lines = content.split('\n');
  let l1Line = -1;
  let l1Char = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('move(') && lines[i].includes('l1')) {
      l1Line = i;
      l1Char = lines[i].indexOf('l1');
      break;
    }
  }
  assert(l1Line !== -1, 'Could not find l1 reference line');

  const def = getDefinition(content, uri, { line: l1Line, character: l1Char });
  assert(def !== null, 'Definition for l1 should not be null');
  assert.strictEqual((def as any).uri, uri);
  // Definition of l1 should point to location <l1, ...> which starts around line 40
  assert((def as any).range.start.line >= 35 && (def as any).range.start.line <= 45, 'Definition of l1 should point to <l1>');
  console.log('✓ Go to Definition: passed (l1 in trace jumps to <l1> definition)');

  // 3. Find References (Shift+F12)
  const refs = getReferences(content, uri, { line: l1Line, character: l1Char }, true);
  assert(refs.length > 10, 'References to l1 should be multiple occurrences across the file');
  console.log(`✓ Find References: passed (found ${refs.length} references to l1)`);

  // 4. Folding Ranges
  const folding = getFoldingRanges(content);
  assert(folding.length > 20, 'Should find multiple folding ranges');

  // Check location folding
  const locFolds = folding.filter((f) => f.kind === 'region');
  assert(locFolds.length >= 6, 'Should have at least 6 region folds for locations');

  // Check compiler hint region folding
  const hintFolds = locFolds.filter((f) => f.startLine > 0 && f.endLine < 20);
  assert(hintFolds.length > 0, 'Should fold @compiler_hint_start to @compiler_hint_end');
  console.log(`✓ Code Folding: passed (found ${folding.length} folding ranges across locations, hints, and parens)`);

  console.log('\nAll Tier 1 Feature tests passed successfully!');
}

runFeatureTests();
