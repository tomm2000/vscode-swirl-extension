import * as fs from 'fs';
import * as assert from 'assert';
import { analyzeSemantics } from '../analyzer';
import { getHover } from '../hover';

function runTier2Tests() {
  console.log('Running Swirl Tier 2 Feature tests (Semantic Analysis & Rich Hover)...');

  // Test 1: Real-world workflows should have 0 semantic warnings/errors
  const workflowFile = '/home/tommo/Coding/Alpha/swirlc-tmp/build/workflow.swirl';
  if (fs.existsSync(workflowFile)) {
    const validContent = fs.readFileSync(workflowFile, 'utf8');
    const diags = analyzeSemantics(validContent);
    assert.strictEqual(diags.length, 0, `Valid workflow should have 0 diagnostics, got: ${JSON.stringify(diags)}`);
    console.log('✓ Valid workflow produces 0 semantic diagnostics');
  }

  // Test 2: Detect unknown destination location
  const unknownLocSwirl = `
  <l0, {(p1, d1)}, send(d1 -> p1, l0, l99)>
  `;
  const unknownLocDiags = analyzeSemantics(unknownLocSwirl);
  assert(unknownLocDiags.some((d) => d.message.includes("Unknown destination location 'l99'")), 'Should flag unknown location l99');
  console.log('✓ Unknown location detection passed');

  // Test 3: Detect location context mismatch (send in l0 claims to originate from l1)
  const mismatchSrcSwirl = `
  <l0, {(p1, d1)}, send(d1 -> p1, l1, l0)> |
  <l1, {}, 0>
  `;
  const mismatchDiags = analyzeSemantics(mismatchSrcSwirl);
  assert(mismatchDiags.some((d) => d.message.includes('conflicting source')), 'Should flag conflicting source location');
  console.log('✓ Conflicting source location detection passed');

  // Test 4: Detect duplicate location
  const duplicateSwirl = `
  <l0, {}, 0> |
  <l0, {}, 0>
  `;
  const dupDiags = analyzeSemantics(duplicateSwirl);
  assert(dupDiags.some((d) => d.message.includes("Duplicate location definition '<l0>'")), 'Should flag duplicate location');
  console.log('✓ Duplicate location detection passed');

  // Test 5: Detect unmatched communication channel
  const unmatchedSwirl = `
  <l0, {(p1, d1)}, send(d1 -> p1, l0, l1)> |
  <l1, {}, recv(d2 -> p2_different, l0, l1)>
  `;
  const unmatchedDiags = analyzeSemantics(unmatchedSwirl);
  assert(unmatchedDiags.some((d) => d.message.includes('Potentially unmatched communication')), 'Should flag unmatched channel');
  console.log('✓ Unmatched communication channel detection passed');

  // Test 6: Detect unclosed compiler hint
  const unclosedHintSwirl = `
  <l0, {}, // @compiler_hint_start {"kind":"scatter","phase":"dispatch"}
  0>
  `;
  const hintDiags = analyzeSemantics(unclosedHintSwirl);
  assert(hintDiags.some((d) => d.message.includes('Unclosed @compiler_hint_start')), 'Should flag unclosed compiler hint');
  console.log('✓ Unclosed compiler hint detection passed');

  // Test 7: Rich Hover on Compiler Hint
  const hintHoverDoc = `// @compiler_hint_start {"kind":"scatter","method":"dotproduct","phase":"dispatch","region":"scatter:/compute","version":1}
<l0, {}, 0>`;
  const hoverHint = getHover(hintHoverDoc, { line: 0, character: 10 });
  assert(hoverHint !== null, 'Hover on compiler hint should not be null');
  assert(typeof hoverHint.contents === 'object' && 'value' in hoverHint.contents);
  assert(hoverHint.contents.value.includes('Swirl Compiler Hint'), 'Hover content should include title');
  assert(hoverHint.contents.value.includes('scatter:/compute'), 'Hover content should include region');
  assert(hoverHint.contents.value.includes('dotproduct'), 'Hover content should include method');
  console.log('✓ Rich Hover for Compiler Hint passed');

  // Test 8: Rich Hover on Location
  const locHoverDoc = `<l0, {(p1, d1)}, exec(s1, {(p1, d1)} -> {(p2, d2)}, {l0}) . send(d2 -> p2, l0, l1)> |
<l1, {}, recv(d2 -> p2, l0, l1)>`;
  const hoverLoc = getHover(locHoverDoc, { line: 0, character: 2 });
  assert(hoverLoc !== null, 'Hover on location should not be null');
  assert(typeof hoverLoc.contents === 'object' && 'value' in hoverLoc.contents);
  assert(hoverLoc.contents.value.includes('`<l0>`'), 'Hover content should display location title');
  assert(hoverLoc.contents.value.includes('`s1`'), 'Hover content should display executed step s1');
  assert(hoverLoc.contents.value.includes('`l1`'), 'Hover content should display target destination l1');
  console.log('✓ Rich Hover for Location passed');

  // Test 9: Rich Hover on Step
  const hoverStep = getHover(locHoverDoc, { line: 0, character: 23 }); // character 23 is inside 's1'
  assert(hoverStep !== null, 'Hover on step s1 should not be null');
  assert(typeof hoverStep.contents === 'object' && 'value' in hoverStep.contents);
  assert(hoverStep.contents.value.includes('Workflow Step: `s1`'), 'Hover content should display step title');
  assert(hoverStep.contents.value.includes('`<l0>`'), 'Hover content should display enclosing location');
  console.log('✓ Rich Hover for Workflow Step passed');

  console.log('\nAll Tier 2 Feature tests passed successfully!');
}

runTier2Tests();
