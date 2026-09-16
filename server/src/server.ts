import {
  createConnection,
  TextDocuments,
  Diagnostic,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  Hover,
  MarkupKind,
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
  TextEdit,
  Range,
  Position,
  DocumentSymbolParams,
  DocumentSymbol,
  DefinitionParams,
  Definition,
  ReferenceParams,
  Location as LspLocation,
  FoldingRangeParams,
  FoldingRange
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { SWIRL_PREDICATES, SWIRL_KEYWORDS } from './swirl-data';
import { Parser } from './parser';
import { SwirlFormatter } from './formatter';
import {
  getDocumentSymbols,
  getDefinition,
  getReferences,
  getFoldingRanges
} from './features';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      hoverProvider: true,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['(', '{', '<', '.', '+', '|', '!', ' ']
      },
      documentSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      foldingRangeProvider: true
    }
  };
});

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

documents.onDidClose((e) => {
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

function validateDocument(document: TextDocument): void {
  const text = document.getText();
  const parser = new Parser(text);
  parser.parseWorkflow();

  const diagnostics: Diagnostic[] = parser.diagnostics.map((d) => ({
    severity: d.severity,
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character }
    },
    message: d.message,
    source: 'swirl'
  }));

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// Document Formatting Provider
connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  const formatter = new SwirlFormatter({
    tabSize: params.options.tabSize,
    insertSpaces: params.options.insertSpaces
  });

  const formatted = formatter.format(text);
  if (formatted === text) {
    return [];
  }

  const fullRange: Range = {
    start: { line: 0, character: 0 },
    end: document.positionAt(text.length)
  };

  return [TextEdit.replace(fullRange, formatted)];
});

// Range Formatting Provider
connection.onDocumentRangeFormatting((params: DocumentRangeFormattingParams): TextEdit[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText(params.range);
  const formatter = new SwirlFormatter({
    tabSize: params.options.tabSize,
    insertSpaces: params.options.insertSpaces
  });

  const formatted = formatter.fallbackFormat(text);
  return [TextEdit.replace(params.range, formatted)];
});

// Document Symbols Provider (Outline & Breadcrumbs)
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return getDocumentSymbols(document.getText());
});

// Definition Provider (F12)
connection.onDefinition((params: DefinitionParams): Definition | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  return getDefinition(document.getText(), params.textDocument.uri, params.position);
});

// References Provider (Shift+F12)
connection.onReferences((params: ReferenceParams): LspLocation[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return getReferences(
    document.getText(),
    params.textDocument.uri,
    params.position,
    params.context.includeDeclaration
  );
});

// Folding Ranges Provider
connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return getFoldingRanges(document.getText());
});

// Hover Provider
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const wordRange = getWordRangeAtPosition(document, params.position);
  if (!wordRange) return null;

  const word = document.getText(wordRange);

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

  return null;
});

// Completion Provider
connection.onCompletion((_params: TextDocumentPositionParams): CompletionItem[] => {
  const completions: CompletionItem[] = [];

  for (const key of Object.keys(SWIRL_PREDICATES)) {
    const doc = SWIRL_PREDICATES[key];
    completions.push({
      label: doc.name,
      kind: CompletionItemKind.Function,
      detail: doc.signature,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `${doc.description}\n\nExample:\n\`\`\`swirl\n${doc.example}\n\`\`\``
      },
      insertText: doc.name
    });
  }

  for (const key of Object.keys(SWIRL_KEYWORDS)) {
    const doc = SWIRL_KEYWORDS[key];
    completions.push({
      label: doc.name,
      kind: CompletionItemKind.Keyword,
      detail: doc.signature,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `${doc.description}\n\nExample:\n\`\`\`swirl\n${doc.example}\n\`\`\``
      },
      insertText: doc.name
    });
  }

  return completions;
});

function getWordRangeAtPosition(document: TextDocument, position: Position): Range | null {
  const line = document.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 }
  });

  const char = position.character;
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
    start: { line: position.line, character: start },
    end: { line: position.line, character: end }
  };
}

documents.listen(connection);
connection.listen();
