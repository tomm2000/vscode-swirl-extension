import * as assert from 'assert';
import { analyzeSemantics } from '../analyzer';
import { getHover } from '../hover';
import { getDocumentSymbols, getFoldingRanges } from '../features';
import { parseCompilerHint } from '../parser';
import { SwirlFormatter } from '../formatter';

const USER_COMPILER_BARE_SNIPPET = `<l0, {(p_in1, d_in1)},
// @compiler begin scatter.dispatch 0
  exec(s_sc, {(p_in1, d_in1)} -> {(p_id, id_ID), (p_group, group_ID)}, {l0})
  .
  (
    !(
      (
        move(id_ID -> p_id, l0, {l1}) .
        move(group_ID -> p_group, l0, {l1})
      )
      +
      (
        send(eof -> p_id, l0, l1)
      )
    )
  )
// @compiler end scatter.dispatch 0
  .
// @compiler begin scatter.gather 0
  (
    !(
      (recv(echo_item_output_ID -> p_echo_item_output, l1, l0))
      +
      (recv(eof -> p_echo_item_output, l1, l0))
    )
  )
  .
  exec(s_G, {(p_echo_item_output, echo_item_output_ID)} -> {(p_out_echoed, d_out_echoed)}, {l0})
// @compiler end scatter.gather 0
> |

<l1, {},
  // @compiler begin scatter.worker 0
  !(
    (
      recv(id_ID -> p_id, l0, l1) .
      recv(group_ID -> p_group, l0, l1) .
      exec(s_op, {(p_group, group_ID)} -> {(p_sub_batch, sub_batch_ID)}, {l1}) .
      
      // @compiler begin scatter.dispatch 1
      exec(s_echo_item_pair, {(p_sub_batch, sub_batch_ID)} -> {(p_echo_item_id, echo_item_id_ID), (p_echo_item_group, echo_item_group_ID)}, {l1})
      .
      !(
        (
          move(echo_item_id_ID -> p_echo_item_id, l1, {l2}) .
          move(echo_item_group_ID -> p_echo_item_group, l1, {l2})
        )
        +
        (send(eof -> p_echo_item_id, l1, l2))
      )
      // @compiler end scatter.dispatch 1
      .
      // @compiler begin scatter.gather 1
      (!(recv(echo_item_output_ID -> p_echo_item_output, l2, l1) + recv(eof -> p_echo_item_output, l2, l1)))
      .
      exec(s_echo_item_gather, {(p_echo_item_output, echo_item_output_ID)} -> {(p_echo_item_output, echo_item_output_ID)}, {l1})
      // @compiler end scatter.gather 1
      .
      send(echo_item_output_ID -> p_echo_item_output, l1, l0)
    )
    +
    (
      recv(eof -> p_id, l0, l1) .
      send(eof -> p_echo_item_output, l1, l0)
    )
  )
  // @compiler end scatter.worker 0
> |

<l2, {},
  // @compiler begin scatter.worker 1
  !(
    (
      recv(echo_item_id_ID -> p_echo_item_id, l1, l2) .
      recv(echo_item_group_ID -> p_echo_item_group, l1, l2) .
      exec(s_echo_item_open, {(p_echo_item_group, echo_item_group_ID)} -> {(p_echo_item_item, echo_item_item_ID)}, {l2}) .
      exec(s_echo_item, {(p_echo_item_item, echo_item_item_ID)} -> {(p_echo_item_output, echo_item_output_ID)}, {l2}) .
      send(echo_item_output_ID -> p_echo_item_output, l2, l1)
    )
    + (
      recv(eof -> p_echo_item_id, l1, l2) .
      send(eof -> p_echo_item_output, l2, l1)
    )
  )
  // @compiler end scatter.worker 1
>`;

