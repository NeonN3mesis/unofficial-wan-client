import fs from "node:fs/promises";
import path from "node:path";

export class JsonFileStore<T> {
  private cached?: T;

  constructor(
    private readonly filePath: string,
    private readonly defaults: T
  ) {}

  async read(): Promise<T> {
    if (this.cached) {
      return this.cached;
    }

    try {
      const file = await fs.readFile(this.filePath, "utf8");
      this.cached = {
        ...this.defaults,
        ...(JSON.parse(file) as Partial<T>)
      };
      return this.cached;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = this.defaults;
        return this.cached;
      }

      throw error;
    }
  }

  async write(value: T): Promise<T> {
    this.cached = value;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
    return value;
  }
}
