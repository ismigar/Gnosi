/** Stable API v2 surface exposed only inside the opaque-origin UI sandbox. */
export interface SandboxContribution {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly icon?: unknown;
  readonly height?: unknown;
  readonly run?: unknown;
  readonly render?: unknown;
}

export interface SandboxApi {
  registerCommand(command?: SandboxContribution | null): void;
  registerView(view?: SandboxContribution | null): void;
  registerSidebarPanel(panel?: SandboxContribution | null): void;
  registerSettingsPanel(panel?: SandboxContribution | null): void;
  readonly vault: {
    readPage(id: unknown): Promise<unknown>;
    writePage(id: unknown, patch?: unknown): Promise<unknown>;
    createPage(options?: Record<string, unknown> | null): Promise<unknown>;
    queryDB(tableId: unknown, options?: { readonly limit?: unknown } | null): Promise<unknown>;
    listTables(): Promise<unknown>;
  };
  readonly settings: {
    get(): Promise<unknown>;
    set(settings: unknown): Promise<unknown>;
  };
  readonly fetch: (url: unknown, options?: Record<string, unknown> | null) => Promise<unknown>;
  log(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

/** Native capabilities of this iframe, never a reference to the parent DOM. */
export interface SandboxMessage {
  readonly data: unknown;
  readonly source: unknown;
}

export interface SandboxScope {
  readonly parent: {
    postMessage(message: Readonly<Record<string, unknown>>, targetOrigin: string): void;
  };
  addEventListener(type: 'message', listener: (event: SandboxMessage) => void): void;
  gnosi?: SandboxApi;
}
