import {
  DocumentSymbol,
  SymbolKind,
  Definition,
  Location as LspLocation,
  Range as LspRange,
  Position as LspPosition,
  FoldingRange,
  FoldingRangeKind
} from 'vscode-languageserver/node';
import { Lexer, Token, TokenKind } from './lexer';
import {
  Parser,
  WorkflowNode,
  LocationNode,
  CommentNode,
  TraceNode,
  PredicateNode,
  parseCompilerHint
} from './parser';

/**
 * Extracts document symbols for VS Code Outline pane and breadcrumb navigation.
 */
export function getDocumentSymbols(text: string): DocumentSymbol[] {
  const parser = new Parser(text);
  const wf = parser.parseWorkflow();
  const symbols: DocumentSymbol[] = [];

  for (const loc of wf.locations) {
    const locSymbol: DocumentSymbol = {
      name: `<${loc.name}>`,
      detail: loc.dataset.pairs.length > 0
        ? `{${loc.dataset.pairs.map((p) => `(${p.first}, ${p.second})`).join(', ')}}`
        : '{}',
      kind: SymbolKind.Module,
      range: toLspRange(loc.range),
      selectionRange: {
        start: { line: loc.range.start.line, character: loc.range.start.character },
        end: { line: loc.range.start.line, character: loc.range.start.character + 1 + loc.name.length }
      },
      children: []
    };

    // Include compiler hint regions within this location
    const locHints = parser.comments.filter(
      (c) =>
        c.range.start.line >= loc.range.start.line &&
        c.range.end.line <= loc.range.end.line &&
        (c.hintInfo?.action === 'begin' || parseCompilerHint(c.text)?.action === 'begin')
    );

    for (const h of locHints) {
      const info = h.hintInfo || parseCompilerHint(h.text);
      if (!info) continue;
      const regionStr = info.region !== undefined ? `Region ${info.region}` : 'Region';
      const phaseStr = info.tag || info.phase || 'compiler_hint';
      const details: string[] = [];
      if (info.phase) details.push(`phase: ${info.phase}`);
      if (info.json.method) details.push(`method: ${info.json.method}`);
      if (info.json.v !== undefined) details.push(`v: ${info.json.v}`);

      locSymbol.children!.push({
        name: `${phaseStr} (${regionStr})`,
        detail: details.join(', '),
        kind: SymbolKind.Package,
        range: toLspRange(h.range),
        selectionRange: toLspRange(h.range)
      });
    }

    // Recursively collect predicates from location's trace
    function collectPredicates(trace: TraceNode | undefined): void {
      if (!trace) return;
      if (trace.kind === 'tracePred') {
        const p = trace.pred;
        if (p.kind === 'exec') {
          const inFlow = p.flow.from.pairs.map((pr) => pr.first).join(', ');
          const outFlow = p.flow.to.pairs.map((pr) => pr.first).join(', ');
          locSymbol.children!.push({
            name: `exec: ${p.step}`,
            detail: `{${inFlow}} -> {${outFlow}} @ {${p.mapping.locations.join(', ')}}`,
            kind: SymbolKind.Function,
            range: toLspRange(p.range),
            selectionRange: p.stepRange ? toLspRange(p.stepRange) : toLspRange(p.range)
          });
        } else if (p.kind === 'send' || p.kind === 'move') {
          const dsts = p.dst.locations.join(', ');
          const dataDisplay = p.data.index ? `${p.data.name}[${p.data.index}]` : p.data.name;
          locSymbol.children!.push({
            name: `${p.kind}: ${dataDisplay} -> ${p.port}`,
            detail: `${p.src} -> {${dsts}}`,
            kind: SymbolKind.Event,
            range: toLspRange(p.range),
            selectionRange: p.portRange ? toLspRange(p.portRange) : toLspRange(p.range)
          });
        } else if (p.kind === 'recv') {
          const dsts = p.dst.locations.join(', ');
          const dataDisplay = p.data.index ? `${p.data.name}[${p.data.index}]` : p.data.name;
          locSymbol.children!.push({
            name: `recv: ${dataDisplay} -> ${p.port}`,
            detail: `${p.src} -> {${dsts}}`,
            kind: SymbolKind.Event,
            range: toLspRange(p.range),
            selectionRange: p.portRange ? toLspRange(p.portRange) : toLspRange(p.range)
          });
        }
      } else if (trace.kind === 'traceRepl') {
        collectPredicates(trace.subTrace);
      } else if (trace.kind === 'traceParen') {
        collectPredicates(trace.inner);
      } else if (trace.kind === 'traceOp') {
        collectPredicates(trace.left);
        collectPredicates(trace.right);
      }
    }

    collectPredicates(loc.trace);
    symbols.push(locSymbol);
  }

  return symbols;
}