function runCompilerHintTests() {
  console.log('--- Running New Compiler Hints Syntax Tests ---');

  // Test 1: Parser unit helper for bare-number region syntax (// @compiler begin scatter.dispatch 0)
  const bare1 = parseCompilerHint('// @compiler begin scatter.dispatch 0');
  assert(bare1 !== null);
  assert.strictEqual(bare1.action, 'begin');
  assert.strictEqual(bare1.tag, 'scatter.dispatch');
  assert.strictEqual(bare1.region, 0);

  const bare2 = parseCompilerHint('// @compiler end scatter.dispatch 0');
  assert(bare2 !== null);
  assert.strictEqual(bare2.action, 'end');
  assert.strictEqual(bare2.tag, 'scatter.dispatch');
  assert.strictEqual(bare2.region, 0);

  const bareWorker = parseCompilerHint('// @compiler begin scatter.worker 1');
  assert(bareWorker !== null);
  assert.strictEqual(bareWorker.action, 'begin');
  assert.strictEqual(bareWorker.tag, 'scatter.worker');
  assert.strictEqual(bareWorker.region, 1);

  // Test 2: Parser unit helper for json payload syntax
  const json1 = parseCompilerHint('// [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}');
  assert(json1 !== null);
  assert.strictEqual(json1.action, 'begin');
  assert.strictEqual(json1.tag, 'scatter.dispatch');
  assert.strictEqual(json1.region, 0);
  assert.strictEqual(json1.json.v, 1);

  console.log('✓ parseCompilerHint accurately extracts directives, tags, regions (both bare numbers and JSON)');

  // Test 3: Semantic Analysis on bare-number nested scatter code
  const diags = analyzeSemantics(USER_COMPILER_BARE_SNIPPET);
  const hintDiags = diags.filter((d) => d.message.toLowerCase().includes('compiler hint'));
  assert.strictEqual(hintDiags.length, 0, `User nested scatter code should have 0 compiler hint warnings, got: ${JSON.stringify(hintDiags)}`);
  console.log('✓ Perfectly matched bare-number compiler hints produce 0 warnings');

  // Test 4: Detecting unclosed new compiler hint
  const unclosed = `<l0, {}, 
// @compiler begin scatter.dispatch 0
0>`;
  const unclosedDiags = analyzeSemantics(unclosed);
  assert(unclosedDiags.some((d) => d.message.includes('Unclosed compiler hint begin directive')), 'Should flag unclosed directive');
  console.log('✓ Unclosed new compiler hint begin directive correctly detected');

  // Test 5: Detecting mismatched region with bare numbers
  const mismatchedRegion = `<l0, {},
// @compiler begin scatter.dispatch 0
0 .
// @compiler end scatter.dispatch 1
0>`;
  const mismatchDiags = analyzeSemantics(mismatchedRegion);
  assert(mismatchDiags.some((d) => d.message.includes('Mismatched compiler hint region')), 'Should flag mismatched region');
  console.log('✓ Mismatched compiler hint region (0 vs 1) correctly detected');

  // Test 6: Detecting mismatched phase tag
  const mismatchedPhase = `<l0, {},
// @compiler begin scatter.dispatch 0
0 .
// @compiler end scatter.gather 0
0>`;
  const mismatchPhaseDiags = analyzeSemantics(mismatchedPhase);
  assert(mismatchPhaseDiags.some((d) => d.message.includes('Mismatched compiler hint phase')), 'Should flag mismatched phase');
  console.log('✓ Mismatched compiler hint phase (scatter.dispatch vs scatter.gather) correctly detected');

  // Test 7: Rich Hover on bare-number compiler hint
  const hover = getHover(USER_COMPILER_BARE_SNIPPET, { line: 1, character: 15 });
  assert(hover !== null, 'Hover on compiler hint line should not be null');
  assert(typeof hover.contents === 'object' && 'value' in hover.contents);
  assert(hover.contents.value.includes('Swirl Compiler Hint: `BEGIN`'), 'Hover should include BEGIN');
  assert(hover.contents.value.includes('scatter.dispatch'), 'Hover should include phase');
  assert(hover.contents.value.includes('`0`'), 'Hover should include region 0');
  console.log('✓ Rich Hover card renders detailed breakdown of bare-number compiler hint');

  // Test 8: Outline / Symbols includes compiler hint regions
  const symbols = getDocumentSymbols(USER_COMPILER_BARE_SNIPPET);
  const l0 = symbols.find((s) => s.name === '<l0>');
  assert(l0 && l0.children);
  const l0Hint = l0.children.find((c) => c.name.includes('scatter.dispatch'));
  assert(l0Hint, 'Outline should include scatter.dispatch child inside <l0>');
  assert.strictEqual(l0Hint.name, 'scatter.dispatch (Region 0)');
  console.log('✓ Outline symbols correctly represent bare-number compiler hint regions');

  // Test 9: Code folding ranges on nested compiler hints
  const ranges = getFoldingRanges(USER_COMPILER_BARE_SNIPPET);
  const dispatchFold = ranges.find((r) => r.startLine === 1 && r.endLine === 16);
  assert(dispatchFold, 'Folding range should span from begin scatter.dispatch to end scatter.dispatch');
  console.log('✓ Folding ranges accurately fold bare-number compiler hint regions');

  // Test 10: Formatter preserves bare compiler hints without moving
  const formatter = new SwirlFormatter();
  const formatted = formatter.format(USER_COMPILER_BARE_SNIPPET);
  assert(formatted.includes('// @compiler begin scatter.dispatch 0'));
  assert(formatted.includes('// @compiler end scatter.dispatch 0'));
  console.log('✓ Formatter formats and indents code while preserving bare compiler hint directives');

  console.log('All New Compiler Hints Syntax tests passed successfully!\n');
}

runCompilerHintTests();
