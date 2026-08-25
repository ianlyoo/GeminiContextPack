import { describe, expect, test } from "bun:test";
import { PACKAGE_NAME, VERSION } from "../src/index.js";

describe("smoke", () => {
  test("placeholder exports are defined", () => {
    expect(PACKAGE_NAME).toBe("gemini-context-pack");
    expect(VERSION).toBe("0.1.0");
  });
});
