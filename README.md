# Swirl Intermediate Language Support for VS Code

Rich language support for the **Swirl intermediate language** (`.swirl`), featuring syntax highlighting, document formatting, live diagnostics, hover documentation, snippets, and language server capabilities.

## Features

- **Basic Code Coloring & Syntax Highlighting**:
  - Full TextMate grammar for `.swirl` files.
  - Highlights core Swirl predicates: `exec`, `send`, `recv`, `move`.
  - Highlights language constants and keywords: `eof`, `in`, `0`.
  - Highlights operators: dataflow arrow `->`, sequence `.`, parallel `|`, choice `+` (including indexed choice `+[guard]`), and replication `!`.
  - Highlights bracket delimiters: location brackets `<...>`, set braces `{...}`, tuples `(...)`, and index brackets `[...]`.
  - Highlights single-line comments `//`, multi-line block comments `/* ... */`, and compiler hint directives (`// @compiler_hint_start`, `// @compiler_hint_end`).

- **Code Formatting**:
  - Full document formatting (`editor.action.formatDocument`, <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> / <kbd>⇧</kbd><kbd>⌥</kbd><kbd>F</kbd>) or on save.
  - Command palette command: **Swirl: Format Document**.
  - Range formatting support.
  - Automatically cleans up and standardizes indentation, spacing around arrows (`->`), commas, and delimiters.
  - Formats multiline locations, sequential chains, parallel branches, replication blocks, and choice blocks cleanly while preserving all comments and compiler hint pragmas.
  - Fallback resilient formatter for unclosed or work-in-progress code.

- **Live Syntax Diagnostics**:
  - Real-time syntax validation reporting errors directly in the VS Code Problems panel.

- **Hover Information**:
  - Hover over `exec`, `send`, `recv`, `move`, `eof`, and `0` to view signatures, descriptions, and examples.

- **Snippets & Autocompletions**:
  - Snippets for `loc` (location definition), `exec`, `send`, `recv`, `move`, `repl` (replication), and `choice`.

## Project Structure

This extension follows the client/server Language Server Protocol (LSP) architecture:

```
vscode-swirl-extension/
├── client/                     # VS Code language client
│   └── src/extension.ts
├── server/                     # Language server
│   └── src/
│       ├── lexer.ts            # Tokenizer
│       ├── parser.ts           # AST parser & syntax diagnostics
│       ├── formatter.ts        # AST & token-guided code formatter
│       ├── swirl-data.ts       # Predicates & keyword documentation
│       └── server.ts           # LSP server entrypoint
├── syntaxes/
│   └── swirl.tmLanguage.json   # TextMate syntax definition
├── snippets/
│   └── swirl.json              # Code snippets
├── language-configuration.json # Brackets, comments, and auto-closing rules
└── package.json
```

## Getting Started & Development

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Compile TypeScript:
   ```bash
   pnpm run compile
   ```

3. Run the automated test suite:
   ```bash
   pnpm test
   ```

4. Build and Package as `.vsix`:
   ```bash
   pnpm run package
   ```
   This compiles, bundles both client and server into standalone CJS bundles with `esbuild`, and packages the extension into `vscode-swirl-<version>.vsix`.

   To install the generated VSIX directly in VS Code / Cursor:
   ```bash
   code --install-extension vscode-swirl-0.1.0.vsix
   ```

5. Debug the extension:
   - Open this folder in VS Code.
   - Press <kbd>F5</kbd> (Launch Client) to start the Extension Development Host window.
   - In the new window, open any `.swirl` file to test syntax highlighting, formatting, and diagnostics.
