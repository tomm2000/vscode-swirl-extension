import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '../parser';
import { SwirlFormatter } from '../formatter';
import { analyzeSemantics } from '../analyzer';
import { getDocumentSymbols } from '../features';
import { getInlayHints } from '../inlay-hints';

function runSyntaxUpdateTests() {
  console.log('--- Running Syntax Update Tests (Choice without ID & Data/Port [ID]) ---');

  // Test 1: Choice operand without ID
  {
    const code = `<l0, {}, (send(d1 -> p1, l0, l1)) + (send(d2 -> p2, l0, l2)) + (send(d3 -> p3, l0, l3))>`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Choice without ID should parse without errors');
    assert.strictEqual(wf.locations.length, 1);
    assert.strictEqual(wf.locations[0].trace.kind, 'traceOp');
    console.log('✓ Choice operand without ID parses cleanly as binary traceOp (+)');
  }

  // Test 2: Data with [ID] in send, recv, move
  {
    const code = `<l0, {},
      move(id[taskID] -> p_id, l0, {l1}) .
      move(group[taskID] -> p_group, l0, {l1}) .
      recv(res[taskID] -> p_res, l1, l0) .
      send(res[taskID] -> p_res, l0, l1)
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Data with [taskID] should parse without errors');
    console.log('✓ Data with [ID] indexing in send, recv, and move parses cleanly');
  }

  // Test 3: Port with [ID] in predicates
  {
    const code = `<l0, {},
      send(d1 -> p[taskID], l0, l1) .
      recv(d2 -> p[taskID], l1, l0) .
      move(d3 -> p[taskID], l0, {l1})
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Port with [taskID] should parse without errors');
    console.log('✓ Port with [ID] indexing in send, recv, and move parses cleanly');
  }

  // Test 4: Data pairs with [ID] in datasets and exec flows
  {
    const code = `<l0, {(p_in1, d_in1), (p_id, id[taskID])},
      exec(s_sc, {(p_in1, d_in1)} -> {(p_id, id[taskID]), (p_group, group[taskID])}, {l0}) .
      exec(s_G, {(p_res, res[taskID])} -> {(p_out, d_out)}, {l0})
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Data pairs with [ID] should parse without errors');
    assert.strictEqual(wf.locations[0].dataset.pairs[1].second, 'id[taskID]');
    console.log('✓ Data pairs with [ID] in dataset and exec flows parse cleanly');
  }

  // Test 5: Full validation of updated swirlc examples/swirl/scatter/source.swirl
  {
    const scatterPath = '/home/tommo/Coding/Alpha/swirlc/examples/swirl/scatter/source.swirl';
    if (fs.existsSync(scatterPath)) {
      const scatterSrc = fs.readFileSync(scatterPath, 'utf8');

      // Parser test
      const parser = new Parser(scatterSrc);
      const wf = parser.parseWorkflow();
      assert.strictEqual(parser.diagnostics.length, 0, 'scatter/source.swirl should have 0 parser diagnostics');
      assert.strictEqual(wf.locations.length, 4, 'scatter/source.swirl should define 4 locations');

      // Semantics test
      const diags = analyzeSemantics(scatterSrc);
      assert.strictEqual(diags.length, 0, 'scatter/source.swirl should have 0 semantic diagnostics');

      // Formatter idempotency test
      const formatter = new SwirlFormatter();
      const formatted = formatter.format(scatterSrc);
      const formattedAgain = formatter.format(formatted);
      assert.strictEqual(formatted, formattedAgain, 'Formatter should be idempotent on scatter/source.swirl');

      // Outline document symbols test
      const symbols = getDocumentSymbols(scatterSrc);
      const l0 = symbols.find((s) => s.name === '<l0>');
      assert(l0, 'Outline should have <l0>');
      const moveId = l0.children?.find((c) => c.name.includes('move: id[taskID] -> p_id'));
      assert(moveId, 'Outline should display indexed data in move: id[taskID] -> p_id');

      // Inlay hints test
      const hints = getInlayHints(scatterSrc, undefined, {
        enableParameterNames: true,
        execFlowStyle: 'inOut',
        enableLocationTags: true
      });
      assert(hints.length > 50, 'Inlay hints should generate parameter tags for scatter/source.swirl');

      console.log('✓ Real-world scatter/source.swirl with [taskID] and bare choice passes all tests');
    }
  }

  console.log('All Syntax Update tests passed successfully!\n');
}

runSyntaxUpdateTests();
