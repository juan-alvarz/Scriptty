// Minimal client for bun's inspector: the WebKit Inspector Protocol (JSON-RPC style) over a WebSocket.
// Uses Node's global WebSocket, so no dependency.

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export class Inspector {
  private seq = 0
  private pending = new Map<number, Pending>()
  private handlers = new Map<string, (params: never) => void>()
  private closeHandlers: (() => void)[] = []
  closed = false

  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => this.onMessage(String(ev.data))
    ws.onclose = () => this.onClose()
    ws.onerror = () => this.onClose()
  }

  static connect(url: string, timeoutMs = 5000): Promise<Inspector> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const t = setTimeout(() => {
        ws.close()
        reject(new Error('Could not connect to the debugger'))
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(t)
        resolve(new Inspector(ws))
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('Could not connect to the debugger'))
      }
    })
  }

  call<T = Record<string, unknown>>(method: string, params: object = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The debugger is not connected'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on<P>(method: string, fn: (params: P) => void): void {
    this.handlers.set(method, fn as (params: never) => void)
  }

  onClosed(fn: () => void): void {
    this.closeHandlers.push(fn)
  }

  close(): void {
    this.ws.close()
    this.onClose()
  }

  private onMessage(raw: string): void {
    let m: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown }
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    if (m.id !== undefined) {
      const p = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (m.error) p?.reject(new Error(m.error.message ?? 'Debugger error'))
      else p?.resolve(m.result ?? {})
    } else if (m.method) {
      this.handlers.get(m.method)?.(m.params as never)
    }
  }

  private onClose(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.reject(new Error('The debugger disconnected'))
    this.pending.clear()
    for (const fn of this.closeHandlers) fn()
  }
}
