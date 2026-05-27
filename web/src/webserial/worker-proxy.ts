// Worker-side synchronous WebSerial proxy.
//
// Lives inside the Pyodide worker. Exposed to Python as
// `js.chirpWebSerial` (via globalThis attachment). Each method blocks
// the worker thread (using `Atomics.wait`) until the main-thread
// bridge writes back into the shared buffer.

import {
  CMD_HANDLE_IDX,
  CMD_INT1_IDX,
  CMD_INT2_IDX,
  CMD_OPCODE_IDX,
  CMD_PAYLOAD_LEN_IDX,
  CMD_PAYLOAD_OFFSET,
  CMD_PAYLOAD_BYTES,
  HEADER_INT32_COUNT,
  OPCODES,
  RESP_LEN_IDX,
  RESP_OK,
  RESP_PAYLOAD_BYTES,
  RESP_PAYLOAD_OFFSET,
  RESP_STATUS_IDX,
  STATE_CMD,
  STATE_IDLE,
  STATE_IDX,
  STATE_RESP,
} from "./shared-buffer";

export class WebSerialWorkerProxy {
  private header: Int32Array;
  private cmdPayload: Uint8Array;
  private respPayload: Uint8Array;

  constructor(sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, HEADER_INT32_COUNT);
    this.cmdPayload = new Uint8Array(
      sab,
      CMD_PAYLOAD_OFFSET,
      CMD_PAYLOAD_BYTES,
    );
    this.respPayload = new Uint8Array(
      sab,
      RESP_PAYLOAD_OFFSET,
      RESP_PAYLOAD_BYTES,
    );
  }

  // ------------------------------------------------------- core RPC
  private send(
    opcode: number,
    handle: number,
    int1: number = 0,
    int2: number = 0,
    payload?: Uint8Array,
  ): void {
    // The bridge expects STATE to be IDLE when we publish a new command.
    // If it's not, something went wrong on a previous cycle — wait it
    // out briefly.
    let state = Atomics.load(this.header, STATE_IDX);
    if (state !== STATE_IDLE) {
      Atomics.wait(this.header, STATE_IDX, state, 100);
    }

    Atomics.store(this.header, CMD_OPCODE_IDX, opcode);
    Atomics.store(this.header, CMD_HANDLE_IDX, handle);
    Atomics.store(this.header, CMD_INT1_IDX, int1);
    Atomics.store(this.header, CMD_INT2_IDX, int2);
    if (payload && payload.byteLength) {
      const len = Math.min(payload.byteLength, CMD_PAYLOAD_BYTES);
      this.cmdPayload.set(payload.subarray(0, len), 0);
      Atomics.store(this.header, CMD_PAYLOAD_LEN_IDX, len);
    } else {
      Atomics.store(this.header, CMD_PAYLOAD_LEN_IDX, 0);
    }

    Atomics.store(this.header, STATE_IDX, STATE_CMD);
    Atomics.notify(this.header, STATE_IDX);

    // Block until the main thread sets STATE_RESP. No timeout — we
    // already passed any per-op timeout via int2.
    while (Atomics.load(this.header, STATE_IDX) === STATE_CMD) {
      Atomics.wait(this.header, STATE_IDX, STATE_CMD);
    }
  }

  private finish(): void {
    Atomics.store(this.header, STATE_IDX, STATE_IDLE);
    Atomics.notify(this.header, STATE_IDX);
  }

  private throwIfError(): void {
    const status = Atomics.load(this.header, RESP_STATUS_IDX);
    if (status !== RESP_OK) {
      const len = Atomics.load(this.header, RESP_LEN_IDX);
      const msg =
        len > 0 ? decodeShared(this.respPayload, len) : "Bilinmeyen seri port hatası";
      this.finish();
      throw new Error(msg);
    }
  }

  // -------------------------------------------------------- public API
  openSync(handle: number, optsObj: unknown): number {
    const payload = new TextEncoder().encode(JSON.stringify(optsObj ?? {}));
    this.send(OPCODES.OPEN, handle, 0, 0, payload);
    this.throwIfError();
    const newHandle = Atomics.load(this.header, CMD_INT1_IDX);
    this.finish();
    return newHandle;
  }

  closeSync(handle: number): void {
    this.send(OPCODES.CLOSE, handle);
    this.throwIfError();
    this.finish();
  }

  readSync(handle: number, n: number, timeoutMs: number): Uint8Array {
    this.send(OPCODES.READ, handle, n, timeoutMs);
    this.throwIfError();
    const len = Atomics.load(this.header, RESP_LEN_IDX);
    // Copy out of the SAB-backed payload into a private buffer; the
    // returned Uint8Array is consumed by Pyodide which doesn't accept
    // shared views.
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = this.respPayload[i];
    this.finish();
    return out;
  }

  writeSync(handle: number, data: Uint8Array): number {
    this.send(OPCODES.WRITE, handle, 0, 0, data);
    this.throwIfError();
    const written = Atomics.load(this.header, CMD_INT1_IDX);
    this.finish();
    return written;
  }

  setSignals(handle: number, sig: { rts?: boolean; dtr?: boolean }): void {
    let bits = 0;
    if ("rts" in sig) {
      bits |= 0x100;
      if (sig.rts) bits |= 0x1;
    }
    if ("dtr" in sig) {
      bits |= 0x200;
      if (sig.dtr) bits |= 0x2;
    }
    this.send(OPCODES.SET_SIGNALS, handle, bits);
    this.throwIfError();
    this.finish();
  }

  inWaiting(handle: number): number {
    this.send(OPCODES.IN_WAITING, handle);
    this.throwIfError();
    const n = Atomics.load(this.header, CMD_INT1_IDX);
    this.finish();
    return n;
  }

  resetInputBuffer(handle: number): void {
    this.send(OPCODES.RESET_INPUT, handle);
    this.throwIfError();
    this.finish();
  }

  resetOutputBuffer(handle: number): void {
    this.send(OPCODES.RESET_OUTPUT, handle);
    this.throwIfError();
    this.finish();
  }

  flushSync(handle: number): void {
    this.send(OPCODES.FLUSH, handle);
    this.throwIfError();
    this.finish();
  }

  log(handle: number, msg: string): void {
    const payload = new TextEncoder().encode(msg);
    this.send(OPCODES.LOG, handle, 0, 0, payload);
    this.finish();
  }

  reconfigure(handle: number, optsObj: unknown): void {
    const payload = new TextEncoder().encode(JSON.stringify(optsObj ?? {}));
    this.send(OPCODES.RECONFIGURE, handle, 0, 0, payload);
    // ignore error — RECONFIGURE returns 'not implemented' for now
    this.finish();
  }

  getGrantedPorts(): { handle: number; description: string }[] {
    this.send(OPCODES.LIST_PORTS, 0);
    this.throwIfError();
    const len = Atomics.load(this.header, RESP_LEN_IDX);
    const txt = decodeShared(this.respPayload, len);
    this.finish();
    try {
      return JSON.parse(txt);
    } catch {
      return [];
    }
  }
}

function decodeShared(buf: Uint8Array, len: number): string {
  // TextDecoder rejects SharedArrayBuffer views — copy to a private
  // buffer first.
  const copy = new Uint8Array(len);
  for (let i = 0; i < len; i++) copy[i] = buf[i];
  return new TextDecoder().decode(copy);
}
