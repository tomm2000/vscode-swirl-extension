import { Hover, MarkupKind, Position, Range } from 'vscode-languageserver/node';
import { SWIRL_PREDICATES, SWIRL_KEYWORDS } from './swirl-data';
import { Parser, WorkflowNode, LocationNode, TraceNode, PredicateNode } from './parser';
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
  const hintMatch = lineText.match(/\/\/\s*@compiler_hint_(start|end)\s*({.*})/);
  if (hintMatch) {
    const directive = hintMatch[1];
    try {
      const meta = JSON.parse(hintMatch[2]);
      const mdLines: string[] = [
        `### 🧭 Swirl Compiler Hint: \`${directive.toUpperCase()}\``,
        `Demarcates optimization and execution boundaries for distributed execution engines.`
      ];

      const rows: string[] = [];
      if (meta.region) rows.push(`| **Region** | \`${meta.region}\` |`);
      if (meta.phase) rows.push(`| **Phase** | \`${meta.phase}\` |`);
      if (meta.kind) rows.push(`| **Kind** | \`${meta.kind}\` |`);
      if (meta.method) rows.push(`| **Method** | \`${meta.method}\` |`);
      if (meta.parentRegion !== undefined) rows.push(`| **Parent Region** | \`${meta.parentRegion ?? 'none'}\` |`);
      if (meta.controller) rows.push(`| **Controller** | \`${meta.controller}\` |`);
      if (Array.isArray(meta.workers)) rows.push(`| **Workers** | \`${meta.workers.join(', ')}\` |`);
      if (meta.step) rows.push(`| **Step** | \`${meta.step}\` |`);
      if (Array.isArray(meta.scatterPorts)) rows.push(`| **Scatter Ports** | \`${meta.scatterPorts.join(', ')}\` |`);
      if (Array.isArray(meta.inputPorts)) rows.push(`| **Input Ports** | \`${meta.inputPorts.join(', ')}\` |`);
      if (Array.isArray(meta.outputPorts)) rows.push(`| **Output Ports** | \`${meta.outputPorts.join(', ')}\` |`);
      if (meta.idPort) rows.push(`| **ID Port** | \`${meta.idPort}\` |`);
      if (meta.payloadPort) rows.push(`| **Payload Port** | \`${meta.payloadPort}\` |`);
      if (meta.version !== undefined) rows.push(`| **Schema Version** | \`${meta.version}\` |`);

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
    } catch {
      // Ignore parse failure and fall through
    }
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

    const info = [
      `### Location: \`<${loc.name}>\``,
      `- **Initial Dataset**: ${dsText}`,
      `- **Executed Steps**: ${steps.length > 0 ? Array.from(new Set(steps)).join(', ') : '*(none)*'}`,
      `- **Sends to**: ${sendsTo.size > 0 ? Array.from(sendsTo).join(', ') : '*(none)*'}`,
      `- **Receives from**: ${recvsFrom.size > 0 ? Array.from(recvsFrom).join(', ') : '*(none)*'}`
    ];

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: info.join('\n')
      },
      range: wordRange
    };
  }

  // 5. Check if word is a Step (exec)
  for (const l of wf.locations) {
    const preds = collectPredicates(l.trace);
    const execPred = preds.find((p): p is Extract<PredicateNode, { kind: 'exec' }> => p.kind === 'exec' && p.step === word);
    if (execPred) {
      const inFlow = execPred.flow.from.pairs.length > 0
        ? execPred.flow.from.pairs.map((p) => `\`(${p.first}, ${p.second})\``).join(', ')
        : '*(empty)*';
      const outFlow = execPred.flow.to.pairs.length > 0
        ? execPred.flow.to.pairs.map((p) => `\`(${p.first}, ${p.second})\``).join(', ')
        : '*(empty)*';
      const mapping = execPred.mapping.locations.map((m) => `\`${m}\``).join(', ');

      const info = [
        `### Workflow Step: \`${execPred.step}\``,
        `- **Location**: \`<${l.name}>\``,
        `- **Input Flow**: ${inFlow}`,
        `- **Output Flow**: ${outFlow}`,
        `- **Target Mapping**: ${mapping}`
      ];

      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: info.join('\n')
        },
        range: wordRange
      };
    }
  }

  return null;
}

function getWordRangeAtPosition(line: string, lineIndex: number, char: number): Range | null {
  if (char < 0 || char >= line.length) return null;

  let start = char;
  while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) {
    start--;
  }

  let end = char;
  while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) {
    end++;
  }

  if (start === end) return null;

  return {
    start: { line: lineIndex, character: start },
    end: { line: lineIndex, character: end }
  };
}
