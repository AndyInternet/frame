import { join } from "./utils";
import { readFileSync } from "node:fs";

export const MAX_RETRIES = 3;

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

function internalHelper(): void {
  console.log("not exported");
}
