export interface Serializable {
  serialize(): string;
  deserialize(data: string): void;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export enum Status {
  Active = "active",
  Inactive = "inactive",
  Pending = "pending",
}

export class Repository<T extends Serializable> {
  private items: Map<string, T> = new Map();
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  public get(id: string): T | undefined {
    return this.items.get(id);
  }

  public set(id: string, item: T): void {
    this.items.set(id, item);
  }

  protected clear(): void {
    this.items.clear();
  }
}

export async function fetchData<T>(url: string): Promise<Result<T>> {
  try {
    const response = await fetch(url);
    const value = (await response.json()) as T;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
