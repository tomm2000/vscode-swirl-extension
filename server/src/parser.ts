import { Token, TokenKind, Lexer, Range, Position } from './lexer';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';

export interface CommentNode {
  kind: 'lineComment' | 'blockComment';
  text: string;
  value: string;
  range: Range;
  isHint?: boolean;
  hintInfo?: CompilerHintInfo;
}

export interface DataRefNode {
  kind: 'dataRef';
  name: string;
  index?: string;
  isTuple?: boolean;
  isVariable?: boolean;
  isKeyPath?: boolean;
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

export interface CollectionNode {
  kind: 'collection';
  port: string;
  portRange?: Range;
  data: string;
  dataRange?: Range;
  parentScope?: string;
  parentScopeRange?: Range;
  range: Range;
}

export type DataSetItem = DataPairNode | CollectionNode;

export interface DataSetNode {
  kind: 'dataSet';
  pairs: DataPairNode[];
  collections: CollectionNode[];
  elements: DataSetItem[];
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
      kind: 'send' | 'recv' | 'move' | 'scatter_send' | 'gather_recv';
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
  tag?: string; // e.g. "scatter.dispatch", "scatter.worker", "scatter.gather", "gather_stream", "scatter_stream"
  json: Record<string, any>;
  rawJson?: string;
  region?: string | number;
  phase?: string;
  directive: string;
  stream?: string;
  worker?: string;
  port?: string;
  args?: string[];
}

export function parseCompilerHint(text: string): CompilerHintInfo | null {
  const trimmed = text.trim();

  // 1. New syntax:
  //    // @compiler begin scatter.worker 0
  //    // @compiler begin gather_stream results_0_0 l0 p_compute_result_key_0
  //    // @compiler begin scatter_stream stream_d_files_a l0 p_scatter_0_0
  //    // @compiler begin scatter_stream stream_element_element_d_groups l5 p_scatter_0_2[?key_0, ?key_1]
  //    // [compiler](compiler) begin scatter.dispatch {"region":0,"v":1}
  //    // [compiler] begin scatter.dispatch 0
  const prefixMatch = trimmed.match(
    /^\/\/\s*(?:\[compiler\](?:\([^)]*\))?|@compiler)\s+(begin|end)(.*)$/
  );
  if (prefixMatch) {
    const action = prefixMatch[1] as 'begin' | 'end';
    let rest = prefixMatch[2].trim();

    let json: Record<string, any> = {};
    let rawJson: string | undefined = undefined;

    // Check if the remaining part starts with JSON
    const jsonMatch = rest.match(/^([a-zA-Z0-9_.]+)?\s*(\{.*\})$/);
    if (jsonMatch) {
      const tag = jsonMatch[1];
      rawJson = jsonMatch[2];
      try {
        json = JSON.parse(rawJson);
      } catch {
        json = {};
      }
      return {
        action,
        tag: tag || json.kind,
        json,
        rawJson,
        region: json.region,
        phase: tag || json.kind,
        directive: action
      };
    }

    // Tokenize rest taking care of bracketed port parameters e.g. port[?key_0, ?key_1]
    const tokens: string[] = [];
    let idx = 0;
    while (idx < rest.length) {
      while (idx < rest.length && /\s/.test(rest[idx])) idx++;
      if (idx >= rest.length) break;
      let token = '';
      let bDepth = 0;
      while (idx < rest.length) {
        const ch = rest[idx];
        if (ch === '[') bDepth++;
        else if (ch === ']') bDepth = Math.max(0, bDepth - 1);
        else if (/\s/.test(ch) && bDepth === 0) break;
        token += ch;
        idx++;
      }
      tokens.push(token);
    }

    const firstToken = tokens[0];
    const secondToken = tokens[1];
    const thirdToken = tokens[2];
    const fourthToken = tokens[3];

    // Bare number region: // @compiler begin scatter.worker 0
    if (firstToken && secondToken !== undefined && /^[0-9]+$/.test(secondToken)) {
      const regionNum = parseInt(secondToken, 10);
      json = { kind: firstToken, region: regionNum };
      return {
        action,
        tag: firstToken,
        json,
        region: regionNum,
        phase: firstToken,
        directive: action,
        args: tokens.slice(2)
      };
    }

    // Multi-argument stream hint: // @compiler begin scatter_stream stream_d_files_a l0 p_scatter_0_0
    if (firstToken === 'scatter_stream' || firstToken === 'gather_stream') {
      json = {
        kind: firstToken,
        stream: secondToken,
        worker: thirdToken,
        port: fourthToken
      };
      return {
        action,
        tag: firstToken,
        json,
        phase: firstToken,
        directive: action,
        stream: secondToken,
        worker: thirdToken,
        port: fourthToken,
        args: tokens.slice(1)
      };
    }

    // Other tag with optional args
    if (firstToken) {
      json = { kind: firstToken };
      return {
        action,
        tag: firstToken,
        json,
        phase: firstToken,
        directive: action,
        args: tokens.slice(1)
      };
    }

    return {
      action,
      directive: action,
      json: {}
    };
  }

