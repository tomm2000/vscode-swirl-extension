import { Token, TokenKind, Lexer, Range, Position } from './lexer';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';

export interface DataRefNode {
  kind: 'dataRef';
  name: string;
  index?: string;
  isTuple?: boolean;
  elements?: DataRefNode[];
  range: Range;
}

export interface DataPairNode {
  kind: 'dataPair';
  first: string;
  firstRange?: Range;
  second: string;
  secondRange?: Range;
  range: Range;
}

export interface DataSetNode {
  kind: 'dataSet';
  pairs: DataPairNode[];
  range: Range;
}

export interface FlowNode {
  kind: 'flow';
  from: DataSetNode;
  to: DataSetNode;
  range: Range;
}

export interface LocationSetNode {
  kind: 'locationSet';
  isSet: boolean;
  locations: string[];
  range: Range;
}

export type PredicateNode =
  | {
      kind: 'exec';
      step: string;
      stepRange?: Range;
      flow: FlowNode;
      mapping: LocationSetNode;
      range: Range;
    }
  | {
      kind: 'send' | 'recv' | 'move';
      data: DataRefNode;
      port: string;
      portRange?: Range;
      src: string;
      srcRange?: Range;
      dst: LocationSetNode;
      range: Range;
    };

export type TraceNode =
  | { kind: 'tracePred'; pred: PredicateNode; range: Range }
  | { kind: 'traceZero'; range: Range }
  | { kind: 'traceRepl'; subTrace: TraceNode; range: Range }
  | { kind: 'traceParen'; inner: TraceNode; range: Range }
  | {
      kind: 'traceOp';
      op: '.' | '|' | '+';
      guard?: string;
      left: TraceNode;
      right: TraceNode;
      range: Range;
    };

export interface LocationNode {
  kind: 'location';
  name: string;
  nameRange?: Range;
  dataset: DataSetNode;
  trace: TraceNode;
  range: Range;
}

export interface WorkflowNode {
  kind: 'workflow';
  locations: LocationNode[];
  range: Range;
}

export interface CompilerHintInfo {
  action: 'begin' | 'end';
  tag?: string; // e.g. "scatter.dispatch", "scatter.worker", "scatter.gather"
  json: Record<string, any>;
  rawJson?: string;
  region?: string | number;
  phase?: string;
  directive: string;
}

export function parseCompilerHint(text: string): CompilerHintInfo | null {
  const trimmed = text.trim();

  // 1. New syntax:
  //    // [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}
  //    // [compiler](compiler) end scatter.dispatch {"region":0}
  //    // [compiler] begin/end ...
  //    // @compiler begin/end ...
  const newMatch = trimmed.match(
    /^\/\/\s*(?:\[compiler\](?:\([^)]*\))?|@compiler)\s+(begin|end)(?:\s+([a-zA-Z0-9_.-]+))?(?:\s+(\d+|[a-zA-Z0-9_:-]+))?(?:\s+({.*}))?\s*$/
  );
  if (newMatch) {
    let json: Record<string, any> = {};
    if (newMatch[4]) {
      try {
        json = JSON.parse(newMatch[4]);
      } catch {
        // ignore malformed JSON
      }
    }
    let tag: string | undefined = newMatch[2];
    let rawRegion: string | undefined = newMatch[3];
    if (tag !== undefined && /^\d+$/.test(tag) && rawRegion === undefined) {
      rawRegion = tag;
      tag = undefined;
    }
    let region: string | number | undefined = json.region !== undefined ? json.region : undefined;
    if (region === undefined && rawRegion !== undefined) {
      region = /^\d+$/.test(rawRegion) ? parseInt(rawRegion, 10) : rawRegion;
    }
    const phase = tag || json.phase;
    return {
      action: newMatch[1] as 'begin' | 'end',
      tag,
      json,
      rawJson: newMatch[4],
      region,
      phase,
      directive: newMatch[1]
    };
  }

  // 2. Legacy syntax:
  //    // @compiler_hint_start {"kind":"scatter", ...}
  //    // @compiler_hint_end ...
  const oldMatch = trimmed.match(/^\/\/\s*@compiler_hint_(start|end)(?:\s+({.*}))?$/);
  if (oldMatch) {
    let json: Record<string, any> = {};
    if (oldMatch[2]) {
      try {
        json = JSON.parse(oldMatch[2]);
      } catch {
        // ignore malformed JSON
      }
    }
    return {
      action: oldMatch[1] === 'start' ? 'begin' : 'end',
      tag: json.phase || json.kind,
      json,
      rawJson: oldMatch[2],
      region: json.region,
      phase: json.phase || json.kind,
      directive: oldMatch[1]
    };
  }

  return null;
}

