// A thin wrapper over the D1 binding that adds up the rows each query read
// and wrote, from the meta D1 returns with every result. Those two numbers
// are what the free plan's daily D1 limits count.
export class Db {
  rowsRead = 0;
  rowsWritten = 0;
  queries = 0;

  constructor(private readonly d1: D1Database) {}

  prepare(sql: string): D1PreparedStatement {
    return this.d1.prepare(sql);
  }

  async all<T>(stmt: D1PreparedStatement): Promise<T[]> {
    const res = await stmt.all<T>();
    this.add(res.meta);
    return res.results;
  }

  async run(stmt: D1PreparedStatement): Promise<void> {
    this.add((await stmt.run()).meta);
  }

  // One round trip and one transaction for all statements.
  async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results = await this.d1.batch<T>(stmts);
    for (const res of results) this.add(res.meta);
    return results;
  }

  headers(): Record<string, string> {
    return {
      "x-d1-rows-read": String(this.rowsRead),
      "x-d1-rows-written": String(this.rowsWritten),
      "x-d1-queries": String(this.queries),
    };
  }

  private add(meta: D1Meta): void {
    this.queries += 1;
    this.rowsRead += meta.rows_read ?? 0;
    this.rowsWritten += meta.rows_written ?? 0;
  }
}