  // 2. Legacy syntax: // @compiler_hint_start {"kind": "scatter.dispatch", ...}
  const oldMatch = trimmed.match(/^\/\/\s*@compiler_hint_(start|end)\s*(\{.*\})$/);
  if (oldMatch) {
    let json: Record<string, any> = {};
    if (oldMatch[2]) {
      try {
        json = JSON.parse(oldMatch[2]);
      } catch {
        json = {};
      }
    }
    const action = oldMatch[1] === 'start' ? 'begin' : 'end';
    return {
      action,
      tag: json.kind,
      json,
      rawJson: oldMatch[2],
      region: json.region,
      phase: json.kind,
      directive: action
    };
  }

  return null;
}

export class Parser {
  public diagnostics: Diagnostic[] = [];
  public comments: CommentNode[] = [];
  private tokens: Token[];
  private current = 0;

  constructor(input: string | Token[]) {
    if (typeof input === 'string') {
      const lexer = new Lexer(input);
      const allTokens = lexer.tokenize(true);
      this.comments = [];
      this.tokens = [];
      for (const t of allTokens) {
        if (t.kind === TokenKind.LineComment) {
          const hintInfo = parseCompilerHint(t.value) ?? undefined;
          this.comments.push({
            kind: 'lineComment',
            text: t.value,
            value: t.value,
            range: t.range,
            isHint: !!hintInfo,
            hintInfo
          });
        } else if (t.kind === TokenKind.BlockComment) {
          this.comments.push({
            kind: 'blockComment',
            text: t.value,
            value: t.value,
            range: t.range
          });
        } else if (t.kind !== TokenKind.Whitespace) {
          this.tokens.push(t);
        }
      }
    } else {
      this.tokens = input;
    }
  }

  public parseWorkflow(): WorkflowNode {
    return this.parse().workflow;
  }

  public parse(): { workflow: WorkflowNode; diagnostics: Diagnostic[] } {
    const locations: LocationNode[] = [];
    const startRange = this.tokens[0]?.range || {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 }
    };

    while (!this.isAtEnd()) {
      if (this.check(TokenKind.Lt)) {
        const loc = this.parseLocation();
        locations.push(loc);
        if (this.match(TokenKind.Pipe)) {
          // continuation
        }
      } else {
        this.error(this.peek().range, `Expected '<' to start location declaration, got '${this.peek().value}'`);
        this.advance();
      }
    }

    const endRange = this.previous()?.range || startRange;