/**
 * Finds the definition of an identifier at cursor position.
 * Supports:
 * - Jumping from location references (in mapping, send/recv/move dst/src) to `<location>` definition
 * - Jumping from predicate names to their first usage or step definition
 */
export function getDefinition(text: string, uri: string, position: LspPosition): Definition | null {
  const parser = new Parser(text);
  const wf = parser.parseWorkflow();

  const token = findTokenAt(text, position);
  if (!token || token.kind !== TokenKind.Identifier) {
    return null;
  }

  const name = token.value;

  // 1. Check if token matches a location definition <loc>
  const targetLoc = wf.locations.find((l) => l.name === name);
  if (targetLoc && targetLoc.nameRange) {
    return {
      uri,
      range: toLspRange(targetLoc.nameRange)
    };
  }

  return null;
}

/**
 * Finds all references to a location, port, or step identifier across the document.
 */
export function getReferences(
  text: string,
  uri: string,
  position: LspPosition,
  includeDeclaration: boolean = true
): LspLocation[] {
  const token = findTokenAt(text, position);
  if (!token || token.kind !== TokenKind.Identifier) {
    return [];
  }

  const name = token.value;
  const lexer = new Lexer(text);
  const allTokens = lexer.tokenize(true);
  const references: LspLocation[] = [];

  for (const t of allTokens) {
    if (t.kind === TokenKind.Identifier && t.value === name) {
      references.push({
        uri,
        range: toLspRange(t.range)
      });
    }
  }

  return references;
}

/**
 * Computes folding ranges for locations, compiler hint regions, and multiline parentheses/braces.
 */
export function getFoldingRanges(text: string): FoldingRange[] {
  const foldingRanges: FoldingRange[] = [];
  const parser = new Parser(text);
  const wf = parser.parseWorkflow();

  // 1. Location blocks: <name, ..., trace>
  for (const loc of wf.locations) {
    if (loc.range.end.line > loc.range.start.line) {
      foldingRanges.push({
        startLine: loc.range.start.line,
        endLine: loc.range.end.line,
        kind: FoldingRangeKind.Region
      });
    }
  }

  // 2. Compiler hint regions: begin ... end
  const hintStarts: CommentNode[] = [];
  for (const comment of parser.comments) {
    const info = comment.hintInfo || parseCompilerHint(comment.text);
    if (!info) continue;

    if (info.action === 'begin') {
      hintStarts.push(comment);
    } else if (info.action === 'end' && hintStarts.length > 0) {
      const start = hintStarts.pop()!;
      foldingRanges.push({
        startLine: start.range.start.line,
        endLine: comment.range.end.line,
        kind: FoldingRangeKind.Region
      });
    }
  }

  // 3. Multiline blocks, parentheses, braces, and block comments
  const tokens = new Lexer(text).tokenize(true);
  const parenStack: Token[] = [];
  const braceStack: Token[] = [];

  for (const t of tokens) {
    if (t.kind === TokenKind.OpenParen) {
      parenStack.push(t);
    } else if (t.kind === TokenKind.CloseParen && parenStack.length > 0) {
      const open = parenStack.pop()!;
      if (t.range.start.line > open.range.start.line) {
        foldingRanges.push({
          startLine: open.range.start.line,
          endLine: t.range.start.line
        });
      }
    } else if (t.kind === TokenKind.OpenBrace) {
      braceStack.push(t);
    } else if (t.kind === TokenKind.CloseBrace && braceStack.length > 0) {
      const open = braceStack.pop()!;
      if (t.range.start.line > open.range.start.line) {
        foldingRanges.push({
          startLine: open.range.start.line,
          endLine: t.range.start.line
        });
      }
    } else if (t.kind === TokenKind.BlockComment) {
      if (t.range.end.line > t.range.start.line) {
        foldingRanges.push({
          startLine: t.range.start.line,
          endLine: t.range.end.line,
          kind: FoldingRangeKind.Comment
        });
      }
    }
  }

  return foldingRanges;
}

function findTokenAt(text: string, position: LspPosition): Token | null {
  const lexer = new Lexer(text);
  const tokens = lexer.tokenize(true);

  for (const t of tokens) {
    if (
      position.line >= t.range.start.line &&
      position.line <= t.range.end.line &&
      position.character >= t.range.start.character &&
      position.character < t.range.end.character
    ) {
      return t;
    }
  }

  for (const t of tokens) {
    if (
      position.line >= t.range.start.line &&
      position.line <= t.range.end.line &&
      position.character === t.range.end.character &&
      t.kind !== TokenKind.Whitespace
    ) {
      return t;
    }
  }

  return null;
}

function toLspRange(r: { start: { line: number; character: number }; end: { line: number; character: number } }): LspRange {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character }
  };
}
