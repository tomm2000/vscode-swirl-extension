export enum TokenKind {
  Lt = '<',
  Gt = '>',
  OpenBrace = '{',
  CloseBrace = '}',
  OpenParen = '(',
  CloseParen = ')',
  OpenBracket = '[',
  CloseBracket = ']',
  Comma = ',',
  Arrow = '->',
  Dot = '.',
  Pipe = '|',
  Plus = '+',
  Exclamation = '!',
  
  Exec = 'exec',
  Send = 'send',
  Recv = 'recv',
  Move = 'move',
  EofKeyword = 'eof',
  InKeyword = 'in',
  Zero = '0',

  Identifier = 'Identifier',
  Number = 'Number',
  LineComment = 'LineComment',
  BlockComment = 'BlockComment',
  Whitespace = 'Whitespace',
  Unknown = 'Unknown',
  Eof = 'EOF'
}

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Token {
  kind: TokenKind;
  value: string;
  range: Range;
  offset: number;
}

export class Lexer {
  private input: string;
  private pos = 0;
  private line = 0;
  private character = 0;

  constructor(input: string) {
    this.input = input;
  }

  public tokenize(includeWhitespace = false): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      const token = this.nextToken();
      if (token.kind === TokenKind.Whitespace && !includeWhitespace) {
        continue;
      }
      tokens.push(token);
    }
    tokens.push({
      kind: TokenKind.Eof,
      value: '',
      range: {
        start: { line: this.line, character: this.character },
        end: { line: this.line, character: this.character }
      },
      offset: this.pos
    });
    return tokens;
  }

  private peek(offset = 0): string {
    const idx = this.pos + offset;
    return idx < this.input.length ? this.input[idx] : '';
  }

  private advance(): string {
    const ch = this.input[this.pos++];
    if (ch === '\n') {
      this.line++;
      this.character = 0;
    } else {
      this.character++;
    }
    return ch;
  }

  private nextToken(): Token {
    const startLine = this.line;
    const startCharacter = this.character;
    const startOffset = this.pos;

    const ch = this.peek();

    // Whitespace
    if (/\s/.test(ch)) {
      let value = '';
      while (this.pos < this.input.length && /\s/.test(this.peek())) {
        value += this.advance();
      }
      return {
        kind: TokenKind.Whitespace,
        value,
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    // Line or block comment
    if (ch === '/' && this.peek(1) === '/') {
      let value = '';
      while (this.pos < this.input.length && this.peek() !== '\n' && this.peek() !== '\r') {
        value += this.advance();
      }
      return {
        kind: TokenKind.LineComment,
        value,
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    if (ch === '/' && this.peek(1) === '*') {
      let value = this.advance() + this.advance();
      while (this.pos < this.input.length) {
        if (this.peek() === '*' && this.peek(1) === '/') {
          value += this.advance() + this.advance();
          break;
        }
        value += this.advance();
      }
      return {
        kind: TokenKind.BlockComment,
        value,
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    // Two-character operators: ->
    if (ch === '-' && this.peek(1) === '>') {
      this.advance();
      this.advance();
      return {
        kind: TokenKind.Arrow,
        value: '->',
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    // Single-character tokens
    const singleTokens: Record<string, TokenKind> = {
      '<': TokenKind.Lt,
      '>': TokenKind.Gt,
      '{': TokenKind.OpenBrace,
      '}': TokenKind.CloseBrace,
      '(': TokenKind.OpenParen,
      ')': TokenKind.CloseParen,
      '[': TokenKind.OpenBracket,
      ']': TokenKind.CloseBracket,
      ',': TokenKind.Comma,
      '.': TokenKind.Dot,
      '|': TokenKind.Pipe,
      '+': TokenKind.Plus,
      '!': TokenKind.Exclamation
    };

    if (singleTokens[ch]) {
      this.advance();
      return {
        kind: singleTokens[ch],
        value: ch,
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    // Zero literal
    if (ch === '0' && !/[a-zA-Z0-9_]/.test(this.peek(1))) {
      this.advance();
      return {
        kind: TokenKind.Zero,
        value: '0',
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let value = '';
      while (this.pos < this.input.length && /[0-9]/.test(this.peek())) {
        value += this.advance();
      }
      return {
        kind: TokenKind.Number,
        value,
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let value = '';
      while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.peek())) {
        value += this.advance();
      }

      let kind = TokenKind.Identifier;
      switch (value) {
        case 'exec':
          kind = TokenKind.Exec;
          break;
        case 'send':
          kind = TokenKind.Send;
          break;
        case 'recv':
          kind = TokenKind.Recv;
          break;
        case 'move':
          kind = TokenKind.Move;
          break;
        case 'eof':
          kind = TokenKind.EofKeyword;
          break;
        case 'in':
          kind = TokenKind.InKeyword;
          break;
      }

      return {
        kind,
        value,
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: this.line, character: this.character }
        },
        offset: startOffset
      };
    }

    // Unknown single character
    const unknownVal = this.advance();
    return {
      kind: TokenKind.Unknown,
      value: unknownVal,
      range: {
        start: { line: startLine, character: startCharacter },
        end: { line: this.line, character: this.character }
      },
      offset: startOffset
    };
  }
}
