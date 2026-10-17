import { getToken, getApiBase, getMe, loadApiBase } from './api';

type UpdateHandler = (update: Uint8Array) => void;

/**
 * Background-side WebSocket client for CRDT ordering sync.
 * Pending ops are kept across reconnects; dropped only when switching space.
 */
export class CrdtSyncClient {
  private ws: WebSocket | null = null;
  private spaceId: string | null = null;
  private onUpdate: UpdateHandler | null = null;
  private pendingQueue: Uint8Array[] = [];
  private reconnectAttempts = 0;
  private maxRetries = 10;
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(spaceId: string, onUpdate: UpdateHandler): void {
    if (this.spaceId !== spaceId) this.dropPending();
    this.disconnect();
    this.spaceId = spaceId;
    this.onUpdate = onUpdate;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    void this.doConnect();
  }

  private async doConnect() {
    if (!this.spaceId) return;
    await loadApiBase();
    const token = getToken();
    if (!token) return;

    const baseUrl = getApiBase();
    const wsBase = baseUrl.replace(/^http/, 'ws').replace(/\/api\/?$/, '');
    this.connectTo(wsBase, token);
  }

  private connectTo(wsBase: string, token: string): void {
    if (!this.spaceId) return;
    this.ws = new WebSocket(`${wsBase}/ws/space/${this.spaceId}?token=${encodeURIComponent(token)}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      for (const update of this.pendingQueue) {
        this.ws!.send(update);
      }
      this.pendingQueue = [];
    };

    this.ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.onUpdate?.(new Uint8Array(e.data));
      }
    };

    let opened = false;
    this.ws.addEventListener('open', () => { opened = true; });

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.shouldReconnect || this.reconnectAttempts >= this.maxRetries) return;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        // The server rejects bad sessions by dropping the upgrade, which looks
        // the same as a network blip. When the socket never opened, validate
        // the session over REST first: a 401 there clears the token and
        // doConnect() then stops instead of retrying with a dead token.
        void (opened ? Promise.resolve() : getMe()).then(() => this.doConnect());
      }, delay);
    };

    this.ws.onerror = () => this.ws?.close();
  }

  send(update: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(update);
    } else {
      this.pendingQueue.push(update);
    }
  }

  /** Disconnect but keep pending queue for reconnect. */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  dropPending(): void {
    this.pendingQueue = [];
  }
}
