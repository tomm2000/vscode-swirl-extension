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
import { Parser, WorkflowNode, LocationNode, CommentNode, TraceNode, PredicateNode } from './parser';

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
        c.text.includes('@compiler_hint_start')
    );

    for (const h of locHints) {
      try {
        const jsonStr = h.text.replace(/^\/\/\s*@compiler_hint_start\s*/, '');
        const meta = JSON.parse(jsonStr);
        locSymbol.children!.push({
          name: `Region: ${meta.region || meta.kind || 'compiler_hint'}`,
          detail: `phase: ${meta.phase || ''}${meta.method ? `, method: ${meta.method}` : ''}`,
          kind: SymbolKind.Package,
          range: toLspRange(h.range),
          selectionRange: toLspRange(h.range)
        });
      } catch {
        // Ignore unparseable hint JSON
      }
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
            detail: `{${inFlow}} -> {${outFlow}}`,
            kind: SymbolKind.Function,
            range: toLspRange(p.range),
            selectionRange: toLspRange(p.range)
          });
        } else {
          const detail =
            p.kind === 'send'
              ? `to ${p.dst.isSet ? `{${p.dst.locations.join(', ')}}` : p.dst.locations[0]}`
              : p.kind === 'recv'
              ? `from ${p.src}`
              : `${p.src} -> {${p.dst.locations.join(', ')}}`;

          locSymbol.children!.push({
            name: `${p.kind}: ${p.data.name} -> ${p.port}`,
            detail,
            kind: SymbolKind.Event,
            range: toLspRange(p.range),
            selectionRange: toLspRange(p.range)
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

    // Sort children chronologically by source appearance
    locSymbol.children!.sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character
    );

    symbols.push(locSymbol);
  }

  return symbols;
}

/**
 * Finds the definition for the symbol at the given position (F12).
 */
export function getDefinition(text: string, uri: string, position: LspPosition): Definition | null {
  const token = findTokenAt(text, position);
  if (!token || token.kind !== TokenKind.Identifier) {
    return null;
  }

  const name = token.value;
  const parser = new Parser(text);
  const wf = parser.parseWorkflow();

  // 1. Is it a location? Jump to <name
  const locDef = wf.locations.find((l) => l.name === name);
  if (locDef) {
    return {
      uri,
      range: toLspRange(locDef.range)
    };
  }

  // 2. Is it a step name? Jump to exec(step, ...)
  for (const loc of wf.locations) {
    const stepPred = findStepInTrace(loc.trace, name);
    if (stepPred) {
      return {
        uri,
        range: toLspRange(stepPred.range)
      };
    }
  }

  // 3. Is it a data or port identifier? Jump to first declaration
  const tokens = new Lexer(text).tokenize(false);
  const firstOccur = tokens.find((t) => t.value === name);
  if (firstOccur && (firstOccur.range.start.line !== token.range.start.line || firstOccur.range.start.character !== token.range.start.character)) {
    return {
      uri,
      range: toLspRange(firstOccur.range)
    };
  }

  return null;
}

/**
 * Finds all references to the symbol at the given position (Shift+F12).
 */
export function getReferences(
  text: string,
  uri: string,
  position: LspPosition,
  includeDeclaration = true
): LspLocation[] {
  const token = findTokenAt(text, position);
  if (!token) {
    return [];
  }

  const name = token.value;
  const tokens = new Lexer(text).tokenize(false);
  const matches = tokens.filter((t) => t.value === name);

  return matches
    .filter((t) => {
      if (!includeDeclaration && t.range.start.line === token.range.start.line && t.range.start.character === token.range.start.character) {
        return false;
      }
      return true;
    })
    .map((t) => ({
      uri,
      range: toLspRange(t.range)
    }));
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

  // 2. Compiler hint regions: // @compiler_hint_start ... // @compiler_hint_end
  const hintStarts: CommentNode[] = [];
  for (const comment of parser.comments) {
    if (comment.text.includes('@compiler_hint_start')) {
      hintStarts.push(comment);
    } else if (comment.text.includes('@compiler_hint_end') && hintStarts.length > 0) {
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
          endLine: t.range.end.line
        });
      }
    } else if (t.kind === TokenKind.OpenBrace) {
      braceStack.push(t);
    } else if (t.kind === TokenKind.CloseBrace && braceStack.length > 0) {
      const open = braceStack.pop()!;
      if (t.range.start.line > open.range.start.line) {
        foldingRanges.push({
          startLine: open.range.start.line,
          endLine: t.range.end.line
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

// Helpers

function toLspRange(r: { start: { line: number; character: number }; end: { line: number; character: number } }): LspRange {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character }
  };
}

function findTokenAt(text: string, position: LspPosition): Token | null {
  const tokens = new Lexer(text).tokenize(false);
  for (const t of tokens) {
    if (
      t.range.start.line === position.line &&
      position.character >= t.range.start.character &&
      position.character < t.range.end.character
    ) {
      return t;
    }
  }

  // Trailing edge match for identifiers
  for (const t of tokens) {
    if (
      t.range.start.line === position.line &&
      position.character === t.range.end.character &&
      t.kind === TokenKind.Identifier
    ) {
      return t;
    }
  }

  return null;
}

function findStepInTrace(trace: TraceNode | undefined, stepName: string): PredicateNode | null {
  if (!trace) return null;
  if (trace.kind === 'tracePred') {
    if (trace.pred.kind === 'exec' && trace.pred.step === stepName) {
      return trace.pred;
    }
    return null;
  }
  if (trace.kind === 'traceRepl') return findStepInTrace(trace.subTrace, stepName);
  if (trace.kind === 'traceParen') return findStepInTrace(trace.inner, stepName);
  if (trace.kind === 'traceOp') {
    return findStepInTrace(trace.left, stepName) || findStepInTrace(trace.right, stepName);
  }
  return null;
}
