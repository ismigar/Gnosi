import { transportFetch } from '../../../shared/api/transports';


export type JsonRecord = Record<string, unknown>;


export class AIResourceRequestError extends Error {
    readonly payload: unknown;
    readonly status: number;

    constructor(message: string, status: number, payload: unknown) {
        super(message);
        this.name = 'AIResourceRequestError';
        this.status = status;
        this.payload = payload;
    }
}


export const isJsonRecord = (value: unknown): value is JsonRecord => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);


export const jsonRecords = (payload: unknown, key: string): JsonRecord[] => {
    if (!isJsonRecord(payload)) return [];
    const rows = payload[key];
    if (!Array.isArray(rows)) return [];
    return rows.filter(isJsonRecord);
};


export const jsonString = (value: unknown): string | undefined => (
    typeof value === 'string' ? value : undefined
);


const responseMessage = (
    payload: unknown,
    status: number,
): string => {
    if (!isJsonRecord(payload)) return `HTTP ${status.toString()}`;
    const detail = payload.detail;
    if (typeof detail === 'string') return detail;
    if (isJsonRecord(detail)) {
        const detailMessage = jsonString(detail.message);
        if (detailMessage) return detailMessage;
    }
    return jsonString(payload.message) ?? `HTTP ${status.toString()}`;
};


export const requestAIResource = async (
    url: string,
    options: RequestInit = {},
): Promise<unknown> => {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await transportFetch(url, { ...options, headers });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        throw new AIResourceRequestError(
            responseMessage(payload, response.status),
            response.status,
            payload,
        );
    }
    return payload;
};


export const affectedAgentsFromError = (error: unknown): JsonRecord[] => {
    if (!(error instanceof AIResourceRequestError)) return [];
    if (!isJsonRecord(error.payload)) return [];
    const detail = isJsonRecord(error.payload.detail)
        ? error.payload.detail
        : undefined;
    const rows = detail?.affected_agents
        ?? error.payload.affected_agents
        ?? detail?.agents
        ?? error.payload.agents;
    return Array.isArray(rows) ? rows.filter(isJsonRecord) : [];
};
