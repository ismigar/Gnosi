export interface ReadableFileOptions {
    readonly maxWaitMs?: number;
    readonly onDownloading?: () => void;
    readonly pollMs?: number;
}


function readWithFileReader(blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve();
        };
        reader.onerror = () => {
            reject(reader.error || new Error('read error'));
        };
        reader.readAsArrayBuffer(blob);
    });
}


function readBlob(blob: Blob): Promise<unknown> {
    const candidate: unknown = Reflect.get(blob, 'arrayBuffer');
    if (typeof candidate === 'function') {
        const result: unknown = Reflect.apply(candidate, blob, []);
        return Promise.resolve(result);
    }
    return readWithFileReader(blob);
}


async function tryReadSlice(file: File, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (readable: boolean): void => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            resolve(readable);
        };
        void readBlob(file.slice(0, 4096)).then(
            () => {
                finish(true);
            },
            () => {
                finish(false);
            },
        );
        timer = setTimeout(() => {
            finish(false);
        }, timeoutMs);
    });
}


function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}


export async function assertFileReadable(
    file: File,
    {
        maxWaitMs = 20_000,
        onDownloading,
        pollMs = 2_000,
    }: ReadableFileOptions = {},
): Promise<void> {
    const startedAt = performance.now();
    let announced = false;
    for (;;) {
        if (await tryReadSlice(file, 4_000)) return;
        if (performance.now() - startedAt >= maxWaitMs) {
            throw new Error('unreadable-file');
        }
        if (!announced) {
            announced = true;
            onDownloading?.();
        }
        await wait(pollMs);
    }
}