    return {
      workflow: {
        kind: 'workflow',
        locations,
        range: { start: startRange.start, end: endRange.end }
      },
      diagnostics: this.diagnostics
    };
  }

  private parseLocation(): LocationNode {
    const openLt = this.consume(TokenKind.Lt, "Expected '<' to start location");
    const nameToken = this.consume(TokenKind.Identifier, "Expected location identifier");
    this.consume(TokenKind.Comma, "Expected ',' after location identifier");
    const dataset = this.parseDataSet();
    this.consume(TokenKind.Comma, "Expected ',' after location dataset");
    const trace = this.parseTrace();
    const closeGt = this.consume(TokenKind.Gt, "Expected '>' to close location");

    return {
      kind: 'location',
      name: nameToken.value,
      nameRange: nameToken.range,
      dataset,
      trace,
      range: { start: openLt.range.start, end: closeGt.range.end }
    };
  }

  public parsePortRef(): { value: string; range: Range } {
    const portToken = this.consume(TokenKind.Identifier, "Expected port identifier");
    let portName = portToken.value;
    let endRange = portToken.range;

    if (this.match(TokenKind.OpenBracket)) {
      const indices: string[] = [];
      while (!this.check(TokenKind.CloseBracket) && !this.isAtEnd()) {
        indices.push(this.advance().value);
        if (this.check(TokenKind.Comma)) {
          this.advance();
        }
      }
      const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after port index");
      portName = `${portToken.value}[${indices.join(', ')}]`;
      endRange = closeBracket.range;
    }

    return {
      value: portName,
      range: { start: portToken.range.start, end: endRange.end }
    };
  }

  public parseDataSet(): DataSetNode {
    const openBrace = this.consume(TokenKind.OpenBrace, "Expected '{' to start dataset");
    const pairs: DataPairNode[] = [];
    const collections: CollectionNode[] = [];
    const elements: DataSetItem[] = [];

    if (!this.check(TokenKind.CloseBrace)) {
      do {
        if (this.check(TokenKind.OpenParen)) {
          const pair = this.parseDataPair();
          pairs.push(pair);
          elements.push(pair);
        } else if (
          this.check(TokenKind.UKeyword) ||
          (this.peek().kind === TokenKind.Identifier && this.peek().value === 'U')
        ) {
          const uToken = this.advance();
          this.consume(TokenKind.OpenParen, "Expected '(' after 'U'");
          const portRef = this.parsePortRef();
          this.consume(TokenKind.Comma, "Expected ',' between port and data in U collection descriptor");
          const dataElem = this.parseDataPairElement();
          let parentScope: { value: string; range: Range } | undefined;
          if (this.match(TokenKind.Comma)) {
            parentScope = this.parseDataPairElement();
          }
          const closeParen = this.consume(TokenKind.CloseParen, "Expected ')' to close U collection descriptor");

          const colNode: CollectionNode = {
            kind: 'collection',
            port: portRef.value,
            portRange: portRef.range,
            data: dataElem.value,
            dataRange: dataElem.range,
            parentScope: parentScope?.value,
            parentScopeRange: parentScope?.range,
            range: { start: uToken.range.start, end: closeParen.range.end }
          };
          collections.push(colNode);
          elements.push(colNode);

          pairs.push({
            kind: 'dataPair',
            first: `U(${portRef.value}`,
            firstRange: portRef.range,
            second: parentScope ? `${dataElem.value}, ${parentScope.value}` : dataElem.value,
            secondRange: parentScope
              ? { start: dataElem.range.start, end: parentScope.range.end }
              : dataElem.range,
            range: colNode.range
          });
        } else {
          break;
        }
      } while (this.match(TokenKind.Comma));
    }

    const closeBrace = this.consume(TokenKind.CloseBrace, "Expected '}' to close dataset");
    return {
      kind: 'dataSet',
      pairs,
      collections,
      elements,
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
    if (this.match(TokenKind.BeginKeyword)) {
      return { value: 'begin', range: startToken.range };
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
    if (this.match(TokenKind.Variable, TokenKind.Identifier, TokenKind.BeginKeyword, TokenKind.EofKeyword)) {
      let value = this.previous().value;
      let endRange = this.previous().range;
      if (this.match(TokenKind.OpenBracket)) {
        const indices: string[] = [];
        while (!this.check(TokenKind.CloseBracket) && !this.isAtEnd()) {
          indices.push(this.advance().value);
          if (this.check(TokenKind.Comma)) {
            this.advance();
          }
        }
        const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after index");
        value = `${value}[${indices.join(", ")}]`;
        endRange = closeBracket.range;
      }

      // Handle hierarchical key path segments separated by '/'
      while (this.match(TokenKind.Slash)) {
        value += ' / ';
        if (this.match(TokenKind.Variable, TokenKind.Identifier, TokenKind.Number, TokenKind.BeginKeyword, TokenKind.EofKeyword)) {
          const segToken = this.previous();
          let segVal = segToken.value;
          endRange = segToken.range;
          if (this.match(TokenKind.OpenBracket)) {
            const indices: string[] = [];
            while (!this.check(TokenKind.CloseBracket) && !this.isAtEnd()) {
              indices.push(this.advance().value);
              if (this.check(TokenKind.Comma)) {
                this.advance();
              }
            }
            const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after index");
            segVal = `${segVal}[${indices.join(', ')}]`;
            endRange = closeBracket.range;
          }
          value += segVal;
        } else {
          this.error(this.peek().range, `Expected identifier or variable after '/' in key path, got '${this.peek().value}'`);
          break;
        }
      }

      return { value, range: { start: startToken.range.start, end: endRange.end } };
    }
    this.error(startToken.range, `Expected identifier or variable, got '${startToken.value}'`);
    this.advance();
    return { value: startToken.value, range: startToken.range };
  }

  private parseDataPair(): DataPairNode {
    const openParen = this.consume(TokenKind.OpenParen, "Expected '(' to start data pair");
    const portToken = this.parsePortRef();
    this.consume(TokenKind.Comma, "Expected ',' between port and data");
    const dataElem = this.parseDataPairElement();
    const closeParen = this.consume(TokenKind.CloseParen, "Expected ')' to close data pair");

    return {
      kind: 'dataPair',
      first: portToken.value,
      firstRange: portToken.range,
      second: dataElem.value,
      secondRange: dataElem.range,
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
    if (this.match(TokenKind.BeginKeyword)) {
      return {
        kind: 'dataRef',
        name: 'begin',
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
    if (this.match(TokenKind.Variable, TokenKind.Identifier, TokenKind.BeginKeyword, TokenKind.EofKeyword)) {
      let name = this.previous().value;
      let index: string | undefined;
      let endRange = this.previous().range;
      if (this.match(TokenKind.OpenBracket)) {
        const indices: string[] = [];
        while (!this.check(TokenKind.CloseBracket) && !this.isAtEnd()) {
          indices.push(this.advance().value);
          if (this.check(TokenKind.Comma)) {
            this.advance();
          }
        }
        const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after index");
        index = indices.join(', ');
        endRange = closeBracket.range;
      }

      // Handle hierarchical key path segments separated by '/'
      let isKeyPath = false;
      while (this.match(TokenKind.Slash)) {
        isKeyPath = true;
        name += ' / ';
        if (this.match(TokenKind.Variable, TokenKind.Identifier, TokenKind.Number, TokenKind.BeginKeyword, TokenKind.EofKeyword)) {
          const segToken = this.previous();
          let segVal = segToken.value;
          endRange = segToken.range;
          if (this.match(TokenKind.OpenBracket)) {
            const indices: string[] = [];
            while (!this.check(TokenKind.CloseBracket) && !this.isAtEnd()) {
              indices.push(this.advance().value);
              if (this.check(TokenKind.Comma)) {
                this.advance();
              }
            }
            const closeBracket = this.consume(TokenKind.CloseBracket, "Expected ']' after index");
            segVal = `${segVal}[${indices.join(', ')}]`;
            endRange = closeBracket.range;
          }
          name += segVal;
        } else {
          this.error(this.peek().range, `Expected identifier or variable after '/' in key path, got '${this.peek().value}'`);
          break;
        }
      }

      return {
        kind: 'dataRef',
        name,
        index,
        isVariable: name.includes('?'),
        isKeyPath,
        range: { start: startToken.range.start, end: endRange.end }
      };
    }

    this.error(startToken.range, `Expected data identifier, variable, tuple, '0', 'begin', or 'eof', got '${startToken.value}'`);
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

    // send, recv, move, scatter_send, gather_recv
    const predKind = token.kind as 'send' | 'recv' | 'move' | 'scatter_send' | 'gather_recv';
    const data = this.parseDataRef();
    this.consume(TokenKind.Arrow, "Expected '->' between data and port");
    const portRef = this.parsePortRef();
    this.consume(TokenKind.Comma, "Expected ',' after port");
    const srcToken = this.consume(TokenKind.Identifier, 'Expected source location identifier');
    this.consume(TokenKind.Comma, "Expected ',' after source location");
    const dst = this.parseLocationSet();
    const closeParen = this.consume(TokenKind.CloseParen, `Expected ')' to close ${predKind} predicate`);

    return {
      kind: predKind,
      data,
      port: portRef.value,
      portRange: portRef.range,
      src: srcToken.value,
      srcRange: srcToken.range,
      dst,
      range: { start: startPos, end: closeParen.range.end }
    };
  }

  public parseTrace(): TraceNode {
    return this.parseChoice();
  }

  private parseChoice(): TraceNode {
    let expr = this.parseParallel();

    while (this.match(TokenKind.Plus)) {
      let guard: string | undefined;
      if (this.match(TokenKind.OpenBracket)) {
        let bracketDepth = 1;
        const guardTokens: string[] = [];
        while (!this.isAtEnd() && bracketDepth > 0) {
          if (this.check(TokenKind.OpenBracket)) {
            bracketDepth++;
            guardTokens.push(this.advance().value);
          } else if (this.check(TokenKind.CloseBracket)) {
            bracketDepth--;
            if (bracketDepth === 0) {
              this.advance();
              break;
            }
            guardTokens.push(this.advance().value);
          } else {
            guardTokens.push(this.advance().value);
          }
        }
        guard = guardTokens.join(' ');
      }
      const right = this.parseParallel();
      expr = {
        kind: 'traceOp',
        op: '+',
        guard,
        left: expr,
        right,
        range: { start: expr.range.start, end: right.range.end }
      };
    }

    return expr;
  }

  private parseParallel(): TraceNode {
    let expr = this.parseSequence();

    while (this.match(TokenKind.Pipe)) {
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

    // Predicates: exec, send, recv, move, scatter_send, gather_recv
    if (
      token.kind === TokenKind.Exec ||
      token.kind === TokenKind.Send ||
      token.kind === TokenKind.Recv ||
      token.kind === TokenKind.Move ||
      token.kind === TokenKind.ScatterSend ||
      token.kind === TokenKind.GatherRecv
    ) {
      const pred = this.parsePredicate();
      return {
        kind: 'tracePred',
        pred,
        range: pred.range
      };
    }

    this.error(token.range, `Expected predicate, '0', or '(', got '${token.value}'`);
    this.advance();
    return {
      kind: 'traceZero',
      range: token.range
    };
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

  private check(kind: TokenKind): boolean {
    if (this.isAtEnd()) {
      return false;
    }
    return this.peek().kind === kind;
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.current++;
    }
    return this.previous();
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

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    this.error(this.peek().range, message);
    return this.peek();
  }

  private error(range: Range, message: string): void {
    this.diagnostics.push({
      range,
      message,
      severity: DiagnosticSeverity.Error,
      source: 'swirl'
    });
  }
}
