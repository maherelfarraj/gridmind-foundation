// P-178 — Minimal in-memory Supabase double for server-function unit tests.
//
// Supports only the query shapes the SCADA server modules use:
//   from(t).select(cols)[.eq/.in/.not/.like/.lte/.gte/.order/.limit][.maybeSingle/.single]
//   from(t).insert(row).select(cols).single()
//   from(t).update(patch).eq(...)
//   from(t).delete().eq(...)
//   from(t).upsert(row, { onConflict, ignoreDuplicates })
//   rpc(name, args)
// Never hits the network.

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Filter = (row: Row) => boolean;

export interface FakeSupabaseOptions {
  /** Handlers keyed by RPC name; return value becomes `data`. */
  rpc?: Record<string, (args: Row) => unknown>;
  /** Called for every insert/upsert to mint an id when the row has none. */
  newId?: () => string;
  /** Return a message to make a given table+operation fail (simulated DB error). */
  failOn?: (table: string, op: string) => string | null;
}

let counter = 0;
const defaultId = () => `id-${++counter}`;

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] = {};
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";
  private limitN: number | null = null;
  private orderKey: string | null = null;
  private orderAsc = true;
  private conflictKeys: string[] = [];
  private ignoreDuplicates = false;

  constructor(
    private readonly db: Tables,
    private readonly table: string,
    private readonly newId: () => string,
    private readonly failOn?: (table: string, op: string) => string | null,
  ) {}

  private rows(): Row[] {
    return (this.db[this.table] ??= []);
  }

  select(_cols?: string) {
    if (this.op === "select") this.op = "select";
    this.returning = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = payload;
    this.conflictKeys = (opts?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) === (val ?? null));
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  not(col: string, op: string, val: string) {
    if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim());
      this.filters.push((r) => !list.includes(String(r[col])));
    } else {
      this.filters.push((r) => r[col] !== val);
    }
    return this;
  }
  like(col: string, pattern: string) {
    const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  lte(col: string, val: string | number) {
    this.filters.push((r) => (r[col] as string | number) <= val);
    return this;
  }
  gte(col: string, val: string | number) {
    this.filters.push((r) => (r[col] as string | number) >= val);
    return this;
  }
  lt(col: string, val: string | number) {
    this.filters.push((r) => (r[col] as string | number) < val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderKey = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }

  private matched(): Row[] {
    let out = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.orderKey) {
      const k = this.orderKey;
      out = [...out].sort((a, b) => {
        const av = a[k] as never;
        const bv = b[k] as never;
        const cmp = av === bv ? 0 : av > bv ? 1 : -1;
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }

  private run(): { data: unknown; error: { message: string; code?: string } | null } {
    const forced = this.failOn?.(this.table, this.op) ?? null;
    if (forced) return { data: null, error: { message: forced } };
    const list = Array.isArray(this.payload) ? this.payload : [this.payload];
    let result: Row[] = [];

    switch (this.op) {
      case "select":
        result = this.matched();
        break;
      case "insert":
        result = list.map((r) => {
          const row = { id: this.newId(), created_at: new Date().toISOString(), ...r };
          this.rows().push(row);
          return row;
        });
        break;
      case "upsert":
        for (const r of list) {
          const existing = this.conflictKeys.length
            ? this.rows().find((x) => this.conflictKeys.every((k) => x[k] === r[k]))
            : undefined;
          if (existing) {
            if (!this.ignoreDuplicates) Object.assign(existing, r);
            result.push(existing);
          } else {
            const row = { id: this.newId(), created_at: new Date().toISOString(), ...r };
            this.rows().push(row);
            result.push(row);
          }
        }
        break;
      case "update":
        result = this.matched();
        for (const r of result) Object.assign(r, this.payload);
        break;
      case "delete": {
        result = this.matched();
        this.db[this.table] = this.rows().filter((r) => !result.includes(r));
        break;
      }
    }

    if (this.mode === "single") {
      if (result.length !== 1) return { data: null, error: { message: "no rows", code: "PGRST116" } };
      return { data: result[0], error: null };
    }
    if (this.mode === "maybe") return { data: result[0] ?? null, error: null };
    return { data: result, error: null };
  }

  then<T1 = unknown, T2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: { message: string; code?: string } | null }) => T1 | PromiseLike<T1>)
      | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    try {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    } catch (e) {
      return Promise.reject(e).then(onfulfilled, onrejected);
    }
  }
}

export interface FakeSupabase {
  db: Tables;
  from: (table: string) => Query;
  rpc: (name: string, args?: Row) => Promise<{ data: unknown; error: null }>;
  rpcCalls: Array<{ name: string; args: Row }>;
}

export function createFakeSupabase(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const db: Tables = JSON.parse(JSON.stringify(seed)) as Tables;
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const newId = options.newId ?? defaultId;

  const client: FakeSupabase = {
    db,
    from: (table: string) => new Query(db, table, newId, options.failOn),
    rpc: async (name: string, args: Row = {}) => {
      rpcCalls.push({ name, args });
      const handler = options.rpc?.[name];
      return { data: handler ? handler(args) : null, error: null };
    },
    rpcCalls,
  };
  return client;
}
