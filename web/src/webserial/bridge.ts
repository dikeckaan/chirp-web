// Main-thread WebSerial bridge.
//
// Owns the real `SerialPort` objects, runs continuous async read loops
// per open port, and answers synchronous commands from the Pyodide
// worker via the shared SAB protocol.
//
// One bridge instance per page. The instance is created by `runtime.ts`
// after the user grants port access; the SAB is then forwarded to the
// worker.

import {
  CMD_HANDLE_IDX,
  CMD_INT1_IDX,
  CMD_INT2_IDX,
  CMD_OPCODE_IDX,
  CMD_PAYLOAD_LEN_IDX,
  CMD_PAYLOAD_OFFSET,
  HEADER_INT32_COUNT,
  OPCODES,
  RESP_ERR,
  RESP_LEN_IDX,
  RESP_OK,
  RESP_PAYLOAD_BYTES,
  RESP_PAYLOAD_OFFSET,
  RESP_STATUS_IDX,
  RESP_TIMEOUT,
  STATE_CMD,
  STATE_IDLE,
  STATE_IDX,
  STATE_RESP,
  type Opcode,
} from "./shared-buffer";

interface PortRecord {
  port: SerialPort;
  handle: number;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  rx: Uint8Array[]; // accumulator of received chunks
  rxBytes: number;
  closed: boolean;
  // Resolvers parked by `readBytes`, woken whenever the background
  // read loop appends a new chunk. Lets us react immediately instead
  // of polling on a 4-ms-throttled setTimeout.
  rxWaiters: (() => void)[];
}

export class WebSerialBridge {
  readonly sab: SharedArrayBuffer;
  private header: Int32Array;
  private cmdPayload: Uint8Array;
  private respPayload: Uint8Array;

  // Granted but not yet opened — handle assigned at grant time.
  private grantedPorts = new Map<number, SerialPort>();
  private openPorts = new Map<number, PortRecord>();
  private nextHandle = 1;

  private running = false;

