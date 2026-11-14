export type UpdateState =
  | { status: 'unsupported' | 'store' | 'idle' | 'checking' | 'current' | 'error' }
  | { status: 'downloading'; version: string; percent?: number }
  | { status: 'ready'; version: string; installFailed?: true }
  | { status: 'installing'; version: string };
