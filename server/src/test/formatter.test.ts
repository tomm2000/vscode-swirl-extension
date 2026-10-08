import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { SwirlFormatter } from '../formatter';

function runTests() {
  console.log('Running Swirl extension tests...');
  const formatter = new SwirlFormatter({ tabSize: 2, insertSpaces: true });

  // Test 1: Basic inline location
  {
    const input = '<l1, {}, recv(p2 -> d2, l0, l1) .exec(s2, {(p2, d2)} -> {}, {l1})>';
    const formatted = formatter.format(input);
    const parser = new Parser(formatted);
    parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Test 1 failed: formatted code had diagnostics');
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Test 1 failed: formatting is not idempotent');
    console.log('✓ Test 1: Basic inline location formatting passed');
  }

  // Test 2: Multiline location with sequence and parallel
  {
    const input = `<l0, {(p1, d1)},
  exec(s1, {(p1, d1)} -> {(p2, d2)}, {l0}) .
  (
    send(d2 -> p2, l0, l1) |
    send(d2 -> p2, l0, l2)
  )
>`;
    const formatted = formatter.format(input);
    const parser = new Parser(formatted);
    parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Test 2 failed: formatted code had diagnostics');
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Test 2 failed: formatting is not idempotent');
    console.log('✓ Test 2: Multiline sequence and parallel formatting passed');
  }

  // Test 3: Choice and Replication formatting
  {
    const input = `<l2, {},
  !(
    (recv(id_ID -> p_id, l0, l2) . send(res_ID -> p_res, l2, l0)) +
    (recv(eof -> p_id, l0, l2) . send(eof -> p_res, l2, l0))
  )
>`;
    const formatted = formatter.format(input);
    const parser = new Parser(formatted);
    parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Test 3 failed: formatted code had diagnostics');
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Test 3 failed: formatting is not idempotent');
    console.log('✓ Test 3: Choice and replication formatting passed');
  }

  // Test 4: Preserving comments and compiler hints inside locations without moving
  {
    const input = `// Header comment
<l0, {(p1, d1)},
  // @compiler_hint_start {"kind":"scatter"}
  exec(s1, {(p1, d1)} -> {(p2, d2)}, {l0}) .
  // @compiler_hint_end {"kind":"scatter"}
  exec(s2, {(p2, d2)} -> {}, {l0})
> |

<l1, {},
  recv(p2 -> d2, l0, l1)
>`;
    const formatted = formatter.format(input);
    assert(formatted.includes('// Header comment'), 'Header comment missing');
    assert(formatted.includes('// @compiler_hint_start {"kind":"scatter"}'), 'Compiler hint start missing');
    assert(formatted.includes('// @compiler_hint_end {"kind":"scatter"}'), 'Compiler hint end missing');

    // Crucial check: verify compiler hint is INSIDE l0, BEFORE l0 closes, and BEFORE l1 begins
    const l0Idx = formatted.indexOf('<l0');
    const hintStartIdx = formatted.indexOf('// @compiler_hint_start');
    const hintEndIdx = formatted.indexOf('// @compiler_hint_end');
    const l0CloseIdx = formatted.indexOf('> |');
    const l1Idx = formatted.indexOf('<l1');

    assert(l0Idx < hintStartIdx, 'hintStart must be after <l0');
    assert(hintStartIdx < hintEndIdx, 'hintStart must be before hintEnd');
    assert(hintEndIdx < l0CloseIdx, 'hintEnd must be before > | of l0');
    assert(l0CloseIdx < l1Idx, '> | must be before <l1');

    // Verify idempotency
    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Test 4 failed: formatting is not idempotent');

    console.log('✓ Test 4: Preserving comments and compiler hints without moving passed');
  }

  // Test 5: Real-world swirl files from swirlc-tmp (including build/workflow.swirl)
  const realFiles: string[] = [];
  const swirlcExamplesDir = '/home/tommo/Coding/Alpha/swirlc-tmp/examples/swirl';
  if (fs.existsSync(swirlcExamplesDir)) {
    const exampleDirs = fs.readdirSync(swirlcExamplesDir);
    for (const dir of exampleDirs) {
      const fullDir = path.join(swirlcExamplesDir, dir);
      if (fs.statSync(fullDir).isDirectory()) {
        const files = fs.readdirSync(fullDir).filter((f) => f.endsWith('.swirl'));
        for (const f of files) {
          realFiles.push(path.join(fullDir, f));
        }
      }
    }
  }
  const buildWorkflow = '/home/tommo/Coding/Alpha/swirlc-tmp/build/workflow.swirl';
  if (fs.existsSync(buildWorkflow)) {
    realFiles.push(buildWorkflow);
  }

  for (const filePath of realFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Parse original
    const origParser = new Parser(content);
    origParser.parseWorkflow();
    assert.strictEqual(
      origParser.diagnostics.length,
      0,
      `Original file ${filePath} has unexpected diagnostics: ${JSON.stringify(origParser.diagnostics)}`
    );

    // Format
    const formatted = formatter.format(content);

    // Parse formatted
    const formattedParser = new Parser(formatted);
    formattedParser.parseWorkflow();
    assert.strictEqual(
      formattedParser.diagnostics.length,
      0,
      `Formatted file ${filePath} produced diagnostics: ${JSON.stringify(formattedParser.diagnostics)}`
    );

    // Check idempotency
    const formattedTwice = formatter.format(formatted);
    assert.strictEqual(formatted, formattedTwice, `Formatting not idempotent for ${filePath}`);

    console.log(`✓ Test 5: Successfully formatted & validated real-world example: ${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`);
  }

  // Test 6: Fallback format on malformed code
  {
    const malformed = `<l1, {(p1, d1)}, exec(s1, -> incomplete`;
    const fallback = formatter.format(malformed);
    assert(fallback.includes('exec'), 'Fallback should retain tokens');
    assert(fallback.includes('<l1'), 'Fallback should retain location header');
    console.log('✓ Test 6: Fallback formatter on malformed input passed');
  }

  // Test 7: Full expansion of compact traces (scatter/gather workflow snippet)
  {
    const compactInput = `<l0, {(p_batches, d_batches)},
  (
    // [compiler](compiler) begin scatter.worker 0
    !(
      (
        recv((task_id_0, task_payload_0) -> p_task_0, l0, l0) .exec(_s_open_0, {(p_task_0, task_payload_0)} -> {(p_open_data_0_0, process_batch_batch[task_id_0])}, {l0}) .  // [compiler](compiler) begin scatter.dispatch 1
        exec(_s_scatter_1, {(p_open_data_0_0, process_batch_batch[task_id_0])} -> {(p_task_1, (task_id_1, task_payload_1))}, {l0}) .
        !((move((task_id_1, task_payload_1) -> p_task_1, l0, {l1})) + (send(eof -> p_task_1, l0, l1)))
        // [compiler](compiler) end scatter.dispatch 1
        .
        // [compiler](compiler) begin scatter.gather 1
        (!(recv(echo_item_output[task_id_1] -> p_echo_item_output, l1, l0) + recv(eof -> p_echo_item_output, l1, l0))) .
        exec(_s_gather_1, {(p_echo_item_output, echo_item_output[task_id_1])} -> {(p_echo_item_output, echo_item_output[task_id_0])}, {l0})
        // [compiler](compiler) end scatter.gather 1
        .
        send(echo_item_output[task_id_0] -> p_echo_item_output, l0, l0)
      )
      +
      (recv(eof -> p_task_0, l0, l0) .send(eof -> p_echo_item_output, l0, l0))
    )
    // [compiler](compiler) end scatter.worker 0
  )
>`;

    const formatted = formatter.format(compactInput);

    // Verify dot expansion
    assert(formatted.includes('\n        .\n'), 'Sequential dot should be on its own line');
    // Verify choice expansion
    assert(formatted.includes('\n      +\n'), 'Choice plus should be on its own line');
    // Verify replication expansion
    assert(formatted.includes('!(\n'), 'Replication should open on its own line');

    const parser = new Parser(formatted);
    parser.parseWorkflow();
    assert.strictEqual(parser.diagnostics.length, 0, 'Formatted compact trace produced diagnostics');

    const formattedAgain = formatter.format(formatted);
    assert.strictEqual(formatted, formattedAgain, 'Formatting compact trace is not idempotent');
    console.log('✓ Test 7: Full expansion of compact traces passed');
  }

  console.log('\nAll tests passed successfully!');
}

runTests();
