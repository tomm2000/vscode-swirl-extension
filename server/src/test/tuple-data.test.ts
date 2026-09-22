import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '../parser';
import { SwirlFormatter } from '../formatter';
import { analyzeSemantics } from '../analyzer';
import { getDocumentSymbols } from '../features';
import { getInlayHints } from '../inlay-hints';

function runTupleDataTests() {
  console.log('--- Running Tuple Data Syntax Tests ---');

  // Test 1: Basic move predicate with data tuple
  {
    const code = `<l0, {}, move((task_id_0, task_payload_0) -> p_task_0, l0, {l1, l2})>`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();

    assert.strictEqual(parser.diagnostics.length, 0, 'move with tuple should have 0 diagnostics');
    assert.strictEqual(wf.locations.length, 1);

    const trace = wf.locations[0].trace;
    assert.strictEqual(trace.kind, 'tracePred');
    if (trace.kind === 'tracePred') {
      assert.strictEqual(trace.pred.kind, 'move');
      if (trace.pred.kind === 'move') {
        assert.strictEqual(trace.pred.data.isTuple, true);
        assert.strictEqual(trace.pred.data.name, '(task_id_0, task_payload_0)');
        assert.strictEqual(trace.pred.data.elements?.length, 2);
        assert.strictEqual(trace.pred.data.elements?.[0].name, 'task_id_0');
        assert.strictEqual(trace.pred.data.elements?.[1].name, 'task_payload_0');
        assert.strictEqual(trace.pred.port, 'p_task_0');
        assert.strictEqual(trace.pred.src, 'l0');
        assert.deepStrictEqual(trace.pred.dst.locations, ['l1', 'l2']);
      }
    }
    console.log('✓ Test 1: move((task_id_0, task_payload_0) -> p_task_0, l0, {l1, l2}) parses cleanly with structured tuple AST');
  }

  // Test 2: recv and send predicates with data tuples
  {
    const code = `<l0, {},
      recv((task_id_0, task_payload_0) -> p_task_0, l1, l0) .
      send((task_id_0, task_payload_0) -> p_task_0, l0, l1)
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();

    assert.strictEqual(parser.diagnostics.length, 0, 'recv and send with tuple should have 0 diagnostics');
    console.log('✓ Test 2: recv and send with data tuples parse cleanly');
  }

  // Test 3: Data pairs with tuples in dataset and exec flow
  {
    const code = `<l0, {(p_init, (id_0, payload_0))},
      exec(_s_scatter_0, {(p_in, d_in)} -> {(p_task_0, (task_id_0, task_payload_0))}, {l0})
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();

    assert.strictEqual(parser.diagnostics.length, 0, 'data pairs with tuples should have 0 diagnostics');
    assert.strictEqual(wf.locations[0].dataset.pairs[0].first, 'p_init');
    assert.strictEqual(wf.locations[0].dataset.pairs[0].second, '(id_0, payload_0)');

    const trace = wf.locations[0].trace;
    assert.strictEqual(trace.kind, 'tracePred');
    if (trace.kind === 'tracePred' && trace.pred.kind === 'exec') {
      const outPair = trace.pred.flow.to.pairs[0];
      assert.strictEqual(outPair.first, 'p_task_0');
      assert.strictEqual(outPair.second, '(task_id_0, task_payload_0)');
    }
    console.log('✓ Test 3: Datasets and exec flows with (port, (data1, data2)) tuples parse cleanly');
  }

  // Test 4: Nested tuples, N-ary tuples, and indexed identifiers in tuples
  {
    const code = `<l0, {},
      move((task_id[taskID], payload[taskID]) -> p_task, l0, {l1}) .
      move((a, b, c) -> p_abc, l0, {l1}) .
      move(((x, y), z) -> p_nested, l0, {l1}) .
      move((0, eof) -> p_consts, l0, {l1})
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();

    assert.strictEqual(parser.diagnostics.length, 0, 'complex tuples should parse without diagnostics');
    console.log('✓ Test 4: Nested, N-ary, indexed, and constant tuples parse cleanly');
  }

  // Test 5: Outline symbols and Inlay hints with data tuples
  {
    const code = `<l0, {(p_in, d_in)},
      exec(_s_scatter_0, {(p_in, d_in)} -> {(p_task_0, (task_id_0, task_payload_0))}, {l0}) .
      move((task_id_0, task_payload_0) -> p_task_0, l0, {l1, l2})
    >`;
    const symbols = getDocumentSymbols(code);
    const l0 = symbols.find((s) => s.name === '<l0>');
    assert(l0, 'Outline should include <l0>');

    const moveSym = l0.children?.find((c) => c.name.includes('move: (task_id_0, task_payload_0) -> p_task_0'));
    assert(moveSym, 'Outline should display tuple data in predicate symbol');

    const hints = getInlayHints(code);
    const dataHint = hints.find((h) => h.label === 'data:');
    assert(dataHint, 'Inlay hints should include data: parameter tag');

    console.log('✓ Test 5: Outline document symbols and inlay hints format tuples correctly');
  }

  // Test 6: Formatter idempotency on tuples
  {
    const code = `<l0, {(p_init, (id_0, payload_0))},
  exec(_s_scatter_0, {(p_in, d_in)} -> {(p_task_0, (task_id_0, task_payload_0))}, {l0})
  .
  (
    move((task_id_0, task_payload_0) -> p_task_0, l0, {l1, l2})
  )
>`;
    const formatter = new SwirlFormatter();
    const formatted = formatter.format(code);
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Formatter should be idempotent on code with tuples');

    const parser = new Parser(formatted);
    parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Formatted code with tuples should have 0 diagnostics');
    console.log('✓ Test 6: Formatter formats tuples cleanly and is idempotent');
  }

  // Test 7: Full validation of real-world examples/workflow.swirl
  {
    const workflowPath = path.resolve(__dirname, '../../../examples/workflow.swirl');
    assert(fs.existsSync(workflowPath), `examples/workflow.swirl should exist at ${workflowPath}`);

    const workflowSrc = fs.readFileSync(workflowPath, 'utf8');

    // Parser validation
    const parser = new Parser(workflowSrc);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'examples/workflow.swirl should have 0 parser diagnostics');
    assert.strictEqual(wf.locations.length, 6, 'examples/workflow.swirl should define 6 locations (l0 through l5)');

    // Semantic analysis validation
    const diags = analyzeSemantics(workflowSrc);
    assert.strictEqual(diags.length, 0, 'examples/workflow.swirl should have 0 semantic diagnostics');

    // Formatter idempotency
    const formatter = new SwirlFormatter();
    const formatted = formatter.format(workflowSrc);
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Formatter should be idempotent on examples/workflow.swirl');

    // Outline symbols
    const symbols = getDocumentSymbols(workflowSrc);
    assert.strictEqual(symbols.length, 6, 'Should extract 6 top-level location symbols');
    const l0 = symbols.find((s) => s.name === '<l0>');
    assert(l0, 'Outline must include <l0>');
    const moveSym = l0.children?.find((c) => c.name.includes('move: (task_id_0, task_payload_0) -> p_task_0'));
    assert(moveSym, 'Outline must contain move: (task_id_0, task_payload_0) -> p_task_0');

    // Inlay hints
    const hints = getInlayHints(workflowSrc);
    assert(hints.length > 200, 'Should generate rich inlay hints across workflow.swirl');

    console.log('✓ Test 7: Complete examples/workflow.swirl passes all parser, analyzer, formatter, symbols, and inlay hint tests');
  }

  console.log('All Tuple Data tests passed successfully!\n');
}

runTupleDataTests();
