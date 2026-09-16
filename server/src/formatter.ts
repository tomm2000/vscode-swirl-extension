import { Parser, WorkflowNode, LocationNode, TraceNode, PredicateNode, DataSetNode, FlowNode, LocationSetNode, DataRefNode, CommentNode } from './parser';
import { Lexer, Token, TokenKind } from './lexer';

export interface FormattingOptions {
  tabSize?: number;
  insertSpaces?: boolean;
}

export class SwirlFormatter {
  private tabSize: number;
  private indentStr: string;

  constructor(options?: FormattingOptions) {
    this.tabSize = options?.tabSize ?? 2;
    this.indentStr = options?.insertSpaces !== false ? ' '.repeat(this.tabSize) : '\t';
  }

  public format(input: string): string {
    const parser = new Parser(input);
    const ast = parser.parseWorkflow();

    // If there are fatal syntax errors, use resilient token-based fallback formatting
    if (parser.diagnostics.length > 0) {
      return this.fallbackFormat(input);
    }

    try {
      return this.formatWorkflow(ast, parser.comments, input);
    } catch {
      return this.fallbackFormat(input);
    }
  }

  private getIndent(level: number): string {
    return this.indentStr.repeat(level);
  }

  private formatDataRef(node: DataRefNode): string {
    return node.index ? `${node.name}[${node.index}]` : node.name;
  }

  private formatDataSet(node: DataSetNode): string {
    if (node.pairs.length === 0) {
      return '{}';
    }
    const pairsStr = node.pairs.map((p) => `(${p.first}, ${p.second})`).join(', ');
    return `{${pairsStr}}`;
  }

  private formatFlow(node: FlowNode): string {
    return `${this.formatDataSet(node.from)} -> ${this.formatDataSet(node.to)}`;
  }

  private formatLocationSet(node: LocationSetNode): string {
    if (node.isSet) {
      return `{${node.locations.join(', ')}}`;
    }
    return node.locations[0] || '';
  }

  private formatPredicate(node: PredicateNode): string {
    if (node.kind === 'exec') {
      return `exec(${node.step}, ${this.formatFlow(node.flow)}, ${this.formatLocationSet(node.mapping)})`;
    }
    const dataStr = this.formatDataRef(node.data);
    const dstStr = this.formatLocationSet(node.dst);
    return `${node.kind}(${dataStr} -> ${node.port}, ${node.src}, ${dstStr})`;
  }

  public inlineTrace(node: TraceNode): string {
    switch (node.kind) {
      case 'traceZero':
        return '0';
      case 'tracePred':
        return this.formatPredicate(node.pred);
      case 'traceRepl':
        return `!${this.inlineTrace(node.subTrace)}`;
      case 'traceParen':
        return `(${this.inlineTrace(node.inner)})`;
      case 'traceOp': {
        const guardStr = node.guard ? `[${node.guard}]` : '';
        const opStr = node.op === '.' ? '.' : ` ${node.op}${guardStr} `;
        return `${this.inlineTrace(node.left)}${opStr}${this.inlineTrace(node.right)}`;
      }
    }
  }

