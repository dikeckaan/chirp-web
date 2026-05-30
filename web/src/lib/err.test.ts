import { describe, it, expect } from "vitest";
import { errMsg } from "./err";

describe("errMsg", () => {
  it("returns the message of an Error", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
  });

  it("returns a plain string as-is", () => {
    expect(errMsg("just a string")).toBe("just a string");
  });

  it("reads .message off a non-Error object", () => {
    expect(errMsg({ message: "objmsg" })).toBe("objmsg");
  });

  it("never renders 'undefined' for a non-Error throw", () => {
    expect(errMsg(undefined)).not.toBe("undefined");
    expect(errMsg(null)).not.toBe("undefined");
  });

  it("stringifies numbers and other primitives", () => {
    expect(errMsg(42)).toBe("42");
  });
});
