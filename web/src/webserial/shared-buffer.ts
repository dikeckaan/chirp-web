// SharedArrayBuffer protocol for the WebSerial bridge.
//
// The Pyodide worker drives CHIRP drivers that issue *synchronous*
// pyserial calls (`pipe.read(n)` blocks). WebSerial in turn is fully
// async. We close the gap with a single SAB: the worker writes a
// command, parks itself with `Atomics.wait`, the main thread sees the
// command via `Atomics.waitAsync`, performs the async I/O, and writes
// the response back.
//
// Single-flight: only one command may be in flight at a time. The
// worker is single-threaded so this is fine.
//
// Layout (all multi-byte values little-endian, Int32 unless noted):
//
//   Header[0..64]  (256 bytes — 64 × int32)
//     [0]  STATE         0=idle, 1=cmd_ready, 2=resp_ready
//     [1]  CMD_OPCODE    see OPCODES below
//     [2]  CMD_HANDLE    port handle id (0 for open)
//     [3]  CMD_INT1      e.g. bytes-to-read, signal bitmask
//     [4]  CMD_INT2      e.g. timeout_ms
//     [5]  CMD_INT3      future use
//     [6]  CMD_PAYLOAD_LEN  bytes in command payload area
//     [16] RESP_STATUS   0=ok, 1=err, 2=timeout
//     [17] RESP_LEN      bytes in response payload area
//
//   CmdPayload  [256 .. 32K]   write data, JSON args
//   RespPayload [32K .. 64K]   read data, UTF-8 error message

export const STATE_IDLE = 0;
export const STATE_CMD = 1;
export const STATE_RESP = 2;

export const STATE_IDX = 0;
export const CMD_OPCODE_IDX = 1;
export const CMD_HANDLE_IDX = 2;
export const CMD_INT1_IDX = 3;
export const CMD_INT2_IDX = 4;
export const CMD_INT3_IDX = 5;
export const CMD_PAYLOAD_LEN_IDX = 6;

export const RESP_STATUS_IDX = 16;
export const RESP_LEN_IDX = 17;

export const HEADER_INT32_COUNT = 64;
export const HEADER_BYTES = HEADER_INT32_COUNT * 4;

export const CMD_PAYLOAD_OFFSET = HEADER_BYTES;
export const CMD_PAYLOAD_BYTES = 32 * 1024 - HEADER_BYTES;
export const RESP_PAYLOAD_OFFSET = 32 * 1024;
export const RESP_PAYLOAD_BYTES = 32 * 1024;

export const SAB_TOTAL_BYTES = 64 * 1024;

export const RESP_OK = 0;
export const RESP_ERR = 1;
export const RESP_TIMEOUT = 2;

export const OPCODES = {
  OPEN: 1,
  CLOSE: 2,
  READ: 3,
  WRITE: 4,
  SET_SIGNALS: 5,
  IN_WAITING: 6,
  RESET_INPUT: 7,
  RESET_OUTPUT: 8,
  FLUSH: 9,
  LOG: 10,
  RECONFIGURE: 11,
  LIST_PORTS: 12,
} as const;
export type Opcode = (typeof OPCODES)[keyof typeof OPCODES];

export function createSAB(): SharedArrayBuffer {
  return new SharedArrayBuffer(SAB_TOTAL_BYTES);
}

export function makeHeader(sab: SharedArrayBuffer): Int32Array {
  return new Int32Array(sab, 0, HEADER_INT32_COUNT);
}

export function makeCmdPayload(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, CMD_PAYLOAD_OFFSET, CMD_PAYLOAD_BYTES);
}

export function makeRespPayload(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, RESP_PAYLOAD_OFFSET, RESP_PAYLOAD_BYTES);
}
