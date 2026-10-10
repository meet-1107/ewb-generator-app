import { AsyncLocalStorage } from "node:async_hooks";

/** Who a piece of work is for, so provider calls deep inside it can be logged against the right account. */
export type RequestContext = { workspaceId?: string; requestId?: string; invoiceId?: string; ewbId?: string };

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current request's context (a mutable object; empty outside a request). */
export function currentContext(): RequestContext {
  return storage.getStore() ?? {};
}
