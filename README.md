# Swirl Intermediate Language Support for VS Code

A comprehensive Visual Studio Code extension providing IDE support for the **Swirl** intermediate workflow language (`.swirl`), featuring syntax highlighting, document formatting, semantic diagnostics, outline navigation, definition jumps, reference tracking, code folding, and Rust-analyzer style parameter inlay hints.

## Features

### 1. Syntax Highlighting
- Full TextMate grammar for `.swirl` files.
- Keywords and predicates: `exec`, `send`, `recv`, `move`, `eof`, `0`.
- Data references (`d1`, `d[i]`), ports, location sets (`{l0, l1}`), and guards (`+[guard]`).
- Single-line comments (`//`), block comments (`/* ... */`), and compiler hint pragmas (`// @compiler_hint_start`, `// @compiler_hint_end`).

### 2. Rust-Style Parameter Inlay Hints
- **Function/Predicate Parameter Tags**: Automatically inserts inline tags before arguments in core Swirl predicates (similar to `rust-analyzer` parameter hints):
  - `exec(step: s1, in: {(p1, d1)} -> out: {(p2, d2)}, mapping: {l0})`
  - `send(data: d1 -> port: p1, src: l0, dst: l1)`
  - `recv(data: p2 -> port: d2, src: l0, dst: l1)`
  - `move(data: d3 -> port: p3, src: l0, dst: {l1, l2})`
- **Configurable Styles & Tooltips**:
  - `swirl.inlayHints.parameterNames.enabled` (default `true`): Toggle parameter inlay hints.
  - `swirl.inlayHints.execFlowStyle`: Choose between `'inOut'` (`in:` & `out:`) or `'flow'` (`flow:`).
  - `swirl.inlayHints.locationTags.enabled` (default `false`): Optionally displays `loc:`, `data:`, and `trace:` in location declarations `<l0, ...>`.
  - Hovering over any parameter inlay hint displays an informative tooltip describing that argument's role.

### 3. Document Formatter
- Available via <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> (or `Format Document`).
- Automatically cleans up and standardizes indentation, spacing around arrows (`->`), commas, and delimiters.
- Line-buffered token-stream engine guarantees **zero comment displacement**: all comments and `@compiler_hint` pragmas stay anchored at their exact statement boundaries.
- 100% idempotent formatting.

### 4. Static Analysis & Semantic Diagnostics (Tier 2)
- **Missing Location Detection**: Identifies references to undeclared locations in `send`, `recv`, `move`, and `exec` mapping targets.
- **Location Context Mismatches**: Warns when a `send` or `move` in `<lX>` specifies a conflicting source (`src != lX`), or when `recv` in `<lX>` targets a different destination.
- **Channel Pairing & Deadlock Detection**: Analyzes multi-location workflows to detect orphaned communications where a `send` has no matching `recv` on the peer location (or vice versa).
- **Compiler Hint Integrity**: Verifies that every `// @compiler_hint_start` has a matching `// @compiler_hint_end`.
- **Duplicate Location Detection**: Flags duplicate declarations of the same location.

### 5. Navigation & Structure (Tier 1)
- **Document Outline & Breadcrumbs**: Lists all locations, nested execution steps (`exec`), communication events (`send`/`recv`/`move`), and scatter/gather compiler regions in the Outline pane and top breadcrumb bar. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> to jump to any symbol.
- **Go to Definition (<kbd>F12</kbd> / <kbd>Cmd</kbd>+Click)**: Jump from any location or step reference directly to its definition.
- **Find References (<kbd>Shift</kbd>+<kbd>F12</kbd>)**: View all usages and communication channels referencing a location, step, or port.
- **Code Folding**: Fold entire location blocks, scatter/gather hint regions, replication blocks `!(...)`, and multi-line delimiter pairs.

### 6. Rich Tooltips & Hover Documentation (Tier 2)
- **Compiler Hint Badges**: Hovering over `// @compiler_hint_start` or `// @compiler_hint_end` renders a structured Markdown card with region, phase, method, controller, workers, and port schemas.
- **Location Summaries**: Hovering over `<l0>` or location names shows initial datasets, executed steps, and connected communication targets.
- **Workflow Step Cards**: Hovering over step names (e.g. `s_unzip_step`) displays input/output flows and mapped target locations.
- **Built-in Language Reference**: Hovering over `exec`, `send`, `recv`, `move`, `eof`, and `0` reveals full signatures, semantics, and code examples.

### 7. Snippets & Autocompletions
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
│       ├── analyzer.ts         # Static semantic analyzer & channel pairing
│       ├── formatter.ts        # Line-buffered token stream code formatter
│       ├── features.ts         # Symbols, definition, references, folding
│       ├── hover.ts            # Rich hover cards & doc tooltips
│       ├── inlay-hints.ts      # Parameter name inlay hints (Rust-analyzer style)
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
