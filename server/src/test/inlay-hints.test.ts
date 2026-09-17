import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { getInlayHints } from '../inlay-hints';
import { InlayHintKind } from 'vscode-languageserver/node';

function testExecInlayHintsDefault() {
  const code = `<l0, {}, exec(s1, {(p1, d1)} -> {(p2, d2)}, {l0})>`;
  const hints = getInlayHints(code);

  assert.strictEqual(hints.length, 4, `Expected 4 hints for exec, got ${hints.length}`);
  assert.strictEqual(hints[0].label, 'step:');
  assert.strictEqual(hints[0].kind, InlayHintKind.Parameter);
  assert.strictEqual(hints[1].label, 'in:');
  assert.strictEqual(hints[2].label, 'out:');
  assert.strictEqual(hints[3].label, 'mapping:');
  console.log('✓ Inlay Hints: exec predicate (inOut style) passed');
}

function testExecInlayHintsFlowStyle() {
  const code = `<l0, {}, exec(s1, {(p1, d1)} -> {(p2, d2)}, {l0})>`;
  const hints = getInlayHints(code, undefined, { execFlowStyle: 'flow' });

  assert.strictEqual(hints.length, 3, `Expected 3 hints for exec in flow mode, got ${hints.length}`);
  assert.strictEqual(hints[0].label, 'step:');
  assert.strictEqual(hints[1].label, 'flow:');
  assert.strictEqual(hints[2].label, 'mapping:');
  console.log('✓ Inlay Hints: exec predicate (flow style) passed');
}

function testSendRecvMoveInlayHints() {
  const code = `<l0, {}, send(d1 -> p1, l0, l1) . recv(p2 -> d2, l1, l0) . move(d3 -> p3, l0, {l1, l2})>`;
  const hints = getInlayHints(code);

  assert.strictEqual(hints.length, 12, `Expected 12 hints (4 per comm predicate), got ${hints.length}`);
  // send
  assert.strictEqual(hints[0].label, 'data:');
  assert.strictEqual(hints[1].label, 'port:');
  assert.strictEqual(hints[2].label, 'src:');
  assert.strictEqual(hints[3].label, 'dst:');

  // recv
  assert.strictEqual(hints[4].label, 'data:');
  assert.strictEqual(hints[5].label, 'port:');
  assert.strictEqual(hints[6].label, 'src:');
  assert.strictEqual(hints[7].label, 'dst:');

  // move
  assert.strictEqual(hints[8].label, 'data:');
  assert.strictEqual(hints[9].label, 'port:');
  assert.strictEqual(hints[10].label, 'src:');
  assert.strictEqual(hints[11].label, 'dst:');

  console.log('✓ Inlay Hints: send, recv, and move communication predicates passed');
}

function testLocationTags() {
  const code = `<l0, {(p, d)}, 0>`;
  const hints = getInlayHints(code, undefined, { enableLocationTags: true });

  assert.strictEqual(hints.length, 3, `Expected 3 hints for location components, got ${hints.length}`);
  assert.strictEqual(hints[0].label, 'loc:');
  assert.strictEqual(hints[1].label, 'data:');
  assert.strictEqual(hints[2].label, 'trace:');
  console.log('✓ Inlay Hints: location component tags passed');
}

function testRangeFiltering() {
  const code = `<l0, {}, exec(s1, {(p1, d1)} -> {}, {l0}) . send(d1 -> p1, l0, l1)>`;
  // Restrict range to only cover send (character 40+)
  const hints = getInlayHints(code, {
    start: { line: 0, character: 40 },
    end: { line: 0, character: 70 }
  });

  assert.strictEqual(hints.length, 4, `Expected only send hints within range, got ${hints.length}`);
  assert.strictEqual(hints[0].label, 'data:');
  assert.strictEqual(hints[1].label, 'port:');
  assert.strictEqual(hints[2].label, 'src:');
  assert.strictEqual(hints[3].label, 'dst:');
  console.log('✓ Inlay Hints: viewport range filtering passed');
}

function testRealWorldWorkflows() {
  const basicPath = '/home/tommo/Coding/Alpha/swirlc-tmp/examples/swirl/basic/source.swirl';
  if (fs.existsSync(basicPath)) {
    const basicCode = fs.readFileSync(basicPath, 'utf8');
    const hints = getInlayHints(basicCode);
    assert.ok(hints.length >= 20, `Expected at least 20 hints in basic workflow, got ${hints.length}`);
    console.log(`✓ Inlay Hints: basic/source.swirl generated ${hints.length} parameter tags`);
  }

  const complexPath = '/home/tommo/Coding/Alpha/swirlc-tmp/build/workflow.swirl';
  if (fs.existsSync(complexPath)) {
    const complexCode = fs.readFileSync(complexPath, 'utf8');
    const hints = getInlayHints(complexCode);
    assert.ok(hints.length > 50, `Expected > 50 hints in build workflow, got ${hints.length}`);
    console.log(`✓ Inlay Hints: build/workflow.swirl generated ${hints.length} parameter tags`);
  }
}

function run() {
  console.log('--- Running Inlay Hints Tests ---');
  testExecInlayHintsDefault();
  testExecInlayHintsFlowStyle();
  testSendRecvMoveInlayHints();
  testLocationTags();
  testRangeFiltering();
  testRealWorldWorkflows();
  console.log('All Inlay Hints tests passed successfully!\n');
}

run();
