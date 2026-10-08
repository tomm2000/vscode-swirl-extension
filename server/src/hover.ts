import { Hover, MarkupKind, Position, Range } from 'vscode-languageserver/node';
import { SWIRL_PREDICATES, SWIRL_KEYWORDS } from './swirl-data';
import { Parser, WorkflowNode, LocationNode, TraceNode, PredicateNode, parseCompilerHint, DataSetNode } from './parser';

/**
 * Provides rich hover tooltips for compiler hints, locations, steps,
 * predicates, language keywords, dynamic variables, and collection descriptors.
 */
export function getHover(text: string, position: Position): Hover | null {
  const lines = text.split(/\r?\n/);
  if (position.line < 0 || position.line >= lines.length) {
    return null;
  }

  const lineText = lines[position.line];

  // 1. Check for compiler hint on current line
  const hint = parseCompilerHint(lineText);
  if (hint) {
    const actionUpper = hint.action.toUpperCase();
    const tagDisplay = hint.tag ? ` (\`${hint.tag}\`)` : '';
    const mdLines: string[] = [
      `### 🧭 Swirl Compiler Hint: \`${actionUpper}\`${tagDisplay}`,
      `Demarcates optimization and execution boundaries for distributed execution engines.`
    ];

    const rows: string[] = [];
    if (hint.tag) rows.push(`| **Phase / Target** | \`${hint.tag}\` |`);
    if (hint.action) rows.push(`| **Action** | \`${hint.action}\` |`);
    if (hint.stream) rows.push(`| **Stream / Collection** | \`${hint.stream}\` |`);
    if (hint.worker) rows.push(`| **Worker / Location** | \`${hint.worker}\` |`);
    if (hint.port) rows.push(`| **Channel / Port** | \`${hint.port}\` |`);
    if (hint.region !== undefined) rows.push(`| **Region** | \`${hint.region}\` |`);
    if (hint.json.v !== undefined) rows.push(`| **Schema Version** | \`${hint.json.v}\` |`);
    if (hint.json.version !== undefined) rows.push(`| **Schema Version** | \`${hint.json.version}\` |`);
    if (hint.json.kind) rows.push(`| **Kind** | \`${hint.json.kind}\` |`);
    if (hint.json.method) rows.push(`| **Method** | \`${hint.json.method}\` |`);
    if (hint.json.parentRegion !== undefined) rows.push(`| **Parent Region** | \`${hint.json.parentRegion ?? 'none'}\` |`);
    if (hint.json.parent !== undefined) rows.push(`| **Parent Region** | \`${hint.json.parent ?? 'none'}\` |`);
    if (hint.json.controller) rows.push(`| **Controller** | \`${hint.json.controller}\` |`);
    if (Array.isArray(hint.json.workers)) rows.push(`| **Workers** | \`${hint.json.workers.join(', ')}\` |`);
    if (hint.json.step) rows.push(`| **Step** | \`${hint.json.step}\` |`);
    if (Array.isArray(hint.json.scatterPorts)) rows.push(`| **Scatter Ports** | \`${hint.json.scatterPorts.join(', ')}\` |`);
    if (Array.isArray(hint.json.inputPorts)) rows.push(`| **Input Ports** | \`${hint.json.inputPorts.join(', ')}\` |`);
    if (Array.isArray(hint.json.outputPorts)) rows.push(`| **Output Ports** | \`${hint.json.outputPorts.join(', ')}\` |`);
    if (hint.json.idPort) rows.push(`| **ID Port** | \`${hint.json.idPort}\` |`);
    if (hint.json.payloadPort) rows.push(`| **Payload Port** | \`${hint.json.payloadPort}\` |`);

    if (rows.length > 0) {
      mdLines.push('', '| Property | Value |', '| :--- | :--- |', ...rows);
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: mdLines.join('\n')
      },
      range: {
        start: { line: position.line, character: 0 },
        end: { line: position.line, character: lineText.length }
      }
    };
  }

  // 2. Extract word at cursor
  const wordRange = getWordRangeAtPosition(lineText, position.line, position.character);
  if (!wordRange) {
    return null;
  }

  const word = lineText.substring(wordRange.start.character, wordRange.end.character);

  // 3. Check Built-in Predicates & Keywords
  if (SWIRL_PREDICATES[word]) {
    const doc = SWIRL_PREDICATES[word];
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### Predicate: \`${doc.name}\``,
          `\`\`\`swirl\n${doc.signature}\n\`\`\``,
          doc.description,
          `**Example:**`,
          `\`\`\`swirl\n${doc.example}\n\`\`\``
        ].join('\n\n')
      },
      range: wordRange
    };
  }

  if (SWIRL_KEYWORDS[word]) {
    const doc = SWIRL_KEYWORDS[word];
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### Keyword: \`${doc.name}\``,
          `\`\`\`swirl\n${doc.signature}\n\`\`\``,
          doc.description,
          `**Example:**`,
          `\`\`\`swirl\n${doc.example}\n\`\`\``
        ].join('\n\n')
      },
      range: wordRange
    };
  }

  // Check Dynamic Variable
  if (word.startsWith('?')) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### Dynamic Variable: \`${word}\``,
          `Dynamic runtime variable/key parameter in parallel scatter-gather workflows.`
        ].join('\n\n')
      },
      range: wordRange
    };
  }

  const parser = new Parser(text);
  const wf = parser.parseWorkflow();

  const formatPairs = (ds: DataSetNode) => {
    if (ds.elements && ds.elements.length > 0) {
      return ds.elements
        .map((e) => (e.kind === 'collection' ? `\`U(${e.port}, ${e.data})\`` : `\`(${e.first}, ${e.second})\``))
        .join(', ');
    }
    return ds.pairs.map((p) => `\`(${p.first}, ${p.second})\``).join(', ');
  };

  // 4. Check if word is a Location
  const loc = wf.locations.find((l) => l.name === word);
  if (loc) {
    const preds = collectPredicates(loc.trace);
    const steps = preds.filter((p): p is Extract<PredicateNode, { kind: 'exec' }> => p.kind === 'exec').map((p) => `\`${p.step}\``);
    const sendsTo = new Set<string>();
    const recvsFrom = new Set<string>();

    for (const p of preds) {
      if (p.kind === 'send' || p.kind === 'move') {
        p.dst.locations.forEach((d) => sendsTo.add(`\`${d}\``));
      } else if (p.kind === 'recv') {
        recvsFrom.add(`\`${p.src}\``);
      }
    }

    const dsText =
      (loc.dataset.elements && loc.dataset.elements.length > 0) || loc.dataset.pairs.length > 0
        ? formatPairs(loc.dataset)
        : '*(empty)*';

    const md: string[] = [
      `### Location: \`<${loc.name}>\``,
      `**Datasets / Initial State:** ${dsText}`,
      `**Steps Executed (${steps.length}):** ${steps.length > 0 ? steps.join(', ') : '*(none)*'}`,
      `**Sends To:** ${sendsTo.size > 0 ? Array.from(sendsTo).join(', ') : '*(none)*'}`,
      `**Receives From:** ${recvsFrom.size > 0 ? Array.from(recvsFrom).join(', ') : '*(none)*'}`
    ];

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: md.join('\n\n')
      },
      range: wordRange
    };
  }

  // 5. Check if word is a Step (e.g. s_sc, s_work)
  for (const l of wf.locations) {
    const preds = collectPredicates(l.trace);
    const exec = preds.find(
      (p): p is Extract<PredicateNode, { kind: 'exec' }> => p.kind === 'exec' && p.step === word
    );
    if (exec) {
      const inPorts = formatPairs(exec.flow.from);
      const outPorts = formatPairs(exec.flow.to);
      const mappings = exec.mapping.locations.map((m) => `\`<${m}>\``).join(', ');

      const md: string[] = [
        `### Workflow Step: \`${exec.step}\``,
        `**Mapped Locations:** ${mappings}`,
        `**Input Data:** ${inPorts || '*(none)*'}`,
        `**Output Data:** ${outPorts || '*(none)*'}`
      ];

      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: md.join('\n\n')
        },
        range: wordRange
      };
    }
  }

  return null;
}

function getWordRangeAtPosition(lineText: string, line: number, character: number): Range | null {
  if (character < 0 || character > lineText.length) {
    return null;
  }

  const isWordChar = (ch: string) => /[a-zA-Z0-9_?]/.test(ch);

  let start = character;
  while (start > 0 && isWordChar(lineText[start - 1])) {
    start--;
  }

  let end = character;
  while (end < lineText.length && isWordChar(lineText[end])) {
    end++;
  }

  if (start === end) {
    return null;
  }

  return {
    start: { line, character: start },
    end: { line, character: end }
  };
}

function collectPredicates(trace: TraceNode | undefined): PredicateNode[] {
  if (!trace) return [];
  if (trace.kind === 'tracePred') {
    return [trace.pred];
  }
  if (trace.kind === 'traceRepl') {
    return collectPredicates(trace.subTrace);
  }
  if (trace.kind === 'traceParen') {
    return collectPredicates(trace.inner);
  }
  if (trace.kind === 'traceOp') {
    return [...collectPredicates(trace.left), ...collectPredicates(trace.right)];
  }
  return [];
}
