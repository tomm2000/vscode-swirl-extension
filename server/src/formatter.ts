import { Range, TextEdit } from 'vscode-languageserver';
import { Lexer, Token, TokenKind } from './lexer';

export interface SwirlFormatterOptions {
  tabSize?: number;
  insertSpaces?: boolean;
}

export class SwirlFormatter {
  private tabSize: number;
  private indentStr: string;

  constructor(options?: SwirlFormatterOptions) {
    this.tabSize = options?.tabSize ?? 2;
    this.indentStr = options?.insertSpaces === false ? '\t' : ' '.repeat(this.tabSize);
  }

  public format(content: string): string {
    if (!content.trim()) {
      return '';
    }

    try {
      return this.formatTokens(content);
    } catch {
      // Fallback: return original content if unexpected error occurs
      return content;
    }
  }

  public fallbackFormat(content: string): string {
    return this.format(content);
  }

  public formatRange(content: string, range: Range): TextEdit[] {
    const formatted = this.format(content);
    const lines = content.split(/\r?\n/);
    const fullRange: Range = {
      start: { line: 0, character: 0 },
      end: {
        line: Math.max(0, lines.length - 1),
        character: lines.length > 0 ? lines[lines.length - 1].length : 0
      }
    };
    return [TextEdit.replace(fullRange, formatted)];
  }

  private getIndent(lvl: number): string {
    return this.indentStr.repeat(Math.max(0, lvl));
  }

