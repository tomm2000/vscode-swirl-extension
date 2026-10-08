import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { simplifySwirl, mergeParallelScatterSends } from '../simplifier';
import { Parser } from '../parser';
import { getHover } from '../hover';

function runSimplifierTests() {
  console.log('--- Running Swirl Simplifier Tests ---');

  // Test 1: User's exact scatter_stream snippet
  {
    const input = `      // @compiler begin scatter_stream stream_d_snp_files l1 p_scatter_1_0
      (
        !(
          (
            move((?element_d_snp_files, ?key_0) -> p_scatter_1_0, l0, l1)
          )
          +[p_scatter_1_0 has data]
          (
            end()
          )
        )
        .
        send(eof -> p_scatter_1_0, l0, l1)
      )
      // @compiler end scatter_stream stream_d_snp_files l1 p_scatter_1_0`;

    const simplified = simplifySwirl(input);
    const expected = `      scatter_send(stream_d_snp_files -> p_scatter_1_0, l0, l1)`;
    assert.strictEqual(simplified.trim(), expected.trim(), 'User scatter_stream snippet should simplify accurately');
    console.log('✓ Test 1: User scatter_stream snippet simplifies to scatter_send(stream_d_snp_files -> p_scatter_1_0, l0, l1)');
  }

  // Test 2: User's gather_stream snippet
  {
    const input = `      // @compiler begin gather_stream stream_d_chromosome_overlap_files l1 p_gather_data_0_2
      (
        !(
          (
            recv((?d_chromosome_mutation_overlap_output_file, ?key_0) -> p_gather_data_0_2, l1, l0)
          )
          +
          (
            recv(eof -> p_gather_data_0_2, l1, l0)
            .
            end()
          )
        )
      )
      // @compiler end gather_stream stream_d_chromosome_overlap_files l1 p_gather_data_0_2`;

    const simplified = simplifySwirl(input);
    const expected = `      gather_recv(stream_d_chromosome_overlap_files -> p_gather_data_0_2, l1, l0)`;
    assert.strictEqual(simplified.trim(), expected.trim(), 'User gather_stream snippet should simplify accurately');
    console.log('✓ Test 2: User gather_stream snippet simplifies to gather_recv(stream_d_chromosome_overlap_files -> p_gather_data_0_2, l1, l0)');
  }

  // Test 3: Bracket-indexed port qualifiers
  {
    const input = `// @compiler begin scatter_stream stream_element_element_d_groups l5 p_scatter_0_2[?key_0, ?key_1]
(
  !(
    (move((?element_element_d_groups, ?key_0, ?key_1) -> p_scatter_0_2[?key_0, ?key_1], l0, l5))
    +[p_scatter_0_2[?key_0, ?key_1] has data]
    (end())
  )
  .
  send(eof -> p_scatter_0_2[?key_0, ?key_1], l0, l5)
)
// @compiler end scatter_stream stream_element_element_d_groups l5 p_scatter_0_2[?key_0, ?key_1]`;

    const simplified = simplifySwirl(input);
    const expected = `scatter_send(stream_element_element_d_groups -> p_scatter_0_2[?key_0, ?key_1], l0, l5)`;
    assert.strictEqual(simplified.trim(), expected.trim(), 'Bracketed port indices should be preserved');
    console.log('✓ Test 3: Bracketed port index qualifiers preserved in simplified output');
  }

  // Test 4: Merging parallel scatter_sends (User Request)
  {
    const input = `    (
      scatter_send(stream_d_snp_files -> p_scatter_1_0, l0, l1)
      |
      scatter_send(stream_d_snp_files -> p_scatter_1_0, l0, l2)
    )`;

    const merged = mergeParallelScatterSends(input);
    const expected = `    scatter_send(stream_d_snp_files -> p_scatter_1_0, l0, {l1, l2})`;
    assert.strictEqual(merged.trim(), expected.trim(), 'Parallel scatter_sends should merge into set destination');
    console.log('✓ Test 4: Merging parallel scatter_send branches into scatter_send(stream -> port, l0, {l1, l2})');
  }

  // Test 5: Full workflow simplification & merging AST verification
  {
    const examplePath = path.join(__dirname, '../../../examples/scatter-streamflow.swirl');
    if (fs.existsSync(examplePath)) {
      const original = fs.readFileSync(examplePath, 'utf8');

      // Unmerged mode
      const unmerged = simplifySwirl(original, { mergeScatterSends: false });
      assert(unmerged.includes('scatter_send(stream_d_files_a -> p_scatter_0_0, l0, l0)'));
      assert(unmerged.includes('scatter_send(stream_d_files_a -> p_scatter_0_0, l0, l1)'));
      assert(unmerged.includes('scatter_send(stream_d_files_a -> p_scatter_0_0, l0, l2)'));

      // Merged mode (default)
      const simplified = simplifySwirl(original);
      assert(
        simplified.includes('scatter_send(stream_d_files_a -> p_scatter_0_0, l0, {l0, l1, l2})'),
        'Stream files_a should be merged across l0, l1, l2'
      );
      assert(
        simplified.includes('scatter_send(stream_d_files_b -> p_scatter_1_0, l0, {l0, l1, l2})'),
        'Stream files_b should be merged across l0, l1, l2'
      );
      assert(simplified.includes('gather_recv(stream_d_compute_result -> p_compute_result, l0, l0)'));

      // Validate simplified code parses cleanly with no syntax errors
      const parser = new Parser(simplified);
      const { workflow, diagnostics } = parser.parse();
      assert.strictEqual(diagnostics.length, 0, `Simplified workflow should produce 0 diagnostics, got: ${JSON.stringify(diagnostics)}`);
      assert.strictEqual(workflow.locations.length, 3, 'Simplified workflow should retain 3 locations');
      console.log('✓ Test 5: Full scatter-streamflow.swirl simplifies and merges cleanly with 0 diagnostics');
    }
  }

  // Test 6: Rich hover for scatter_send and gather_recv
  {
    const sample = `<l0, {},
  scatter_send(stream_d_files_a -> p_scatter_0_0, l0, {l1, l2})
  |
  gather_recv(stream_d_compute_result -> p_compute_result, l1, l0)
>`;
    const scatterHover = getHover(sample, { line: 1, character: 4 });
    assert(scatterHover, 'Should provide hover for scatter_send');
    assert((scatterHover.contents as any).value.includes('scatter_send'), 'Hover should document scatter_send');

    const gatherHover = getHover(sample, { line: 3, character: 4 });
    assert(gatherHover, 'Should provide hover for gather_recv');
    assert((gatherHover.contents as any).value.includes('gather_recv'), 'Hover should document gather_recv');
    console.log('✓ Test 6: Rich Hover tooltips correctly document scatter_send and gather_recv');
  }

  console.log('All Swirl Simplifier tests passed successfully!\n');
}

runSimplifierTests();
