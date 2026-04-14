import { join } from "path";
import type { User } from "./types";
import { formatName } from "./utils";

export function greet(user: User): string {
  return `Hello, ${formatName(user)}!`;
}

export function main(): void {
  const user: User = { name: "World", age: 30 };
  const dir = join("output", "logs");
  console.log(greet(user), dir);
}