export interface CommentNode {
  kind: 'comment';
  isBlock: boolean;
  isHint: boolean;
  hintInfo?: CompilerHintInfo;
  text: string;
  range: Range;
}

export class Parser {
  private tokens: Token[] = [];
  private current = 0;
  public diagnostics: Diagnostic[] = [];
  public comments: CommentNode[] = [];

  constructor(input: string) {
    const lexer = new Lexer(input);
    const allTokens = lexer.tokenize(false);

    for (const token of allTokens) {
      if (token.kind === TokenKind.LineComment) {
        const hintInfo = parseCompilerHint(token.value);
        this.comments.push({
          kind: 'comment',
          isBlock: false,
          isHint: hintInfo !== null,
          hintInfo: hintInfo ?? undefined,
          text: token.value,
          range: token.range
        });
      } else if (token.kind === TokenKind.BlockComment) {
        this.comments.push({
          kind: 'comment',
          isBlock: true,
          isHint: false,
          text: token.value,
          range: token.range
        });
      } else {
        this.tokens.push(token);
      }
    }
  }

  private isAtEnd(): boolean {
    return this.peek().kind === TokenKind.Eof;
  }

  private peek(): Token {
    return this.tokens[this.current] || {
      kind: TokenKind.Eof,
      value: '',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      offset: 0
    };
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private check(kind: TokenKind): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().kind === kind;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) return this.advance();
    this.error(this.peek().range, message);
    return this.peek();
  }

  private error(range: Range, message: string): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range,
      message,
      source: 'swirl'
    });
  }

  public parseWorkflow(): WorkflowNode {
    const startPos = this.peek().range.start;
    const locations: LocationNode[] = [];

    while (!this.isAtEnd()) {
      if (this.check(TokenKind.Lt)) {
        const loc = this.parseLocation();
        if (loc) {
          locations.push(loc);
        }
        if (this.match(TokenKind.Pipe)) {
          // Parallel location separator
          continue;
        } else {
          break;
        }
      } else {
        const unexpected = this.advance();
        this.error(unexpected.range, `Unexpected token '${unexpected.value}', expected '<' to start location definition`);
        // synchronize to next '<'
        while (!this.isAtEnd() && !this.check(TokenKind.Lt)) {
          this.advance();
        }
      }
    }

    if (!this.isAtEnd()) {
      const remaining = this.peek();
      this.error(remaining.range, `Unexpected tokens after workflow definition: '${remaining.value}'`);
    }

    const endPos = this.previous() ? this.previous().range.end : startPos;
    return {
      kind: 'workflow',
      locations,
      range: { start: startPos, end: endPos }
    };
  }

  private parseLocation(): LocationNode | null {
    const ltToken = this.consume(TokenKind.Lt, "Expected '<' to start location definition");
    const nameToken = this.consume(TokenKind.Identifier, 'Expected location identifier name');
    this.consume(TokenKind.Comma, "Expected ',' after location name");

    const dataset = this.parseDataSet();
    this.consume(TokenKind.Comma, "Expected ',' after location dataset");

    const trace = this.parseTrace();

    const gtToken = this.consume(TokenKind.Gt, "Expected '>' to close location definition");

    return {
      kind: 'location',
      name: nameToken.value,
      nameRange: nameToken.range,
      dataset,
      trace,
      range: { start: ltToken.range.start, end: gtToken.range.end }
    };
  }

  private parseDataSet(): DataSetNode {
    const openBrace = this.consume(TokenKind.OpenBrace, "Expected '{' to start dataset");
    const pairs: DataPairNode[] = [];

    if (!this.check(TokenKind.CloseBrace)) {
      do {
        if (this.check(TokenKind.OpenParen)) {
          const pair = this.parseDataPair();
          pairs.push(pair);
        } else {
          break;
        }
      } while (this.match(TokenKind.Comma));
    }

    const closeBrace = this.consume(TokenKind.CloseBrace, "Expected '}' to close dataset");
    return {
      kind: 'dataSet',
      pairs,
      range: { start: openBrace.range.start, end: closeBrace.range.end }
    };
  }

  private parseDataPairElement(): { value: string; range: Range } {
    const startToken = this.peek();
    if (this.match(TokenKind.Zero)) {
      return { value: '0', range: startToken.range };
    }
    if (this.match(TokenKind.EofKeyword)) {
      return { value: 'eof', range: startToken.range };
    }
    if (this.match(TokenKind.OpenParen)) {
      const openParen = this.previous();
      const elements: string[] = [];
      if (!this.check(TokenKind.CloseParen)) {
        do {
          elements.push(this.parseDataPairElement().value);
        } while (this.match(TokenKind.Comma));
      }
      const closeParen = this.consume(TokenKind.CloseParen, "Expected ')' to close data tuple in pair");
      return {
        value: `(${elements.join(', ')})`,
        range: { start: openParen.range.start, end: closeParen.range.end }
      };
    }
    if (this.match(TokenKind.Identifier)) {
      let name = this.previous().value;
      let endRange = this.previous().range;
      if (this.match(TokenKind.OpenBracket)) {
        const idxToken = this.consume(TokenKind.Identifier, 'Expected index identifier');
        const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after index");
        name = `${name}[${idxToken.value}]`;
        endRange = closeBracket.range;
      }
      return {
        value: name,
        range: { start: startToken.range.start, end: endRange.end }
      };
    }

    this.error(startToken.range, `Expected identifier, tuple, '0', or 'eof' in data pair, got '${startToken.value}'`);
    this.advance();
    return { value: startToken.value, range: startToken.range };
  }

  private parseDataPair(): DataPairNode {
    const openParen = this.consume(TokenKind.OpenParen, "Expected '(' to start data pair");
    const firstElem = this.parseDataPairElement();
    this.consume(TokenKind.Comma, "Expected ',' between data pair elements");
    const secondElem = this.parseDataPairElement();
    const closeParen = this.consume(TokenKind.CloseParen, "Expected ')' to close data pair");

    return {
      kind: 'dataPair',
      first: firstElem.value,
      firstRange: firstElem.range,
      second: secondElem.value,
      secondRange: secondElem.range,
      range: { start: openParen.range.start, end: closeParen.range.end }
    };
  }

  private parseLocationSet(): LocationSetNode {
    const startToken = this.peek();
    if (this.match(TokenKind.OpenBrace)) {
      const locations: string[] = [];
      if (!this.check(TokenKind.CloseBrace)) {
        do {
          const id = this.consume(TokenKind.Identifier, 'Expected location identifier').value;
          locations.push(id);
        } while (this.match(TokenKind.Comma));
      }
      const closeBrace = this.consume(TokenKind.CloseBrace, "Expected '}' to close location set");
      return {
        kind: 'locationSet',
        isSet: true,
        locations,
        range: { start: startToken.range.start, end: closeBrace.range.end }
      };
    } else if (this.match(TokenKind.Identifier)) {
      return {
        kind: 'locationSet',
        isSet: false,
        locations: [this.previous().value],
        range: this.previous().range
      };
    } else {
      this.error(startToken.range, "Expected location identifier or '{' location set");
      return {
        kind: 'locationSet',
        isSet: false,
        locations: [],
        range: startToken.range
      };
    }
  }

  private parseDataRef(): DataRefNode {
    const startToken = this.peek();
    if (this.match(TokenKind.Zero)) {
      return {
        kind: 'dataRef',
        name: '0',
        range: startToken.range
      };
    }
    if (this.match(TokenKind.EofKeyword)) {
      return {
        kind: 'dataRef',
        name: 'eof',
        range: startToken.range
      };
    }
    if (this.match(TokenKind.OpenParen)) {
      const openParen = this.previous();
      const elements: DataRefNode[] = [];
      if (!this.check(TokenKind.CloseParen)) {
        do {
          elements.push(this.parseDataRef());
        } while (this.match(TokenKind.Comma));
      }
      const closeParen = this.consume(TokenKind.CloseParen, "Expected ')' to close data tuple");
      const name = `(${elements.map((e) => (e.index ? `${e.name}[${e.index}]` : e.name)).join(', ')})`;
      return {
        kind: 'dataRef',
        name,
        isTuple: true,
        elements,
        range: { start: openParen.range.start, end: closeParen.range.end }
      };
    }
    if (this.match(TokenKind.Identifier)) {
      const name = this.previous().value;
      let index: string | undefined;
      let endRange = this.previous().range;
      if (this.match(TokenKind.OpenBracket)) {
        const idxToken = this.consume(TokenKind.Identifier, 'Expected index identifier');
        index = idxToken.value;
        const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after index");
        endRange = closeBracket.range;
      }
      return {
        kind: 'dataRef',
        name,
        index,
        range: { start: startToken.range.start, end: endRange.end }
      };
    }

    this.error(startToken.range, `Expected data identifier, tuple, '0', or 'eof', got '${startToken.value}'`);
    return {
      kind: 'dataRef',
      name: startToken.value,
      range: startToken.range
    };
  }

  private parseFlow(): FlowNode {
    const from = this.parseDataSet();
    this.consume(TokenKind.Arrow, "Expected '->' in flow definition");
    const to = this.parseDataSet();
    return {
      kind: 'flow',
      from,
      to,
      range: { start: from.range.start, end: to.range.end }
    };
  }

  private parsePredicate(): PredicateNode {
    const token = this.advance();
    const startPos = token.range.start;
    this.consume(TokenKind.OpenParen, `Expected '(' after '${token.value}'`);

    if (token.kind === TokenKind.Exec) {
      const stepToken = this.consume(TokenKind.Identifier, 'Expected step identifier for exec');
      this.consume(TokenKind.Comma, "Expected ',' after step identifier");
      const flow = this.parseFlow();
      this.consume(TokenKind.Comma, "Expected ',' after flow in exec");
      const mapping = this.parseLocationSet();
      const closeParen = this.consume(TokenKind.CloseParen, "Expected ')' to close exec predicate");
      return {
        kind: 'exec',
        step: stepToken.value,
        stepRange: stepToken.range,
        flow,
        mapping,
        range: { start: startPos, end: closeParen.range.end }
      };
    }

    // send, recv, move
    const predKind = token.kind as 'send' | 'recv' | 'move';
    const data = this.parseDataRef();
    this.consume(TokenKind.Arrow, "Expected '->' between data and port");
    const portToken = this.consume(TokenKind.Identifier, 'Expected port identifier');
    let port = portToken.value;
    let portRange = portToken.range;
    if (this.match(TokenKind.OpenBracket)) {
      const idxToken = this.consume(TokenKind.Identifier, 'Expected index identifier');
      const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after index");
      port = `${port}[${idxToken.value}]`;
      portRange = { start: portRange.start, end: closeBracket.range.end };
    }
    this.consume(TokenKind.Comma, "Expected ',' after port");
    const srcToken = this.consume(TokenKind.Identifier, 'Expected source location identifier');
    this.consume(TokenKind.Comma, "Expected ',' after source location");
    const dst = this.parseLocationSet();
    const closeParen = this.consume(TokenKind.CloseParen, `Expected ')' to close ${predKind} predicate`);

    return {
      kind: predKind,
      data,
      port,
      portRange,
      src: srcToken.value,
      srcRange: srcToken.range,
      dst,
      range: { start: startPos, end: closeParen.range.end }
    };
  }

  public parseTrace(): TraceNode {
    return this.parseChoice();
  }

  // CHOICE operator (+) has lowest precedence among binary trace operators
  private parseChoice(): TraceNode {
    let expr = this.parseParallel();

    while (this.match(TokenKind.Plus)) {
      const right = this.parseParallel();
      expr = {
        kind: 'traceOp',
        op: '+',
        left: expr,
        right,
        range: { start: expr.range.start, end: right.range.end }
      };
    }

    return expr;
  }

  // PAR operator (|)
  private parseParallel(): TraceNode {
    let expr = this.parseSequence();

    while (this.check(TokenKind.Pipe)) {
      this.advance();
      const right = this.parseSequence();
      expr = {
        kind: 'traceOp',
        op: '|',
        left: expr,
        right,
        range: { start: expr.range.start, end: right.range.end }
      };
    }

    return expr;
  }

  // SEQ operator (.)
  private parseSequence(): TraceNode {
    let expr = this.parseUnary();

    while (this.match(TokenKind.Dot)) {
      const right = this.parseUnary();
      expr = {
        kind: 'traceOp',
        op: '.',
        left: expr,
        right,
        range: { start: expr.range.start, end: right.range.end }
      };
    }

    return expr;
  }

  // REPL operator (!)
  private parseUnary(): TraceNode {
    if (this.match(TokenKind.Exclamation)) {
      const startPos = this.previous().range.start;
      const subTrace = this.parseUnary();
      return {
        kind: 'traceRepl',
        subTrace,
        range: { start: startPos, end: subTrace.range.end }
      };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): TraceNode {
    const token = this.peek();

    // Zero
    if (this.match(TokenKind.Zero)) {
      return {
        kind: 'traceZero',
        range: token.range
      };
    }

    // Parenthesized trace
    if (this.match(TokenKind.OpenParen)) {
      const startPos = this.previous().range.start;
      const inner = this.parseTrace();
      const closeParen = this.consume(TokenKind.CloseParen, "Expected ')' to close trace expression");
      return {
        kind: 'traceParen',
        inner,
        range: { start: startPos, end: closeParen.range.end }
      };
    }

    // Predicates: exec, send, recv, move
    if (
      token.kind === TokenKind.Exec ||
      token.kind === TokenKind.Send ||
      token.kind === TokenKind.Recv ||
      token.kind === TokenKind.Move
    ) {
      const pred = this.parsePredicate();
      return {
        kind: 'tracePred',
        pred,
        range: pred.range
      };
    }

    // Error recovery: unexpected token
    this.error(token.range, `Expected trace expression, got '${token.value}'`);
    this.advance();
    return {
      kind: 'traceZero',
      range: token.range
    };
  }
}
