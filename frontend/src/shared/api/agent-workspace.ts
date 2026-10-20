import { transportFetch } from './transports';

export interface WorkspaceIdentity { readonly agent_id: string; readonly session_id: string }
export interface WorkspaceRecord { readonly [key: string]: unknown }

export async function workspaceRequest<T>(path: string, identity: WorkspaceIdentity,
  body?: Readonly<Record<string, unknown>>, method = body ? 'POST' : 'GET', signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams(identity as unknown as Record<string, string>);
  const response = await transportFetch(`/api/workspace/${path}${body ? '' : `?${query}`}`, {
    method, signal, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify({ ...body, ...identity }) : undefined,
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(`workspace_http_${String(response.status)}`);
  return data as T;
}

export async function checkedWorkspaceDownload(identity: WorkspaceIdentity, grantId: string, path: string): Promise<void> {
  const query = new URLSearchParams({ ...identity, grant_id: grantId, path });
  const response = await transportFetch(`/api/workspace/download?${query}`);
  if (!response.ok) throw new Error(`workspace_http_${String(response.status)}`);
  const content = await response.arrayBuffer();
  const hash = await sha256(content);
  if (response.headers.get('X-Content-SHA256') !== hash) throw new Error('workspace_integrity_failed');
  const url = URL.createObjectURL(new Blob([content]));
  const link = document.createElement('a'); link.href = url; link.download = path.split('/').at(-1) || 'download';
  link.click(); setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function downloadWorkspaceArtifact(identity: WorkspaceIdentity, runId: string, name: string, size: number, digest: string): Promise<void> {
  const query = new URLSearchParams(identity as unknown as Record<string, string>);
  const response = await transportFetch(`/api/workspace/analysis/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}?${query}`);
  if (!response.ok) throw new Error(`workspace_http_${String(response.status)}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== size || await sha256(bytes) !== digest) throw new Error('workspace_integrity_failed');
  const url = URL.createObjectURL(new Blob([bytes])); const link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}

export async function uploadWorkspaceFile(identity: WorkspaceIdentity, grantId: string, path: string, file: File): Promise<WorkspaceRecord> {
  if (file.size > 15_000_000) throw new Error('workspace_file_too_large');
  const bytes = await file.arrayBuffer();
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return workspaceRequest('transfers', identity, { grant_id: grantId, path, content_base64: btoa(binary),
    size: bytes.byteLength, sha256: await sha256(bytes), request_id: crypto.randomUUID() });
}

export async function importAnalysisFile(identity: WorkspaceIdentity, file: File): Promise<WorkspaceRecord> {
  if (file.size > 15_000_000) throw new Error('workspace_file_too_large');
  const bytes = await file.arrayBuffer(); let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return workspaceRequest('analysis-inputs', identity, { name: file.name, size: bytes.byteLength,
    sha256: await sha256(bytes), content_base64: btoa(binary), request_id: crypto.randomUUID() });
}
