import type { User } from "./types";

export function formatName(user: User): string {
  return user.name.toUpperCase();
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "-");
}