  constructor(sab: SharedArrayBuffer) {
    this.sab = sab;
    this.header = new Int32Array(sab, 0, HEADER_INT32_COUNT);
    this.cmdPayload = new Uint8Array(
      sab,
      CMD_PAYLOAD_OFFSET,
      32 * 1024 - HEADER_INT32_COUNT * 4,
    );
    this.respPayload = new Uint8Array(
      sab,
      RESP_PAYLOAD_OFFSET,
      RESP_PAYLOAD_BYTES,
    );

    // Adopt previously granted ports (persisted by the browser between
    // sessions for this origin).
    if ("serial" in navigator) {
      navigator.serial.getPorts().then((ports) => {
        for (const port of ports) {
          this.registerGrantedPort(port);
        }
      });
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  dispose(): void {
    this.running = false;
    for (const rec of this.openPorts.values()) {
      void this.closePort(rec).catch(() => undefined);
    }
    this.openPorts.clear();
    this.grantedPorts.clear();
  }

  // --------------------------------------------------------- port grant
  async requestPort(): Promise<{ handle: number; description: string }> {
    if (!("serial" in navigator)) {
      throw new Error("WebSerial bu tarayıcıda desteklenmiyor.");
    }
    const port = await navigator.serial.requestPort();
    return this.registerGrantedPort(port);
  }

  private registerGrantedPort(port: SerialPort): {
    handle: number;
    description: string;
  } {
    // Avoid duplicates — if the same SerialPort instance is already
    // tracked, reuse its handle.
    for (const [h, p] of this.grantedPorts) {
      if (p === port) {
        return { handle: h, description: portDescription(port) };
      }
    }
    const handle = this.nextHandle++;
    this.grantedPorts.set(handle, port);
    return { handle, description: portDescription(port) };
  }

  listGrantedPorts(): { handle: number; description: string }[] {
    return Array.from(this.grantedPorts.entries()).map(([handle, port]) => ({
      handle,
      description: portDescription(port),
    }));
  }

  // ----------------------------------------------------------- main loop
  private async loop(): Promise<void> {
    while (this.running) {
      // Wait for the worker to publish a command (STATE transitions to
      // STATE_CMD). `waitAsync` lets us cooperate with the event loop
      // so async I/O can still complete.
      const res = Atomics.waitAsync(this.header, STATE_IDX, STATE_IDLE);
      if (res.async) {
        const r = await res.value;
        if (r === "timed-out") continue;
      }
      // Validate state — could have been STATE_RESP from a previous
      // interrupted cycle.
      const state = Atomics.load(this.header, STATE_IDX);
      if (state !== STATE_CMD) {
        await new Promise((r) => setTimeout(r, 1));
        continue;
      }

      try {
        await this.dispatch();
      } catch (err) {
        this.writeError((err as Error).message);
      }

      // Publish response and wake the worker.
      Atomics.store(this.header, STATE_IDX, STATE_RESP);
      Atomics.notify(this.header, STATE_IDX);

      // Wait for the worker to ack (reset STATE → IDLE).
      const ack = Atomics.waitAsync(this.header, STATE_IDX, STATE_RESP);
      if (ack.async) {
        await ack.value;
      }
    }
  }

  // -------------------------------------------------------- dispatch
  private async dispatch(): Promise<void> {
    const opcode = Atomics.load(this.header, CMD_OPCODE_IDX) as Opcode;
    const handle = Atomics.load(this.header, CMD_HANDLE_IDX);
    const int1 = Atomics.load(this.header, CMD_INT1_IDX);
    const int2 = Atomics.load(this.header, CMD_INT2_IDX);
    const payloadLen = Atomics.load(this.header, CMD_PAYLOAD_LEN_IDX);

    // Verbose logging — pipe to console so we can see exactly which op
    // the worker is waiting on if a clone stalls.
    if (DEBUG)
      console.log(
        `[serial] op=${OPNAMES[opcode] ?? opcode} h=${handle} ` +
          `int1=${int1} int2=${int2} payload=${payloadLen}`,
      );

    switch (opcode) {
      case OPCODES.OPEN: {
        const optsJson = decodeText(this.cmdPayload.subarray(0, payloadLen));
        const parsed = optsJson
          ? (JSON.parse(optsJson) as Partial<SerialOptions>)
          : {};
        const opts: SerialOptions = {
          baudRate: parsed.baudRate ?? 9600,
          dataBits: (parsed.dataBits ?? 8) as 7 | 8,
          stopBits: (parsed.stopBits ?? 1) as 1 | 2,
          parity: parsed.parity ?? "none",
          flowControl: parsed.flowControl ?? "none",
        };
        const h = await this.openPort(handle, opts);
        this.writeIntResponse(h);
        return;
      }
      case OPCODES.CLOSE: {
        const rec = this.openPorts.get(handle);
        if (rec) await this.closePort(rec);
        this.writeOk();
        return;
      }
      case OPCODES.READ: {
        const n = int1;
        const timeoutMs = int2;
        const data = await this.readBytes(handle, n, timeoutMs);
        this.writeBytesResponse(data);
        return;
      }
      case OPCODES.WRITE: {
        const rec = this.requireOpen(handle);
        const data = this.cmdPayload.slice(0, payloadLen);
        if (DEBUG)
          console.log(
            `[serial]   → ${data.byteLength} bytes ` +
              Array.from(data.slice(0, 16))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(" ") +
              (data.byteLength > 16 ? " …" : ""),
          );
        await rec.writer!.write(data);
        this.writeIntResponse(data.byteLength);
        return;
      }
      case OPCODES.SET_SIGNALS: {
        const rec = this.requireOpen(handle);
        // int1 bit0=rts, bit1=dtr, plus a "has" mask in bits 8,9
        const signals: SerialOutputSignals = {};
        if (int1 & 0x100) signals.requestToSend = !!(int1 & 0x1);
        if (int1 & 0x200) signals.dataTerminalReady = !!(int1 & 0x2);
        await rec.port.setSignals(signals);
        this.writeOk();
        return;
      }
      case OPCODES.IN_WAITING: {
        const rec = this.requireOpen(handle);
        this.writeIntResponse(rec.rxBytes);
        return;
      }
      case OPCODES.RESET_INPUT: {
        const rec = this.requireOpen(handle);
        rec.rx.length = 0;
        rec.rxBytes = 0;
        this.writeOk();
        return;
      }
      case OPCODES.RESET_OUTPUT: {
        this.writeOk();
        return;
      }
      case OPCODES.FLUSH: {
        this.writeOk();
        return;
      }
      case OPCODES.LOG: {
        // No-op for now. Could pipe to a serial transcript view.
        this.writeOk();
        return;
      }
      case OPCODES.RECONFIGURE: {
        // Re-open with new opts is the only way WebSerial supports a
        // baudrate change. Implement when needed by a driver.
        this.writeError("RECONFIGURE not implemented");
        return;
      }
      case OPCODES.LIST_PORTS: {
        const list = this.listGrantedPorts();
        this.writeBytesResponse(encodeText(JSON.stringify(list)));
        return;
      }
      default:
        this.writeError(`Unknown opcode ${opcode}`);
    }
  }

  // ---------------------------------------------------- port operations
  private async openPort(
    handle: number,
    opts: SerialOptions,
  ): Promise<number> {
    let port = this.grantedPorts.get(handle);
    // If the worker didn't supply a known handle (handle=0) the most
    // recently granted port is used.
    if (!port) {
      const all = Array.from(this.grantedPorts.entries());
      if (all.length === 0) {
        throw new Error("Bağlı bir seri port yok. Önce port izni ver.");
      }
      const last = all[all.length - 1];
      handle = last[0];
      port = last[1];
    }

    if (this.openPorts.has(handle)) {
      return handle;
    }

    await port.open({
      baudRate: opts.baudRate ?? 9600,
      dataBits: (opts.dataBits ?? 8) as 7 | 8,
      stopBits: (opts.stopBits ?? 1) as 1 | 2,
      parity: opts.parity ?? "none",
      flowControl: opts.flowControl ?? "none",
    });

    const rec: PortRecord = {
      port,
      handle,
      reader: null,
      writer: null,
      rx: [],
      rxBytes: 0,
      closed: false,
      rxWaiters: [],
    };
    rec.reader = port.readable!.getReader();
    rec.writer = port.writable!.getWriter();
    this.openPorts.set(handle, rec);

    // Background read loop — drains the port into rec.rx.
    void this.readLoop(rec);

    return handle;
  }

  private async closePort(rec: PortRecord): Promise<void> {
    if (rec.closed) return;
    rec.closed = true;
    if (DEBUG) console.log(`[serial] closePort(${rec.handle}) start`);

    // Order matters and each step must complete before the next, or
    // `port.close()` deadlocks waiting for the stream locks to drop.
    if (rec.reader) {
      try {
        await rec.reader.cancel();
      } catch (e) {
        if (DEBUG) console.warn("[serial] reader.cancel failed", e);
      }
      try {
        rec.reader.releaseLock();
      } catch (e) {
        if (DEBUG) console.warn("[serial] reader.releaseLock failed", e);
      }
      rec.reader = null;
    }
    if (rec.writer) {
      try {
        await rec.writer.close();
      } catch (e) {
        if (DEBUG) console.warn("[serial] writer.close failed", e);
      }
      try {
        rec.writer.releaseLock();
      } catch (e) {
        if (DEBUG) console.warn("[serial] writer.releaseLock failed", e);
      }
      rec.writer = null;
    }
    try {
      await rec.port.close();
    } catch (e) {
      if (DEBUG) console.warn("[serial] port.close failed", e);
    }
    this.openPorts.delete(rec.handle);
    if (DEBUG) console.log(`[serial] closePort(${rec.handle}) done`);
  }

  private async readLoop(rec: PortRecord): Promise<void> {
    try {
      while (!rec.closed && rec.reader) {
        const { value, done } = await rec.reader.read();
        if (done) break;
        if (value && value.byteLength) {
          rec.rx.push(value);
          rec.rxBytes += value.byteLength;
          // Wake up anyone waiting on more data.
          const waiters = rec.rxWaiters.splice(0);
          for (const w of waiters) w();
        }
      }
    } catch (e) {
      if (DEBUG) console.warn(`[serial] readLoop(${rec.handle}) ended`, e);
    }
    // Also wake waiters on close so they don't hang.
    const waiters = rec.rxWaiters.splice(0);
    for (const w of waiters) w();
  }

  private async readBytes(
    handle: number,
    n: number,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    const rec = this.requireOpen(handle);
    const deadline = timeoutMs > 0 ? performance.now() + timeoutMs : Infinity;
    while (rec.rxBytes < n) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      if (rec.closed) break;
      // Park until the next chunk lands (or a max 25 ms fallback so we
      // also respect the deadline if the radio went quiet).
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(t);
          const idx = rec.rxWaiters.indexOf(wake);
          if (idx >= 0) rec.rxWaiters.splice(idx, 1);
          resolve();
        };
        rec.rxWaiters.push(wake);
        const t = setTimeout(wake, Math.min(remaining, 25));
      });
    }
    const out = this.drainBytes(rec, n);
    if (DEBUG)
      console.log(
        `[serial]   ← ${out.byteLength}/${n} bytes (timeout=${timeoutMs}ms)` +
          (out.byteLength
            ? " " +
              Array.from(out.slice(0, 16))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(" ") +
              (out.byteLength > 16 ? " …" : "")
            : ""),
      );
    return out;
  }

  private drainBytes(rec: PortRecord, n: number): Uint8Array {
    const have = Math.min(n, rec.rxBytes);
    const out = new Uint8Array(have);
    let written = 0;
    while (written < have && rec.rx.length) {
      const chunk = rec.rx[0];
      const need = have - written;
      if (chunk.byteLength <= need) {
        out.set(chunk, written);
        written += chunk.byteLength;
        rec.rx.shift();
      } else {
        out.set(chunk.subarray(0, need), written);
        rec.rx[0] = chunk.subarray(need);
        written += need;
      }
    }
    rec.rxBytes -= have;
    return out;
  }

  // -------------------------------------------------- response writers
  private writeOk(): void {
    Atomics.store(this.header, RESP_STATUS_IDX, RESP_OK);
    Atomics.store(this.header, RESP_LEN_IDX, 0);
  }

  private writeIntResponse(value: number): void {
    Atomics.store(this.header, RESP_STATUS_IDX, RESP_OK);
    Atomics.store(this.header, CMD_INT1_IDX, value); // reuse cell as return
    Atomics.store(this.header, RESP_LEN_IDX, 0);
  }

  private writeBytesResponse(data: Uint8Array): void {
    Atomics.store(this.header, RESP_STATUS_IDX, RESP_OK);
    const len = Math.min(data.byteLength, RESP_PAYLOAD_BYTES);
    this.respPayload.set(data.subarray(0, len), 0);
    Atomics.store(this.header, RESP_LEN_IDX, len);
  }

  private writeError(msg: string): void {
    Atomics.store(this.header, RESP_STATUS_IDX, RESP_ERR);
    const data = encodeText(msg);
    const len = Math.min(data.byteLength, RESP_PAYLOAD_BYTES);
    this.respPayload.set(data.subarray(0, len), 0);
    Atomics.store(this.header, RESP_LEN_IDX, len);
  }

  // ----------------------------------------------------------- helpers
  private requireOpen(handle: number): PortRecord {
    const rec = this.openPorts.get(handle);
    if (!rec) throw new Error(`Port ${handle} açık değil`);
    return rec;
  }
}

