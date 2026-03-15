// Mock vscode module for unit testing

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const ProgressLocation = { Notification: 15, SourceControl: 1, Window: 10 };
export const ViewColumn = { One: 1, Two: 2, Beside: -2 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

export class TreeItem {
  label: string;
  collapsibleState: number;
  description?: string;
  tooltip?: any;
  iconPath?: any;
  contextValue?: string;
  command?: any;
  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? 0;
  }
}

export class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) {}
}

export class MarkdownString {
  constructor(public value: string = '') {}
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number,
  ) {}
  get start() { return new Position(this.startLine, this.startChar); }
  get end() { return new Position(this.endLine, this.endChar); }
  get isEmpty() { return this.startLine === this.endLine && this.startChar === this.endChar; }
}

export class Selection extends Range {
  get active() { return new Position(this.endLine, this.endChar); }
  get anchor() { return new Position(this.startLine, this.startChar); }
}

export class Uri {
  private constructor(public scheme: string, public fsPath: string) {}
  static file(path: string) { return new Uri('file', path); }
  static parse(value: string) { return new Uri('https', value); }
  toString() { return `${this.scheme}://${this.fsPath}`; }
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class EventEmitter {
  private _listeners: Function[] = [];
  event = (listener: Function) => {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
  };
  fire(data: unknown) { this._listeners.forEach(l => l(data)); }
  dispose() { this._listeners = []; }
}

class MockTabInputText {
  constructor(public uri: Uri) {}
}

export const TabInputText = MockTabInputText;

export const window = {
  activeTextEditor: undefined as any,
  visibleTextEditors: [] as any[],
  createStatusBarItem: () => ({
    text: '', tooltip: '', command: '', backgroundColor: undefined,
    show: () => {}, hide: () => {}, dispose: () => {},
  }),
  createOutputChannel: () => ({
    appendLine: () => {}, show: () => {}, dispose: () => {},
  }),
  createWebviewPanel: () => ({
    webview: { html: '', options: {}, onDidReceiveMessage: () => ({ dispose: () => {} }), postMessage: () => {} },
    onDidDispose: () => ({ dispose: () => {} }),
    reveal: () => {}, dispose: () => {},
  }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  withProgress: async (_opts: any, task: Function) => task({ report: () => {} }),
  tabGroups: { all: [] },
};

export const workspace = {
  name: 'test-workspace',
  workspaceFolders: [{ uri: Uri.file('/test'), name: 'test', index: 0 }],
  getConfiguration: (_section?: string) => ({
    get: (key: string, defaultValue?: any) => defaultValue,
    update: async () => {},
  }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  findFiles: async () => [] as Uri[],
  openTextDocument: async (opts: any) => ({
    getText: () => opts?.content ?? '',
    lineCount: 1,
    uri: Uri.file('/test/file.ts'),
    languageId: opts?.language ?? 'typescript',
    lineAt: () => ({ text: '' }),
  }),
  textDocuments: [],
  asRelativePath: (uri: any) => typeof uri === 'string' ? uri : uri?.fsPath ?? 'file.ts',
};

export const languages = {
  getDiagnostics: (uri?: any) => uri ? [] : [],
  registerInlineCompletionItemProvider: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: (_cmd: string, _handler: Function) => ({ dispose: () => {} }),
  executeCommand: async () => {},
};

export const env = {
  clipboard: { writeText: async () => {}, readText: async () => '' },
  openExternal: async () => false,
};

export class InlineCompletionItem {
  constructor(public insertText: string, public range: Range) {}
}

export class InlineCompletionList {
  constructor(public items: InlineCompletionItem[]) {}
}
