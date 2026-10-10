import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type * as Store from "../src/lib/store";
import type { EwbRecord } from "../src/lib/store";

/** Behaviour both store backends (JSON files, Firestore) must share. */
export function storeContract(name: string, load: () => Promise<typeof Store>) {
  let n = 0;
  const workspaceId = () => `ws_${name}_${Date.now().toString(36)}_${n++}`;
  const bill = (id: string, invoiceId = `inv-${id}`) => ({ id, invoiceId, ewbNumber: `EWB-${id}`, status: "active" } as unknown as EwbRecord);

  describe(`store (${name})`, () => {
    it("creates a workspace and keeps changes to its small fields", async () => {
      const { withWorkspace } = await load();
      const id = workspaceId();
      assert.equal(await withWorkspace(id, (ws) => ws.wallet.balance), 0);
      await withWorkspace(id, (ws) => { ws.wallet.balance = 25; ws.audit.push({ at: "t", actor: "a", action: "x", targetId: "y", outcome: "ok" }); });
      assert.deepEqual(await withWorkspace(id, (ws) => [ws.wallet.balance, ws.audit.length, ws.id]), [25, 1, id]);
    });

    it("stores section records and loads all, some or none of them", async () => {
      const { withWorkspace } = await load();
      const id = workspaceId();
      await withWorkspace(id, (ws) => { ws.ewbs["a"] = bill("a"); ws.ewbs["b"] = bill("b"); ws.ewbs["c/./x"] = bill("c/./x"); }, { ewbs: [] });
      assert.deepEqual(await withWorkspace(id, (ws) => Object.keys(ws.ewbs).sort(), { ewbs: "all" }), ["a", "b", "c/./x"]);
      assert.equal(await withWorkspace(id, (ws) => ws.ewbs["c/./x"]?.ewbNumber, { ewbs: ["c/./x", "missing"] }), "EWB-c/./x");
      assert.equal(await withWorkspace(id, (ws) => ws.ewbs["missing"], { ewbs: ["missing"] }), undefined);
      // Updating one loaded record and deleting another.
      await withWorkspace(id, (ws) => { ws.ewbs["a"]!.status = "cancelled"; delete ws.ewbs["b"]; }, { ewbs: ["a", "b"] });
      const after = await withWorkspace(id, (ws) => Object.values(ws.ewbs).map((e) => `${e.id}:${e.status}`).sort(), { ewbs: "all" });
      assert.deepEqual(after, ["a:cancelled", "c/./x:active"]);
    });

    it("keeps sync collections apart and round-trips any JSON", async () => {
      const { withWorkspace } = await load();
      const id = workspaceId();
      const data = { nested: [[1, 2], { "": null, "a.b": "x" }], text: "₹ 1,000" };
      await withWorkspace(id, (ws) => {
        ws.sync["invoices"] = { "1": { id: "1", updatedAt: "2026-01-01", data } };
        ws.sync["parties"] = { "1": { id: "1", updatedAt: "2026-01-02" } };
      }, { sync: "all" });
      const sync = await withWorkspace(id, (ws) => ws.sync, { sync: "all" });
      assert.deepEqual(sync["invoices"]!["1"]!.data, data);
      assert.equal(sync["parties"]!["1"]!.updatedAt, "2026-01-02");
    });

    it("loads sync records named or changed after `since`, and saves updates to them", async () => {
      const { withWorkspace } = await load();
      const id = workspaceId();
      await withWorkspace(id, (ws) => {
        ws.sync["invoices"] = { old: { id: "old", updatedAt: "2026-01-01T00:00:00.000Z" }, mine: { id: "mine", updatedAt: "2026-01-02T00:00:00.000Z" }, recent: { id: "recent", updatedAt: "2026-03-01T00:00:00.000Z" } };
        ws.sync["parties"] = { p: { id: "p", updatedAt: "2026-03-02T00:00:00.000Z" } };
      }, { sync: "all" });
      const spec = { sync: { keys: ["invoices/mine", "invoices/missing"], since: "2026-02-01T00:00:00.000Z" } };
      const loaded = await withWorkspace(id, (ws) => Object.entries(ws.sync).flatMap(([name, records]) => Object.keys(records).map((key) => `${name}/${key}`)).sort(), spec);
      for (const key of ["invoices/mine", "invoices/recent", "parties/p"]) assert.ok(loaded.includes(key), key);
      if (name === "firestore") assert.deepEqual(loaded, ["invoices/mine", "invoices/recent", "parties/p"]);
      await withWorkspace(id, (ws) => { ws.sync["invoices"]!["mine"] = { id: "mine", updatedAt: "2026-04-01T00:00:00.000Z" }; ws.sync["invoices"]!["new"] = { id: "new", updatedAt: "2026-04-02T00:00:00.000Z" }; }, spec);
      const all = await withWorkspace(id, (ws) => Object.values(ws.sync["invoices"]!).map((r) => `${r.id}@${r.updatedAt.slice(0, 7)}`).sort(), { sync: "all" });
      assert.deepEqual(all, ["mine@2026-04", "new@2026-04", "old@2026-01", "recent@2026-03"]);
      const later = await withWorkspace(id, (ws) => Object.keys(ws.sync["invoices"] ?? {}).sort(), { sync: { keys: [], since: "2026-03-15T00:00:00.000Z" } });
      if (name === "firestore") assert.deepEqual(later, ["mine", "new"]);
    });

    it("refuses sections that were not requested and saves nothing when fn throws", async () => {
      const { withWorkspace } = await load();
      const id = workspaceId();
      await assert.rejects(withWorkspace(id, (ws) => Object.keys(ws.ewbs)), /section "ewbs" was used but not requested/);
      await withWorkspace(id, (ws) => { ws.wallet.balance = 7; });
      await assert.rejects(withWorkspace(id, (ws) => { ws.wallet.balance = 99; throw new Error("boom"); }));
      assert.equal(await withWorkspace(id, (ws) => ws.wallet.balance), 7);
    });

    it("loses no writes under concurrent updates", async () => {
      const { withWorkspace } = await load();
      const id = workspaceId();
      await Promise.all(Array.from({ length: 10 }, (_, i) => withWorkspace(id, async (ws) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        ws.wallet.balance += 1;
        ws.ewbs[`e${i}`] = bill(`e${i}`);
      }, { ewbs: [] })));
      assert.deepEqual(await withWorkspace(id, (ws) => [ws.wallet.balance, Object.keys(ws.ewbs).length], { ewbs: "all" }), [10, 10]);
    });

    it("withDoc creates, updates and deletes a document; readDoc reads it", async () => {
      const { withDoc, readDoc } = await load();
      const doc = workspaceId();
      await withDoc<{ n: number }, null>("t", doc, () => ({ next: { n: 1 }, result: null }));
      assert.deepEqual(await readDoc("t", doc), { n: 1 });
      await withDoc("t", doc, () => ({ next: null, result: null }));
      assert.equal(await readDoc("t", doc), null);
    });

    it("withDoc leaves the document unchanged when the update throws", async () => {
      const { withDoc, readDoc } = await load();
      const doc = workspaceId();
      await withDoc<{ n: number }, null>("t", doc, () => ({ next: { n: 5 }, result: null }));
      await assert.rejects(withDoc("t", doc, () => { throw new Error("boom"); }));
      assert.deepEqual(await readDoc("t", doc), { n: 5 });
    });

    it("withDoc serializes concurrent updates (no lost writes, single consume)", async () => {
      const { withDoc, readDoc } = await load();
      const doc = workspaceId();
      await withDoc<{ n: number }, null>("t", doc, () => ({ next: { n: 0 }, result: null }));
      await Promise.all(Array.from({ length: 10 }, () => withDoc<{ n: number }, null>("t", doc, async (current) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { next: { n: current!.n + 1 }, result: null };
      })));
      assert.deepEqual(await readDoc("t", doc), { n: 10 });
      const grant = `${doc}-grant`;
      await withDoc<{ token: string }, null>("t", grant, () => ({ next: { token: "x" }, result: null }));
      const consumed = await Promise.all([1, 2, 3].map(() => withDoc<{ token: string }, boolean>("t", grant, (current) => ({ next: null, result: current !== null }))));
      assert.equal(consumed.filter(Boolean).length, 1);
    });
  });
}
