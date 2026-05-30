// Coerce an unknown thrown value into a display string.
//
// `catch (e)` gives `unknown`; `(e as Error).message` renders "undefined"
// when a non-Error is thrown (string, DOMException-like, JsProxy from
// Pyodide, etc.). Use this everywhere we surface an error to the user.
export function errMsg(e: unknown): string {
  if (e == null) return "Bilinmeyen hata";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return String(e);
  } catch {
    return "Bilinmeyen hata";
  }
}
