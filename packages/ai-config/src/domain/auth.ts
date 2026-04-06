export type AuthMode = 'api_key' | 'oauth' | 'secret_ref';

export type SecretRefType = 'env' | 'file' | 'exec';

export interface SecretRef {
  type: SecretRefType;
  name?: string;
  path?: string;
  command?: string;
}

export interface AuthSource {
  mode: AuthMode;
  value?: string;
  token?: string;
  ref?: SecretRef | string;
  from?: 'config' | 'env' | 'profile' | 'ref';
  redacted?: boolean;
}
