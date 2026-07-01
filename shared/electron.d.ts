export {};

declare global {
  interface BackendConnection {
    port: number;
    token: string;
    httpUrl: string;
    wsUrl: string;
  }

  interface BackendStatus {
    state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'stopping' | 'failed';
    detail: string;
    timestamp?: string;
  }

  interface Window {
    agentDesktop?: {
      getBackendConnection(): Promise<BackendConnection | null>;
      getAppVersion(): Promise<string>;
      openFileDialog(options?: Record<string, unknown>): Promise<unknown>;
      showNotification(options: { title?: string; body?: string }): Promise<boolean>;
      onBackendStatus(callback: (status: BackendStatus) => void): () => void;
    };
  }
}
