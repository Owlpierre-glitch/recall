import { PostgresStore } from "./pg-store.ts";
import type { Store } from "./types.ts";

export { InMemoryStore } from "./memory-store.ts";
export { PostgresStore } from "./pg-store.ts";
export type { Store, NewTurn } from "./types.ts";

export class ConfigurationError extends Error {
  readonly code = "MISSING_DATABASE_URL";
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// Next reloads modules on every edit in development. Without this the app opens
// a new connection pool per edit and exhausts the database's connection limit
// after a few minutes of work.
const globalForStore = globalThis as unknown as { recallStore?: Store };

export function getStore(): Store {
  if (globalForStore.recallStore) return globalForStore.recallStore;

  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new ConfigurationError(
      "DATABASE_URL is not set, so there is nowhere to store or read memories. Set it to your Postgres connection string and run npm run migrate.",
    );
  }

  const store = new PostgresStore(url.trim());
  globalForStore.recallStore = store;
  return store;
}
