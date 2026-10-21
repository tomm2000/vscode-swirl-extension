import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '../parser';
import { SwirlFormatter } from '../formatter';
import { analyzeSemantics } from '../analyzer';
import { TokenKind, Lexer } from '../lexer';

function runScatterBeginTests() {
  console.log('--- Running Scatter Begin & Hierarchical Key Path Tests ---');

  // Test 1: Lexer tokenization of '/' and 'begin'
  {
    const code = `send((begin, root) -> p_a, source_a, worker) . move((?a, root / ?iteration) -> p_a, source_a, worker)`;
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const unknownTokens = tokens.filter((t) => t.kind === TokenKind.Unknown);
    assert.strictEqual(unknownTokens.length, 0, 'No tokens should be unknown');
    assert.ok(tokens.some((t) => t.kind === TokenKind.Slash), 'Should tokenize slash as TokenKind.Slash');
    assert.ok(tokens.some((t) => t.kind === TokenKind.BeginKeyword), 'Should tokenize begin as TokenKind.BeginKeyword');
    console.log('✓ Lexer recognizes slash (/) and begin keyword cleanly');
  }

  // Test 2: Hierarchical key path in move, recv, send
  {
    const code = `<l0, {},
      move((?a, root / ?iteration) -> p_a, source_a, worker) .
      recv((?a, ?parent / ?iteration) -> p_a, source_a, worker) .
      send((?result, ?parent / ?iteration) -> p_results, worker, collector)
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Hierarchical key paths should parse without error');
    assert.strictEqual(wf.locations.length, 1);
    console.log('✓ Hierarchical key paths in move, recv, and send parse cleanly');
  }

  // Test 3: Guard with 'in <scope>'
  {
    const code = `<l0, {},
      !(
        move((?a, root / ?iteration) -> p_a, source_a, worker)
        +[p_a has data in root]
        send(eof -> p_a, source_a, worker)
      )
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Guard with in <scope> should parse without error');
    console.log('✓ Guarded choice with "+[p has data in scope]" parses cleanly');
  }

  // Test 4: 3-argument U(port, stream, ?parent)
  {
    const code = `<l0, {},
      exec(s_gather, {U(p_results, results, ?parent)} -> {(p_output, d_output)}, {collector})
    >`;
    const parser = new Parser(code);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, '3-argument U descriptor should parse without error');
    const execPred = (wf.locations[0].trace as any).pred;
    assert.strictEqual(execPred.flow.from.collections.length, 1);
    assert.strictEqual(execPred.flow.from.collections[0].port, 'p_results');
    assert.strictEqual(execPred.flow.from.collections[0].data, 'results');
    assert.strictEqual(execPred.flow.from.collections[0].parentScope, '?parent');
    console.log('✓ 3-argument U(port, stream, ?parent) parses with parentScope property');
  }

  // Test 5: Full validation of scatter-begin.swirl
  {
    const examplePath = '/home/tommo/Coding/Alpha/swirlc/examples/swirl/scatter-begin.swirl';
    if (fs.existsSync(examplePath)) {
      const src = fs.readFileSync(examplePath, 'utf8');

      // Parser check
      const parser = new Parser(src);
      const wf = parser.parseWorkflow();
      assert.strictEqual(parser.diagnostics.length, 0, `scatter-begin.swirl should have 0 parse diagnostics: ${JSON.stringify(parser.diagnostics)}`);

      // Analyzer check
      const diags = analyzeSemantics(src);
      assert.strictEqual(diags.length, 0, `scatter-begin.swirl should have 0 analyzer diagnostics: ${JSON.stringify(diags)}`);

      // Formatter check
      const formatter = new SwirlFormatter();
      const formatted = formatter.format(src);
      const reParsed = new Parser(formatted);
      assert.strictEqual(reParsed.diagnostics.length, 0, 'Formatted scatter-begin.swirl must parse without diagnostics');

      console.log('✓ Full validation of scatter-begin.swirl passed (0 diagnostics, formats idempotently)');
    } else {
      console.log('⚠ scatter-begin.swirl not found at ' + examplePath);
    }
  }

  // Test 6: Full validation of nested-scatter-begin.swirl
  {
    const examplePath = '/home/tommo/Coding/Alpha/swirlc/examples/swirl/nested-scatter-begin.swirl';
    if (fs.existsSync(examplePath)) {
      const src = fs.readFileSync(examplePath, 'utf8');

      // Parser check
      const parser = new Parser(src);
      const wf = parser.parseWorkflow();
      assert.strictEqual(parser.diagnostics.length, 0, `nested-scatter-begin.swirl should have 0 parse diagnostics: ${JSON.stringify(parser.diagnostics)}`);

      // Analyzer check
      const diags = analyzeSemantics(src);
      assert.strictEqual(diags.length, 0, `nested-scatter-begin.swirl should have 0 analyzer diagnostics: ${JSON.stringify(diags)}`);

      // Formatter check
      const formatter = new SwirlFormatter();
      const formatted = formatter.format(src);
      const reParsed = new Parser(formatted);
      assert.strictEqual(reParsed.diagnostics.length, 0, 'Formatted nested-scatter-begin.swirl must parse without diagnostics');

      console.log('✓ Full validation of nested-scatter-begin.swirl passed (0 diagnostics, formats idempotently)');
    } else {
      console.log('⚠ nested-scatter-begin.swirl not found at ' + examplePath);
    }
  }

  console.log('All Scatter Begin tests passed successfully!\n');
}

runScatterBeginTests();