  private formatTrace(node: TraceNode, indentLevel: number, commentsManager: CommentsManager): string[] {
    const curIndent = this.getIndent(indentLevel);

    switch (node.kind) {
      case 'traceZero':
        return [`${curIndent}0`];

      case 'tracePred':
        return [`${curIndent}${this.formatPredicate(node.pred)}`];

      case 'traceRepl': {
        if (node.subTrace.kind === 'traceParen') {
          const innerLines = this.formatTrace(node.subTrace.inner, indentLevel + 1, commentsManager);
          return [
            `${curIndent}!(`,
            ...innerLines,
            `${curIndent})`
          ];
        }
        const subLines = this.formatTrace(node.subTrace, indentLevel, commentsManager);
        if (subLines.length === 1) {
          return [`${curIndent}!${subLines[0].trimStart()}`];
        }
        return [
          `${curIndent}!`,
          ...subLines
        ];
      }

      case 'traceParen': {
        const inline = this.inlineTrace(node.inner);
        if (inline.length <= 60 && !inline.includes('\n')) {
          return [`${curIndent}(${inline})`];
        }
        const innerLines = this.formatTrace(node.inner, indentLevel + 1, commentsManager);
        return [
          `${curIndent}(`,
          ...innerLines,
          `${curIndent})`
        ];
      }

      case 'traceOp': {
        if (node.op === '.') {
          const seqItems = this.flattenSequence(node);
          const lines: string[] = [];

          for (let i = 0; i < seqItems.length; i++) {
            const item = seqItems[i];
            const isLast = i === seqItems.length - 1;

            // Check if item is a block (paren or repl) or simple pred
            const isBlock = item.kind === 'traceParen' || item.kind === 'traceRepl';
            const itemLines = this.formatTrace(item, indentLevel, commentsManager);

            if (isBlock) {
              lines.push(...itemLines);
              if (!isLast) {
                lines.push(`${curIndent}.`);
              }
            } else {
              if (itemLines.length === 1) {
                lines.push(isLast ? itemLines[0] : `${itemLines[0]} .`);
              } else {
                lines.push(...itemLines);
                if (!isLast) {
                  lines.push(`${curIndent}.`);
                }
              }
            }
          }
          return lines;
        }

        if (node.op === '|') {
          const parItems = this.flattenParallel(node);
          const lines: string[] = [];

          for (let i = 0; i < parItems.length; i++) {
            const item = parItems[i];
            const isLast = i === parItems.length - 1;
            const itemLines = this.formatTrace(item, indentLevel, commentsManager);

            if (itemLines.length === 1) {
              lines.push(isLast ? itemLines[0] : `${itemLines[0]} |`);
            } else {
              if (!isLast) {
                itemLines[itemLines.length - 1] += ' |';
              }
              lines.push(...itemLines);
            }
          }
          return lines;
        }

        if (node.op === '+') {
          const choiceItems = this.flattenChoice(node);
          const lines: string[] = [];

          for (let i = 0; i < choiceItems.length; i++) {
            const item = choiceItems[i];
            const isLast = i === choiceItems.length - 1;
            const itemLines = this.formatTrace(item.node, indentLevel, commentsManager);
            lines.push(...itemLines);

            if (!isLast) {
              const guardStr = item.guard ? `[${item.guard}]` : '';
              lines.push(`${curIndent}+${guardStr}`);
            }
          }
          return lines;
        }

        return [`${curIndent}${this.inlineTrace(node)}`];
      }
    }
  }

  private flattenSequence(node: TraceNode): TraceNode[] {
    const list: TraceNode[] = [];
    const traverse = (n: TraceNode) => {
      if (n.kind === 'traceOp' && n.op === '.') {
        traverse(n.left);
        traverse(n.right);
      } else {
        list.push(n);
      }
    };
    traverse(node);
    return list;
  }

  private flattenParallel(node: TraceNode): TraceNode[] {
    const list: TraceNode[] = [];
    const traverse = (n: TraceNode) => {
      if (n.kind === 'traceOp' && n.op === '|') {
        traverse(n.left);
        traverse(n.right);
      } else {
        list.push(n);
      }
    };
    traverse(node);
    return list;
  }

  private flattenChoice(node: TraceNode): { node: TraceNode; guard?: string }[] {
    const list: { node: TraceNode; guard?: string }[] = [];
    const traverse = (n: TraceNode) => {
      if (n.kind === 'traceOp' && n.op === '+') {
        traverse(n.left);
        list.push({ node: n.right, guard: n.guard });
      } else {
        list.push({ node: n });
      }
    };
    traverse(node);
    return list;
  }

  private formatWorkflow(workflow: WorkflowNode, comments: CommentNode[], originalInput: string): string {
    const commentsManager = new CommentsManager(comments);
    const result: string[] = [];

    // Header comments
    const firstLocLine = workflow.locations[0]?.range.start.line ?? Number.MAX_SAFE_INTEGER;
    const headerComments = commentsManager.consumeBeforeLine(firstLocLine);
    for (const c of headerComments) {
      result.push(c.text);
    }
    if (headerComments.length > 0 && workflow.locations.length > 0) {
      result.push('');
    }

    for (let i = 0; i < workflow.locations.length; i++) {
      const loc = workflow.locations[i];
      const isLast = i === workflow.locations.length - 1;

      // Comments before this location
      const locComments = commentsManager.consumeBeforeLine(loc.range.start.line);
      for (const c of locComments) {
        result.push(c.text);
      }

      const formattedLoc = this.formatLocation(loc, commentsManager);
      const suffix = isLast ? '>' : '> |';

      if (formattedLoc.isSingleLine) {
        result.push(`${formattedLoc.lines[0]}${suffix}`);
      } else {
        result.push(formattedLoc.header);
        result.push(...formattedLoc.lines);
        result.push(suffix);
      }

      if (!isLast) {
        result.push('');
      }
    }

    // Trailing comments
    const trailingComments = commentsManager.consumeRemaining();
    if (trailingComments.length > 0) {
      result.push('');
      for (const c of trailingComments) {
        result.push(c.text);
      }
    }

    return result.join('\n').trim() + '\n';
  }

