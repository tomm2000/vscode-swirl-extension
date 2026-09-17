import { Hover, MarkupKind, Position, Range } from 'vscode-languageserver/node';
import { SWIRL_PREDICATES, SWIRL_KEYWORDS } from './swirl-data';
import { Parser, WorkflowNode, LocationNode, TraceNode, PredicateNode, parseCompilerHint } from './parser';
import { Lexer, TokenKind } from './lexer';

/**
 * Provides rich hover tooltips for compiler hints, locations, steps,
 * predicates, and language keywords.
 */
export function getHover(text: string, position: Position): Hover | null {
  const lines = text.split('\n');
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

  // Find word at position
  const wordRange = getWordRangeAtPosition(lineText, position.line, position.character);
  if (!wordRange) return null;

  const word = lineText.substring(wordRange.start.character, wordRange.end.character);

  // 2. Check built-in predicates
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

  // 3. Check built-in keywords
  if (SWIRL_KEYWORDS[word]) {
    const doc = SWIRL_KEYWORDS[word];
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### Keyword / Constant: \`${doc.name}\``,
          `\`\`\`swirl\n${doc.signature}\n\`\`\``,
          doc.description,
          `**Example:**`,
          `\`\`\`swirl\n${doc.example}\n\`\`\``
        ].join('\n\n')
      },
      range: wordRange
    };
  }

  // Parse workflow for contextual symbols (Locations and Steps)
  const parser = new Parser(text);
  const wf = parser.parseWorkflow();

  function collectPredicates(trace: TraceNode | undefined, acc: PredicateNode[] = []): PredicateNode[] {
    if (!trace) return acc;
    if (trace.kind === 'tracePred') acc.push(trace.pred);
    else if (trace.kind === 'traceRepl') collectPredicates(trace.subTrace, acc);
    else if (trace.kind === 'traceParen') collectPredicates(trace.inner, acc);
    else if (trace.kind === 'traceOp') {
      collectPredicates(trace.left, acc);
      collectPredicates(trace.right, acc);
    }
    return acc;
  }

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

    const dsText = loc.dataset.pairs.length > 0
      ? loc.dataset.pairs.map((p) => `\`(${p.first}, ${p.second})\``).join(', ')
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
      const inPorts = exec.flow.from.pairs.map((p) => `\`(${p.first}, ${p.second})\``).join(', ');
      const outPorts = exec.flow.to.pairs.map((p) => `\`(${p.first}, ${p.second})\``).join(', ');
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

  const isWordChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch);

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