function portDescription(port: SerialPort): string {
  try {
    const info = port.getInfo();
    if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
      return `USB ${hex4(info.usbVendorId)}:${hex4(info.usbProductId)}`;
    }
  } catch {
    /* ignore */
  }
  return "Serial Port";
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, "0").toUpperCase();
}

function encodeText(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decodeText(b: Uint8Array): string {
  // TextDecoder spec rejects views backed by SharedArrayBuffer. Copy
  // into a fresh, non-shared buffer first.
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new TextDecoder().decode(copy);
}

// Re-export so consumers don't need to know SAB internals.
export { RESP_TIMEOUT, RESP_ERR };

// Default ON during early development — every serial op shows up in
// the console so stalls are diagnosable. Turn off in production with:
//   localStorage.setItem('chirp.serial.debug', '0')
const DEBUG =
  typeof localStorage === "undefined" ||
  localStorage.getItem("chirp.serial.debug") !== "0";

const OPNAMES: Record<number, string> = {
  [OPCODES.OPEN]: "OPEN",
  [OPCODES.CLOSE]: "CLOSE",
  [OPCODES.READ]: "READ",
  [OPCODES.WRITE]: "WRITE",
  [OPCODES.SET_SIGNALS]: "SET_SIGNALS",
  [OPCODES.IN_WAITING]: "IN_WAITING",
  [OPCODES.RESET_INPUT]: "RESET_INPUT",
  [OPCODES.RESET_OUTPUT]: "RESET_OUTPUT",
  [OPCODES.FLUSH]: "FLUSH",
  [OPCODES.LOG]: "LOG",
  [OPCODES.RECONFIGURE]: "RECONFIGURE",
  [OPCODES.LIST_PORTS]: "LIST_PORTS",
};
