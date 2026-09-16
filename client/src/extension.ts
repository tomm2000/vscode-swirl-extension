import * as path from 'path';
import { workspace, ExtensionContext, commands } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
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
    documentSelector: [{ scheme: 'file', language: 'swirl' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.swirl')
    }
  };

  client = new LanguageClient(
    'swirlLSP',
    'Swirl Language Server',
    serverOptions,
    clientOptions
  );

  // Register command for formatting
  const formatCmd = commands.registerCommand('swirl.formatDocument', async () => {
    await commands.executeCommand('editor.action.formatDocument');
  });
  context.subscriptions.push(formatCmd);

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
