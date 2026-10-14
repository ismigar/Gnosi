interface OfflineBuildConfig {
    readonly root: string;
    readonly publicDir: string;
    readonly base: string;
    readonly build: { readonly outDir: string; readonly assetsDir: string };
}

export declare function offlineShellPlugin(): {
    readonly name: string;
    readonly apply: 'build';
    configResolved(config: OfflineBuildConfig): void;
    writeBundle(): void;
};
