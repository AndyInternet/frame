const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function encodeBase62(n: bigint): string {
  if (n === 0n) return "0";
  let result = "";
  let num = n < 0n ? -n : n;
  while (num > 0n) {
    result = BASE62[Number(num % 62n)] + result;
    num = num / 62n;
  }
  return result;
}

export function hashString(input: string): string {
  return encodeBase62(BigInt(Bun.hash(input)));
}

export function rawHash(source: string): string {
  return `raw:${hashString(source)}`;
}
