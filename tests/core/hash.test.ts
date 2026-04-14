import { describe, expect, test } from "bun:test";
import { hashString, rawHash } from "../../src/core/hash.ts";

const BASE62_RE = /^[0-9A-Za-z]+$/;

describe("hashString", () => {
  test("deterministic — same input produces same output", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
  });

  test("different inputs produce different outputs", () => {
    expect(hashString("hello")).not.toBe(hashString("world"));
  });

  test("returns non-empty string", () => {
    expect(hashString("anything").length).toBeGreaterThan(0);
  });

  test("output contains only base62 characters", () => {
    expect(hashString("test123")).toMatch(BASE62_RE);
    expect(hashString("")).toMatch(BASE62_RE);
    expect(hashString("special chars: !@#$%^&*()")).toMatch(BASE62_RE);
  });
});

describe("rawHash", () => {
  test("returns string starting with 'raw:'", () => {
    expect(rawHash("hello")).toStartWith("raw:");
  });

  test("rawHash('hello') has format raw:<base62string>", () => {
    const result = rawHash("hello");
    expect(result).toMatch(/^raw:[0-9A-Za-z]+$/);
  });
});