  private formatLocation(
    loc: LocationNode,
    commentsManager: CommentsManager
  ): { isSingleLine: boolean; header: string; lines: string[] } {
    const dsStr = this.formatDataSet(loc.dataset);
    const inline = this.inlineTrace(loc.trace);

    // Check if there are internal comments within this location
    const hasInternalComments = commentsManager.peekHasCommentsInRange(loc.range.start.line, loc.range.end.line);

    // If short enough, no internal comments, and single-line trace
    if (!hasInternalComments && inline.length <= 80 && !inline.includes('\n')) {
      return {
        isSingleLine: true,
        header: '',
        lines: [`<${loc.name}, ${dsStr}, ${inline}`]
      };
    }

    // Multiline location
    const header = `<${loc.name}, ${dsStr},`;
    const traceLines = this.formatTrace(loc.trace, 1, commentsManager);

    return {
      isSingleLine: false,
      header,
      lines: traceLines
    };
  }

  /**
   * Resilient token-based fallback formatter that formats incomplete or partially invalid Swirl files.
   */
  public fallbackFormat(input: string): string {
    const lexer = new Lexer(input);
    const tokens = lexer.tokenize(false);

    let indent = 0;
    let result = '';
    let atStartOfLine = true;
    let prevToken: Token | null = null;

    const getIndent = () => this.getIndent(indent);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind === TokenKind.Eof) break;

      if (token.kind === TokenKind.LineComment) {
        if (!atStartOfLine) {
          result += ' ';
        } else {
          result += getIndent();
        }
        result += token.value.trim() + '\n';
        atStartOfLine = true;
        prevToken = token;
        continue;
      }

      if (token.kind === TokenKind.BlockComment) {
        if (atStartOfLine) result += getIndent();
        result += token.value;
        atStartOfLine = false;
        prevToken = token;
        continue;
      }

      // Closing delimiters decrease indent
      if (token.kind === TokenKind.CloseParen || token.kind === TokenKind.CloseBrace || token.kind === TokenKind.Gt) {
        indent = Math.max(0, indent - 1);
      }

      if (atStartOfLine) {
        result += getIndent();
        atStartOfLine = false;
      }

      // Spacing rules
      if (prevToken) {
        const needsSpace =
          (token.kind === TokenKind.Arrow || prevToken.kind === TokenKind.Arrow) ||
          (token.kind === TokenKind.Plus || prevToken.kind === TokenKind.Plus) ||
          (token.kind === TokenKind.Pipe && prevToken.kind !== TokenKind.Gt) ||
          (prevToken.kind === TokenKind.Comma) ||
          (prevToken.kind === TokenKind.Dot && token.kind !== TokenKind.Dot) ||
          (prevToken.kind === TokenKind.CloseParen && token.kind === TokenKind.OpenParen) ||
          (prevToken.kind === TokenKind.CloseBrace && token.kind === TokenKind.OpenBrace) ||
          (prevToken.kind === TokenKind.Identifier && token.kind === TokenKind.Identifier) ||
          (prevToken.kind === TokenKind.Identifier && token.kind === TokenKind.OpenBrace);

        if (needsSpace) {
          result += ' ';
        }
      }

      result += token.value;

      // Opening delimiters increase indent
      if (token.kind === TokenKind.OpenParen || token.kind === TokenKind.OpenBrace || token.kind === TokenKind.Lt) {
        indent++;
      }

      // Line breaks after certain constructs
      if (token.kind === TokenKind.Pipe && prevToken?.kind === TokenKind.Gt) {
        result += '\n\n';
        atStartOfLine = true;
      }

      prevToken = token;
    }

    return result.trim() + '\n';
  }
}

class CommentsManager {
  private comments: CommentNode[];
  private index = 0;

  constructor(comments: CommentNode[]) {
    this.comments = comments;
  }

  public consumeBeforeLine(line: number): CommentNode[] {
    const result: CommentNode[] = [];
    while (this.index < this.comments.length && this.comments[this.index].range.start.line < line) {
      result.push(this.comments[this.index++]);
    }
    return result;
  }

  public peekHasCommentsInRange(startLine: number, endLine: number): boolean {
    for (let i = this.index; i < this.comments.length; i++) {
      const line = this.comments[i].range.start.line;
      if (line >= startLine && line <= endLine) {
        return true;
      }
      if (line > endLine) break;
    }
    return false;
  }

  public consumeRemaining(): CommentNode[] {
    const result = this.comments.slice(this.index);
    this.index = this.comments.length;
    return result;
  }
}
