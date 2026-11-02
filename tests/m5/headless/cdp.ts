/**
 * A minimal Chrome DevTools Protocol client (Wave 3 `04` §7).
 *
 * The repository may not gain a browser-automation dependency: `02` §7 requires an ADR,
 * a pinned version, a licence and a lockfile for anything new, and there is no network
 * to fetch one with. Node 22 ships a WebSocket *client*, and the DevTools Protocol is a
 * small JSON request/response protocol on top of it, so the client is written here —
 * once, and only the parts the M5 cases use.
 *
 * Everything is headless and muted: the browser is started with `--headless=new
 * --mute-audio` by `chrome.ts`, and nothing here opens a window or takes a focus.
 */
export interface CdpTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

export class CdpSession {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, {
    resolve: (value: unknown) => void; reject: (reason: Error) => void;
  }>();
  readonly #events = new Map<string, Array<(params: unknown) => void>>();
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event: MessageEvent) => {
      const text = typeof event.data === "string" ? event.data : "";
      let value: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };
      try { value = JSON.parse(text) as typeof value; }
      catch { return; }
      if (typeof value.id === "number") {
        const waiter = this.#pending.get(value.id);
        if (waiter === undefined) return;
        this.#pending.delete(value.id);
        if (value.error !== undefined) waiter.reject(new Error(value.error.message ?? "CDP_ERROR"));
        else waiter.resolve(value.result);
        return;
      }
      if (typeof value.method === "string") {
        for (const listener of this.#events.get(value.method) ?? []) listener(value.params);
      }
    });
  }

  /** Open a tab and attach to it. */
  static async open(endpoint: string, url = "about:blank"): Promise<CdpSession> {
    // Newer Chrome answers `/json/new` only to PUT.
    const created = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    let target = created.ok
      ? await created.json() as CdpTarget
      : undefined;
    if (target === undefined) {
      const list = await fetch(`${endpoint}/json/list`).then(async (response) =>
        await response.json() as CdpTarget[]);
      target = list.find((item) => item.type === "page");
    }
    if (target === undefined) throw new Error("M5_BLOCKED_ENV:NO_CDP_PAGE");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((done, fail) => {
      socket.addEventListener("open", () => done(), { once: true });
      socket.addEventListener("error", () => fail(new Error("CDP_SOCKET_FAILED")), { once: true });
    });
    return new CdpSession(socket);
  }

  /**
   * One DevTools call.
   *
   * It has a timeout, because a browser that stops answering must fail the case rather
   * than hang the whole capture: a capture that never ends is evidence of nothing.
   */
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP_CALL_TIMEOUT:${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (reason) => { clearTimeout(timer); reject(reason); },
      });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: (params: unknown) => void): () => void {
    const list = this.#events.get(method) ?? [];
    list.push(listener);
    this.#events.set(method, list);
    return () => {
      const current = this.#events.get(method) ?? [];
      this.#events.set(method, current.filter((entry) => entry !== listener));
    };
  }

  /**
   * Navigate and wait for the load event.
   *
   * A load event that never arrives is not a failure: the Studio's page keeps loading
   * its own assets, and the caller polls the panel's state anyway. What is *not* allowed
   * is a silent lie, so the timeout is reported in the returned value.
   */
  async navigate(url: string, timeoutMs = 30_000): Promise<{ loaded: boolean }> {
    await this.call("Page.enable");
    await this.call("Runtime.enable");
    let loaded = false;
    const wait = new Promise<void>((done) => {
      const timer = setTimeout(() => done(), timeoutMs);
      const off = this.on("Page.loadEventFired", () => { loaded = true; clearTimeout(timer); off(); done(); });
    });
    await this.call("Page.navigate", { url });
    await wait;
    return { loaded };
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.call("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    }) as {
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (result.exceptionDetails !== undefined) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text ?? "unknown";
      throw new Error(`CDP_EVALUATION_FAILED:${detail}`);
    }
    return result.result?.value as T;
  }

  /**
   * Evaluate, and try again once.
   *
   * A page that is navigating destroys the execution context under the evaluation, and
   * the answer is "Uncaught" rather than anything about the expression. One retry turns
   * that race into a wait instead of a failed case.
   */
  async evaluateWithRetry<T>(expression: string, attempts = 3): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try { return await this.evaluate<T>(expression); }
      catch (error) { last = error; await new Promise((done) => setTimeout(done, 250)); }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  /** A PNG screenshot, base64. */
  async screenshot(): Promise<string> {
    const result = await this.call("Page.captureScreenshot", { format: "png" }) as { data?: string };
    return result.data ?? "";
  }

  /**
   * Press a key, as the browser's own keyboard would.
   *
   * A modified key is sent as the *modifier* first and released last, because that is how
   * a keyboard delivers it: the `modifiers` bit alone tells the renderer what to report,
   * while the modifier's own key event is what the page's key state is built from.
   */
  async pressKey(key: string, code: string, keyCode: number,
    modifiers = 0): Promise<void> {
    const shift = (modifiers & 8) !== 0;
    if (shift) {
      await this.call("Input.dispatchKeyEvent", {
        key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16,
        modifiers, type: "keyDown",
      });
    }
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await this.call("Input.dispatchKeyEvent", { ...base, type: "keyDown" });
    await this.call("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
    if (shift) {
      await this.call("Input.dispatchKeyEvent", {
        key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16,
        modifiers: modifiers & ~8, type: "keyUp",
      });
    }
  }

  /** Type into the focused element. */
  async insertText(text: string): Promise<void> {
    await this.call("Input.insertText", { text });
  }

  /** Move the mouse and click at a point. */
  async clickAt(x: number, y: number): Promise<void> {
    await this.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await this.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  close(): void {
    try { this.#socket.close(); } catch { /* already closed */ }
  }
}

/** The rectangle of an element, in CSS pixels, relative to the viewport. */
export interface Box {
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}

/** The centre of an element, for a click. */
export const CENTRE_EXPRESSION = `(function () {
  var element = document.querySelector(arguments[0]);
  if (!element) return null;
  element.scrollIntoView({ block: "center", inline: "center" });
  var box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
})`;
