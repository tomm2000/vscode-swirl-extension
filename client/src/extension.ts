import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import { simplifySwirl } from './simplifier';

export class SwirlSimplifiedContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'swirl-simplified';

  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  public update(uri: vscode.Uri) {
    this._onDidChange.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const originalPath = uri.path.endsWith('.simplified.swirl')
      ? uri.path.slice(0, -'.simplified.swirl'.length) + '.swirl'
      : uri.path;
    const originalUri = uri.with({ scheme: 'file', path: originalPath });

    // Try finding the document already open in memory (includes unsaved edits)
    const openDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === originalUri.toString()
    );

    let text: string;
    if (openDoc) {
      text = openDoc.getText();
    } else {
      try {
        const fileBytes = await vscode.workspace.fs.readFile(originalUri);
        text = new TextDecoder('utf-8').decode(fileBytes);
      } catch (err: any) {
        return `// Error reading original Swirl file: ${err.message}`;
      }
    }

    return simplifySwirl(text);
  }
}

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
  // Server module path
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  // Debug options for the server
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'swirl' },
      { scheme: SwirlSimplifiedContentProvider.scheme, language: 'swirl' }
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.swirl'),
      configurationSection: 'swirl'
    }
  };

  client = new LanguageClient(
    'swirlLSP',
    'Swirl Language Server',
    serverOptions,
    clientOptions
  );

  // Register command for formatting
  const formatCmd = vscode.commands.registerCommand('swirl.formatDocument', async () => {
    await vscode.commands.executeCommand('editor.action.formatDocument');
  });
  context.subscriptions.push(formatCmd);

  // Register virtual document content provider for simplified view
  const simplifiedProvider = new SwirlSimplifiedContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      SwirlSimplifiedContentProvider.scheme,
      simplifiedProvider
    )
  );

  // Live-update simplified documents when source files are edited
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'swirl' && event.document.uri.scheme === 'file') {
        const originalPath = event.document.uri.path;
        const simplifiedPath = originalPath.endsWith('.swirl')
          ? originalPath.slice(0, -'.swirl'.length) + '.simplified.swirl'
          : originalPath + '.simplified.swirl';
        const simplifiedUri = event.document.uri.with({
          scheme: SwirlSimplifiedContentProvider.scheme,
          path: simplifiedPath
        });
        simplifiedProvider.update(simplifiedUri);
      }
    })
  );

  // Command to open simplified view in a new tab
  const openSimplifiedCmd = vscode.commands.registerCommand(
    'swirl.openSimplifiedView',
    async (resourceUri?: vscode.Uri) => {
      let uri = resourceUri;
      if (!uri && vscode.window.activeTextEditor) {
        uri = vscode.window.activeTextEditor.document.uri;
      }
      if (!uri) {
        vscode.window.showInformationMessage('No active Swirl document to simplify.');
        return;
      }

      const originalPath = uri.path;
      const simplifiedPath = originalPath.endsWith('.swirl')
        ? originalPath.slice(0, -'.swirl'.length) + '.simplified.swirl'
        : originalPath + '.simplified.swirl';

      const simplifiedUri = uri.with({
        scheme: SwirlSimplifiedContentProvider.scheme,
        path: simplifiedPath
      });

      const doc = await vscode.workspace.openTextDocument(simplifiedUri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
        preview: false
      });
    }
  );
  context.subscriptions.push(openSimplifiedCmd);

  // Command to switch back from simplified view to original source
  const openOriginalCmd = vscode.commands.registerCommand(
    'swirl.openOriginalView',
    async (resourceUri?: vscode.Uri) => {
      let uri = resourceUri;
      if (!uri && vscode.window.activeTextEditor) {
        uri = vscode.window.activeTextEditor.document.uri;
      }
      if (!uri || uri.scheme !== SwirlSimplifiedContentProvider.scheme) {
        return;
      }

      const originalPath = uri.path.endsWith('.simplified.swirl')
        ? uri.path.slice(0, -'.simplified.swirl'.length) + '.swirl'
        : uri.path;

      const originalUri = uri.with({
        scheme: 'file',
        path: originalPath
      });

      const doc = await vscode.workspace.openTextDocument(originalUri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
        preview: false
      });
    }
  );
  context.subscriptions.push(openOriginalCmd);

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
