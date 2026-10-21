import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Parser, parseCompilerHint } from '../parser';
import { analyzeSemantics } from '../analyzer';
import { SwirlFormatter } from '../formatter';
import { getDocumentSymbols, getFoldingRanges } from '../features';
import { getInlayHints } from '../inlay-hints';
import { getHover } from '../hover';

function runNewGrammarTests() {
  console.log('--- Running New Grammar Tests (Part 1C: ?vars, U(...), end(), +[guard], qualified ports) ---');

  const minimalWorkflow = `
<l0, {(p_in, d_in)},
  (
    exec(process_batch, {(p_in, d_in)} -> {U(p_task_0, tasks_0)}, {l0})
    .
    !(
      move((?payload_0, ?key_0) -> p_task_0, l0, l1)
      +
      send(eof -> p_task_0, l0, l1)
    )
  )
  |
  (
    !(
      recv((?payload_1, ?key_1) -> p_gather_data_0_1, l1, l0)
      +
      recv(eof -> p_gather_data_0_1, l1, l0)
    )
    .
    exec(_s_gather_0, {U(p_gather_data_0_1, results_0_1)} -> {(p_out, d_out)}, {l0})
  )
>
|
<l1, {},
  !(
    (
      recv((?payload_0, ?key_0) -> p_task_0, l0, l1)
      .
      send((?payload_0, ?key_0) -> p_gather_data_0_1, l1, l0)
    )
    +
    (
      recv(eof -> p_task_0, l0, l1)
      .
      send(eof -> p_gather_data_0_1, l1, l0)
    )
  )
>
`;

  // Test 1: Minimal workflow validation
  {
    // 1. Parser
    const parser = new Parser(minimalWorkflow);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Minimal workflow should parse with 0 errors');
    assert.strictEqual(wf.locations.length, 2, 'Should define 2 locations');

    // 2. Semantics
    const diags = analyzeSemantics(minimalWorkflow);
    assert.strictEqual(diags.length, 0, 'Minimal workflow should pass semantic analysis with 0 errors');

    // 3. Formatter idempotency
    const formatter = new SwirlFormatter();
    const formatted = formatter.format(minimalWorkflow);
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Formatter should be idempotent on minimal workflow');
    assert(formatted.includes('U(p_task_0, tasks_0)'), 'Formatted code should preserve U collection descriptor');

    // 4. Document symbols
    const symbols = getDocumentSymbols(minimalWorkflow);
    assert.strictEqual(symbols.length, 2, 'Should have 2 location symbols');
    const l0 = symbols[0];
    const execSymbol = l0.children?.find((c) => c.name.includes('exec: process_batch'));
    assert(execSymbol, 'Outline should include exec symbol');

    // 5. Inlay hints
    const hints = getInlayHints(minimalWorkflow, undefined, {
      enableParameterNames: true,
      execFlowStyle: 'inOut',
      enableLocationTags: true
    });
    assert(hints.length > 0, 'Should generate inlay hints');
    const dataHints = hints.filter((h) => h.label === 'data:');
    assert(dataHints.length >= 3, 'Should have parameter hints for data payloads');

    console.log('✓ Minimal new syntax workflow (with U, ?vars) passes all tools');
  }

  // Test 2: Multi-element qualified ports and collections: p_task_2[?key_0, ?key_1]
  {
    const multiIndexWorkflow = `
<l0, {(p_in, d_in)},
  exec(step_multi, {(p_in, d_in)} -> {U(p_task_2[?key_0, ?key_1], tasks_2)}, {l0}) .
  move((?payload, ?key_0, ?key_1) -> p_task_2[?key_0, ?key_1], l0, l1)
>
|
<l1, {},
  recv((?payload, ?key_0, ?key_1) -> p_task_2[?key_0, ?key_1], l0, l1)
>
`;
    const parser = new Parser(multiIndexWorkflow);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Multi-index workflow should parse with 0 errors');
    assert.strictEqual(wf.locations.length, 2);

    const diags = analyzeSemantics(multiIndexWorkflow);
    assert.strictEqual(diags.length, 0, 'Should have 0 semantic diagnostics');

    const formatter = new SwirlFormatter();
    const formatted = formatter.format(multiIndexWorkflow);
    assert(formatted.includes('p_task_2[?key_0, ?key_1]'), 'Should preserve multi-index port qualifier');
    assert(formatted.includes('U(p_task_2[?key_0, ?key_1], tasks_2)'), 'Should format collection descriptor with index');
    console.log('✓ Multi-index port qualifiers and indexed collection descriptors pass cleanly');
  }

  // Test 3: Hover documentation for new constructs
  {
    const testDoc = `
<l0, {U(p_data, tasks)},
  exec(step1, {U(p_data, tasks)} -> {(p_out, d_out)}, {l0}) .
  recv(?item -> p_data, l1, l0)
>
`;

    // Hover on 'U'
    const uHover = getHover(testDoc, { line: 1, character: 6 });
    assert(uHover, 'Should provide hover for U');
    assert(
      (uHover.contents as any).value.includes('Finite collection descriptor'),
      'Hover should include U documentation'
    );

    // Hover on '?item'
    const varHover = getHover(testDoc, { line: 3, character: 8 });
    assert(varHover, 'Should provide hover for ?item');
    assert(
      (varHover.contents as any).value.includes('Dynamic runtime variable'),
      'Hover should document dynamic variable'
    );
    console.log('✓ Rich Hover documentation for U(...) and ?vars verified');
  }

  // Test 4: Real-world swirlc build/new-syntax/part-1c examples
  {
    const part1cDir = '/home/tommo/Coding/Alpha/swirlc/build/new-syntax/part-1c';
    if (fs.existsSync(part1cDir)) {
      const examples = [
        'minimal/workflow.swirl',
        'dotproduct/workflow.swirl',
        'shared/workflow.swirl',
        'zip/workflow.swirl',
        'three-shared/workflow.swirl',
        'three-separate/workflow.swirl',
        'flat_crossproduct/workflow.swirl',
        'nested_crossproduct/workflow.swirl',
        'empty-inner/workflow.swirl',
        'aliases/workflow.swirl'
      ];

      for (const relPath of examples) {
        const fullPath = path.join(part1cDir, relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');

          // 1. Parse
          const parser = new Parser(content);
          const wf = parser.parseWorkflow();
          assert.strictEqual(
            parser.diagnostics.length,
            0,
            `${relPath} should have 0 parser diagnostics. Found: ${JSON.stringify(parser.diagnostics)}`
          );
          assert(wf.locations.length > 0, `${relPath} should define at least 1 location`);

          // 2. Semantic Analysis
          const diags = analyzeSemantics(content);
          assert.strictEqual(
            diags.length,
            0,
            `${relPath} should have 0 semantic diagnostics. Found: ${JSON.stringify(diags)}`
          );

          // 3. Formatter Idempotency
          const formatter = new SwirlFormatter();
          const formatted = formatter.format(content);
          const formattedAgain = formatter.format(formatted);
          assert.strictEqual(formatted, formattedAgain, `Formatter must be idempotent on ${relPath}`);

          // 4. Document Symbols
          const symbols = getDocumentSymbols(content);
          assert.strictEqual(symbols.length, wf.locations.length, `${relPath} should extract symbols for each location`);

          // 5. Inlay hints
          const hints = getInlayHints(content, undefined, {
            enableParameterNames: true,
            execFlowStyle: 'inOut',
            enableLocationTags: false
          });
          assert(hints.length > 0, `${relPath} should generate parameter hints`);

          console.log(`✓ Real-world part-1c example verified: ${relPath}`);
        }
      }
    }
  }

  // Test 5: Real-world swirlc examples/swirl/scatter4.swirl
  {
    const scatter4Path = '/home/tommo/Coding/Alpha/swirlc/examples/swirl/scatter4.swirl';
    if (fs.existsSync(scatter4Path)) {
      const content = fs.readFileSync(scatter4Path, 'utf8');
      const parser = new Parser(content);
      const wf = parser.parseWorkflow();
      assert.strictEqual(parser.diagnostics.length, 0, 'scatter4.swirl should have 0 parser diagnostics');
      assert.strictEqual(wf.locations.length, 3, 'scatter4.swirl should define 3 locations');

      const diags = analyzeSemantics(content);
      assert.strictEqual(diags.length, 0, 'scatter4.swirl should have 0 semantic diagnostics');

      const formatter = new SwirlFormatter();
      const formatted = formatter.format(content);
      const formattedAgain = formatter.format(formatted);
      assert.strictEqual(formatted, formattedAgain, 'Formatter should be idempotent on scatter4.swirl');

      console.log('✓ Real-world scatter4.swirl verified');
    }
  }

  // Test 6: User snippet: independent scatter-streamflow workflow
  {
    const snippetPath = path.join(__dirname, '../../../examples/scatter-streamflow.swirl');
    assert(fs.existsSync(snippetPath), 'examples/scatter-streamflow.swirl should exist');
    const content = fs.readFileSync(snippetPath, 'utf8');

    // 1. Parse
    const parser = new Parser(content);
    const wf = parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'User snippet should parse with 0 errors');
    assert.strictEqual(wf.locations.length, 3, 'User snippet defines 3 locations (l0, l1, l2)');

    // 2. Semantic Analysis
    const diags = analyzeSemantics(content);
    assert.strictEqual(diags.length, 0, 'User snippet should pass semantic analysis with 0 errors');

    // 3. Formatter Idempotency
    const formatter = new SwirlFormatter();
    const formatted = formatter.format(content);
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Formatter should be idempotent on user snippet');

    // 4. Compiler hint recognition
    const hintComments = parser.comments.filter((c) => c.isHint);
    assert.strictEqual(hintComments.length, 24, 'User snippet contains 24 compiler hint comments');
    const tags = hintComments.map((c) => c.hintInfo?.tag);
    assert(tags.includes('scatter.worker'), 'Includes scatter.worker hint');
    assert(tags.includes('gather_stream'), 'Includes gather_stream hint');
    assert(tags.includes('scatter_stream'), 'Includes scatter_stream hint');

    // 5. Document Symbols
    const symbols = getDocumentSymbols(content);
    assert.strictEqual(symbols.length, 3, 'Should produce 3 location symbols');
    const l0Sym = symbols[0];
    const l0Hints = l0Sym.children?.filter((c) => c.name.includes('gather_stream') || c.name.includes('scatter_stream'));
    assert(l0Hints && l0Hints.length > 0, 'Outline includes gather_stream and scatter_stream symbols');

    // 6. Folding Ranges
    const ranges = getFoldingRanges(content);
    assert(ranges.length > 0, 'Should generate folding ranges for compiler hints and locations');

    console.log('✓ User independent scatter-streamflow snippet passes all verification checks');
  }

  // Test 7: All 27 independent stream workflows from swirlc compiler build
  {
    const independentDir = '/home/tommo/Coding/Alpha/swirlc/build/new-syntax/independent';
    if (fs.existsSync(independentDir)) {
      const dirs = fs.readdirSync(independentDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      assert.strictEqual(dirs.length, 27, 'Should find all 27 independent stream test fixtures');
      let totalHints = 0;

      for (const d of dirs) {
        const filePath = path.join(independentDir, d, 'workflow.swirl');
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');

          // 1. Parse
          const parser = new Parser(content);
          const wf = parser.parseWorkflow();
          assert.strictEqual(
            parser.diagnostics.length,
            0,
            `Workflow ${d} failed to parse: ${JSON.stringify(parser.diagnostics)}`
          );
          assert(wf.locations.length > 0);

          // 2. Semantics
          const diags = analyzeSemantics(content);
          assert.strictEqual(
            diags.length,
            0,
            `Workflow ${d} failed semantic analysis: ${JSON.stringify(diags)}`
          );

          // 3. Formatter Idempotency
          const formatter = new SwirlFormatter();
          const formatted = formatter.format(content);
          const formattedAgain = formatter.format(formatted);
          assert.strictEqual(formatted, formattedAgain, `Formatter not idempotent on ${d}`);

          // 4. Hints
          const hints = parser.comments.filter((c) => c.isHint);
          totalHints += hints.length;
        }
      }

      assert.strictEqual(totalHints, 672, 'All 672 compiler hints in the 27 independent workflows recognized');
      console.log(`✓ All 27 independent stream workflows (672 compiler hints) parsed, analyzed, and formatted cleanly`);
    }
  }

  console.log('All New Grammar tests passed successfully!\n');
}

runNewGrammarTests();
