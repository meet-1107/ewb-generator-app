import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-store-"));
const { withDoc } = await import("../src/lib/store");

describe("withDoc", () => {
  it("creates, updates and deletes a document", async () => {
    await withDoc<{ n: number }, null>("t", "a", () => ({ next: { n: 1 }, result: null }));
    const read = await withDoc<{ n: number }, number | null>("t", "a", (current) => ({ next: current, result: current?.n ?? null }));
    assert.equal(read, 1);
    await withDoc("t", "a", () => ({ next: null, result: null }));
    assert.equal(await withDoc<{ n: number }, boolean>("t", "a", (current) => ({ next: current, result: current === null })), true);
  });

  it("leaves the document unchanged when the update throws", async () => {
    await withDoc<{ n: number }, null>("t", "b", () => ({ next: { n: 5 }, result: null }));
    await assert.rejects(withDoc("t", "b", () => { throw new Error("boom"); }));
    assert.equal(await withDoc<{ n: number }, number>("t", "b", (current) => ({ next: current, result: current!.n })), 5);
  });

  it("serializes concurrent updates (no lost writes, single consume)", async () => {
    await withDoc<{ n: number }, null>("t", "c", () => ({ next: { n: 0 }, result: null }));
    await Promise.all(Array.from({ length: 25 }, () => withDoc<{ n: number }, null>("t", "c", async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { next: { n: current!.n + 1 }, result: null };
    })));
    assert.equal(await withDoc<{ n: number }, number>("t", "c", (current) => ({ next: current, result: current!.n })), 25);
    await withDoc<{ token: string }, null>("t", "grant", () => ({ next: { token: "x" }, result: null }));
    const consumed = await Promise.all([1, 2, 3].map(() => withDoc<{ token: string }, boolean>("t", "grant", (current) => ({ next: null, result: current !== null }))));
    assert.equal(consumed.filter(Boolean).length, 1);
  });
});