  private formatTokens(content: string): string {
    const tokens = new Lexer(content).tokenize(false);
    if (tokens.length === 0 || (tokens.length === 1 && tokens[0].kind === TokenKind.Eof)) {
      return '';
    }

    // Match parens
    const matchingParen = new Map<number, number>();
    const parenStack: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === TokenKind.OpenParen) {
        parenStack.push(i);
      } else if (t.kind === TokenKind.CloseParen) {
        if (parenStack.length > 0) {
          const openIdx = parenStack.pop()!;
          matchingParen.set(openIdx, i);
          matchingParen.set(i, openIdx);
        }
      }
    }

    // Match locations
    const locationEnd = new Map<number, number>();
    let currentLt = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind === TokenKind.Lt) {
        currentLt = i;
      } else if (tokens[i].kind === TokenKind.Gt && currentLt !== -1) {
        locationEnd.set(currentLt, i);
        locationEnd.set(i, currentLt);
        currentLt = -1;
      }
    }

    const lines: string[] = [];
    let currentLine = '';
    let indent = 0;

    const pushLine = () => {
      lines.push(currentLine.trimEnd());
      currentLine = '';
    };

    const emit = (str: string) => {
      if (currentLine === '' && str.length > 0) {
        currentLine = this.getIndent(indent);
      }
      currentLine += str;
    };

    const ensureBlankLine = () => {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
    };

    let inLocationHeader = false;
    let braceDepth = 0;
    let parenDepth = 0;
    let locationCommaCount = 0;
    let currentLocIsMultiline = false;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === TokenKind.Eof) break;

      const prev = i > 0 ? tokens[i - 1] : null;
      const next = i < tokens.length - 1 ? tokens[i + 1] : null;

      const newlinesBefore = prev ? (t.range.start.line - prev.range.end.line) : 0;
      const isStartOfLineInSource = i === 0 || newlinesBefore > 0;
      const hasBlankBefore = newlinesBefore >= 2;

      // Line Comment
      if (t.kind === TokenKind.LineComment) {
        if (isStartOfLineInSource) {
          if (currentLine !== '') pushLine();
          if (hasBlankBefore) ensureBlankLine();
          currentLine = this.getIndent(indent) + t.value.trim();
          pushLine();
        } else {
          currentLine = currentLine.trimEnd() + '  ' + t.value.trim();
          pushLine();
        }
        continue;
      }

      // Block Comment
      if (t.kind === TokenKind.BlockComment) {
        if (isStartOfLineInSource) {
          if (currentLine !== '') pushLine();
          if (hasBlankBefore) ensureBlankLine();
          currentLine = this.getIndent(indent) + t.value.trim();
          pushLine();
        } else {
          currentLine += ' ' + t.value.trim();
        }
        continue;
      }

      // Location start '<'
      if (t.kind === TokenKind.Lt) {
        if (currentLine !== '') pushLine();
        if (hasBlankBefore) ensureBlankLine();
        indent = 0;
        emit('<');
        inLocationHeader = true;
        locationCommaCount = 0;
        braceDepth = 0;
        parenDepth = 0;
        const endIdx = locationEnd.get(i);
        currentLocIsMultiline = endIdx !== undefined && tokens[endIdx].range.start.line > t.range.start.line;
        continue;
      }

      // Location end '>'
      if (t.kind === TokenKind.Gt && locationEnd.has(i)) {
        inLocationHeader = false;
        if (currentLocIsMultiline) {
          if (currentLine !== '') pushLine();
          indent = 0;
          emit('>');
        } else {
          emit('>');
        }

        if (next && next.kind === TokenKind.Pipe) {
          emit(' |');
          i++; // consume pipe
          pushLine();
          if (currentLocIsMultiline) ensureBlankLine();
        } else {
          pushLine();
        }
        continue;
      }

      // Open brace '{'
      if (t.kind === TokenKind.OpenBrace) {
        braceDepth++;
        emit('{');
        continue;
      }

      // Close brace '}'
      if (t.kind === TokenKind.CloseBrace) {
        braceDepth = Math.max(0, braceDepth - 1);
        emit('}');
        continue;
      }

      // Commas ','
      if (t.kind === TokenKind.Comma) {
        if (inLocationHeader && braceDepth === 0 && parenDepth === 0) {
          locationCommaCount++;
          if (locationCommaCount === 2) {
            inLocationHeader = false;
            if (currentLocIsMultiline) {
              emit(',');
              pushLine();
              indent = 1;
              continue;
            } else {
              emit(', ');
              continue;
            }
          }
        }
        emit(', ');
        continue;
      }

      // Arrow '->'
      if (t.kind === TokenKind.Arrow) {
        emit(' -> ');
        continue;
      }

      // Open bracket '['
      if (t.kind === TokenKind.OpenBracket) {
        emit('[');
        continue;
      }

      // Close bracket ']'
      if (t.kind === TokenKind.CloseBracket) {
        emit(']');
        continue;
      }

      // Open paren '('
      if (t.kind === TokenKind.OpenParen) {
        parenDepth++;
        const closeIdx = matchingParen.get(i);
        const isMultiline = closeIdx !== undefined && tokens[closeIdx].range.start.line > t.range.start.line;
        const isPred = prev && (
          prev.kind === TokenKind.Exec ||
          prev.kind === TokenKind.Send ||
          prev.kind === TokenKind.Recv ||
          prev.kind === TokenKind.Move
        );

        if (isPred || inLocationHeader) {
          emit('(');
          continue;
        }

        if (isMultiline) {
          if (prev && prev.kind === TokenKind.Exclamation) {
            emit('(');
            pushLine();
          } else {
            if (currentLine !== '') pushLine();
            emit('(');
            pushLine();
          }
          indent++;
        } else {
          emit('(');
        }
        continue;
      }

      // Close paren ')'
      if (t.kind === TokenKind.CloseParen) {
        parenDepth = Math.max(0, parenDepth - 1);
        const openIdx = matchingParen.get(i);
        const isMultiline = openIdx !== undefined && t.range.start.line > tokens[openIdx].range.start.line;
        const isPred = openIdx !== undefined && openIdx > 0 && [
          TokenKind.Exec,
          TokenKind.Send,
          TokenKind.Recv,
          TokenKind.Move
        ].includes(tokens[openIdx - 1].kind);

        if (isPred || inLocationHeader) {
          emit(')');
          continue;
        }

        if (isMultiline) {
          indent = Math.max(0, indent - 1);
          if (currentLine !== '') pushLine();
          emit(')');
        } else {
          emit(')');
        }
        continue;
      }

      // Sequential dot '.'
      if (t.kind === TokenKind.Dot) {
        if (isStartOfLineInSource) {
          if (currentLine !== '') pushLine();
          emit('.');
          pushLine();
        } else {
          emit(' .');
          if (next && next.range.start.line > t.range.end.line) {
            pushLine();
          }
        }
        continue;
      }

      // Choice plus '+'
      if (t.kind === TokenKind.Plus) {
        if (isStartOfLineInSource) {
          if (currentLine !== '') pushLine();
          emit('+');
          if (next && next.range.start.line > t.range.end.line) {
            pushLine();
          } else {
            emit(' ');
          }
        } else {
          if (next && next.range.start.line > t.range.end.line) {
            emit(' +');
            pushLine();
          } else {
            emit(' + ');
          }
        }
        continue;
      }

      // Parallel pipe '|'
      if (t.kind === TokenKind.Pipe) {
        if (isStartOfLineInSource) {
          if (currentLine !== '') pushLine();
          emit('| ');
        } else {
          if (next && next.range.start.line > t.range.end.line) {
            emit(' |');
            pushLine();
          } else {
            emit(' | ');
          }
        }
        continue;
      }

      // Replication '!'
      if (t.kind === TokenKind.Exclamation) {
        if (isStartOfLineInSource) {
          if (currentLine !== '') pushLine();
          if (hasBlankBefore) ensureBlankLine();
          emit('!');
        } else {
          emit('!');
        }
        continue;
      }

      // Identifiers, numbers, keywords
      if (!inLocationHeader && isStartOfLineInSource) {
        if (currentLine !== '') pushLine();
        if (hasBlankBefore) ensureBlankLine();
        emit(t.value);
      } else {
        emit(t.value);
      }
    }

    if (currentLine !== '') pushLine();
    return lines.join('\n').trim() + '\n';
  }
}
