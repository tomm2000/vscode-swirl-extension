import * as assert from 'assert';
import { analyzeSemantics } from '../analyzer';
import { getHover } from '../hover';
import { getDocumentSymbols, getFoldingRanges } from '../features';
import { parseCompilerHint } from '../parser';
import { SwirlFormatter } from '../formatter';

const USER_NESTED_SCATTER_SNIPPET = `<l0, {(p_in1, d_in1)},
// [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}
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
// [compiler](compiler) end scatter.dispatch {"region":0}
  .
// [compiler](compiler) begin scatter.gather {"region":0,"v":1}
  (
    !(
      (recv(echo_item_output_ID -> p_echo_item_output, l1, l0))
      +
      (recv(eof -> p_echo_item_output, l1, l0))
    )
  )
  .
  exec(s_G, {(p_echo_item_output, echo_item_output_ID)} -> {(p_out_echoed, d_out_echoed)}, {l0})
// [compiler](compiler) end scatter.gather {"region":0}
> |

<l1, {},
  // [compiler](compiler) begin scatter.worker {"region":0,"v":1}
  !(
    (
      recv(id_ID -> p_id, l0, l1) .
      recv(group_ID -> p_group, l0, l1) .
      exec(s_op, {(p_group, group_ID)} -> {(p_sub_batch, sub_batch_ID)}, {l1}) .
      
      // [compiler](compiler) begin scatter.dispatch {"region":1,"v":1}
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
      // [compiler](compiler) end scatter.dispatch {"region":1}
      .
      // [compiler](compiler) begin scatter.gather {"region":1,"v":1}
      (!(recv(echo_item_output_ID -> p_echo_item_output, l2, l1) + recv(eof -> p_echo_item_output, l2, l1)))
      .
      exec(s_echo_item_gather, {(p_echo_item_output, echo_item_output_ID)} -> {(p_echo_item_output, echo_item_output_ID)}, {l1})
      // [compiler](compiler) end scatter.gather {"region":1}
      .
      send(echo_item_output_ID -> p_echo_item_output, l1, l0)
    )
    +
    (
      recv(eof -> p_id, l0, l1) .
      send(eof -> p_echo_item_output, l1, l0)
    )
  )
  // [compiler](compiler) end scatter.worker {"region":0}
> |

<l2, {},
  // [compiler](compiler) begin scatter.worker {"region":1,"v":1}
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
  // [compiler](compiler) end scatter.worker {"region":1}
>`;

function runCompilerHintTests() {
  console.log('--- Running New Compiler Hints Syntax Tests ---');

  // Test 1: Parser unit helper
  const parsed1 = parseCompilerHint('// [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}');
  assert(parsed1 !== null);
  assert.strictEqual(parsed1.action, 'begin');
  assert.strictEqual(parsed1.tag, 'scatter.dispatch');
  assert.strictEqual(parsed1.region, 0);
  assert.strictEqual(parsed1.json.v, 1);

  const parsed2 = parseCompilerHint('// @compiler end scatter.worker {"region":0}');
  assert(parsed2 !== null);
  assert.strictEqual(parsed2.action, 'end');
  assert.strictEqual(parsed2.tag, 'scatter.worker');
  assert.strictEqual(parsed2.region, 0);

  console.log('✓ parseCompilerHint accurately extracts directives, tags, regions, and versions');

  // Test 2: Semantic Analysis on User's nested scatter code
  const diags = analyzeSemantics(USER_NESTED_SCATTER_SNIPPET);
  const hintDiags = diags.filter((d) => d.message.toLowerCase().includes('compiler hint'));
  assert.strictEqual(hintDiags.length, 0, `User nested scatter code should have 0 compiler hint warnings, got: ${JSON.stringify(hintDiags)}`);
  console.log('✓ Perfectly matched nested compiler hints produce 0 warnings');

  // Test 3: Detecting unclosed new compiler hint
  const unclosed = `<l0, {}, 
// [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}
0>`;
  const unclosedDiags = analyzeSemantics(unclosed);
  assert(unclosedDiags.some((d) => d.message.includes('Unclosed compiler hint begin directive')), 'Should flag unclosed directive');
  console.log('✓ Unclosed new compiler hint begin directive correctly detected');

  // Test 4: Detecting mismatched region
  const mismatchedRegion = `<l0, {},
// [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}
0 .
// [compiler](compiler) end scatter.dispatch {"region":1}
0>`;
  const mismatchDiags = analyzeSemantics(mismatchedRegion);
  assert(mismatchDiags.some((d) => d.message.includes('Mismatched compiler hint region')), 'Should flag mismatched region');
  console.log('✓ Mismatched compiler hint region correctly detected');

  // Test 5: Rich Hover on new compiler hint
  const hover = getHover(USER_NESTED_SCATTER_SNIPPET, { line: 1, character: 15 });
  assert(hover !== null, 'Hover on compiler hint line should not be null');
  assert(typeof hover.contents === 'object' && 'value' in hover.contents);
  assert(hover.contents.value.includes('Swirl Compiler Hint: `BEGIN`'), 'Hover should include BEGIN');
  assert(hover.contents.value.includes('scatter.dispatch'), 'Hover should include phase');
  assert(hover.contents.value.includes('`0`'), 'Hover should include region 0');
  assert(hover.contents.value.includes('`1`'), 'Hover should include schema version 1');
  console.log('✓ Rich Hover card renders detailed breakdown of new compiler hint');

  // Test 6: Outline / Symbols includes compiler hint regions
  const symbols = getDocumentSymbols(USER_NESTED_SCATTER_SNIPPET);
  const l0 = symbols.find((s) => s.name === '<l0>');
  assert(l0 && l0.children);
  const l0Hint = l0.children.find((c) => c.name.includes('scatter.dispatch'));
  assert(l0Hint, 'Outline should include scatter.dispatch child inside <l0>');
  console.log('✓ Outline symbols correctly represent new compiler hint regions');

  // Test 7: Code folding ranges on nested compiler hints
  const ranges = getFoldingRanges(USER_NESTED_SCATTER_SNIPPET);
  // Lines 1 to 17 is scatter.dispatch {"region":0}
  const dispatchFold = ranges.find((r) => r.startLine === 1 && r.endLine === 16);
  assert(dispatchFold, 'Folding range should span from begin scatter.dispatch to end scatter.dispatch');
  console.log('✓ Folding ranges accurately fold new compiler hint regions');

  // Test 8: Formatter preserves the new compiler hints without moving
  const formatter = new SwirlFormatter();
  const formatted = formatter.format(USER_NESTED_SCATTER_SNIPPET);
  assert(formatted.includes('// [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}'));
  assert(formatted.includes('// [compiler](compiler) end scatter.dispatch {"region":0}'));
  console.log('✓ Formatter formats and indents code while preserving new compiler hint directives');

  console.log('All New Compiler Hints Syntax tests passed successfully!\n');
}

runCompilerHintTests();
