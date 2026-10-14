import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** Billing invoices for credit purchases. Sandbox auth and instant sandbox purchases, JSON-file store. */
let server: Server;
let base = "";
const call = (pathname: string, workspace: string, body?: unknown) =>
  fetch(`${base}/api${pathname}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspace }, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-billing-"));
  delete process.env["RAZORPAY_KEY_ID"];
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

describe("Billing invoices", () => {
  it("numbers paid purchases in one series per financial year and lists them newest first", async () => {
    const { financialYear } = await import("../src/lib/billing");
    const fy = financialYear(new Date().toISOString());
    const first = await (await call("/wallet/purchase", "billing-user-1", { credits: 100 })).json() as { purchase: { id: string; invoiceNumber?: string } };
    const second = await (await call("/wallet/purchase", "billing-user-2", { credits: 250 })).json() as { purchase: { id: string; invoiceNumber?: string } };
    assert.match(first.purchase.invoiceNumber ?? "", new RegExp(`^EWE/${fy}/\\d{4}$`));
    const serial = (number?: string) => Number(number?.split("/").pop());
    assert.equal(serial(second.purchase.invoiceNumber), serial(first.purchase.invoiceNumber) + 1);

    const third = await (await call("/wallet/purchase", "billing-user-1", { credits: 50 })).json() as { purchase: { invoiceNumber?: string } };
    const list = await (await call("/wallet/invoices", "billing-user-1")).json() as { invoices: { number: string; credits: number }[]; payments: { status: string }[] };
    assert.deepEqual(list.invoices.map((invoice) => invoice.number), [third.purchase.invoiceNumber, first.purchase.invoiceNumber]);
    assert.equal(list.payments.length, 2);
  });

  it("returns the printable invoice only to its own account", async () => {
    const bought = await (await call("/wallet/purchase", "billing-user-3", { credits: 120 })).json() as { purchase: { id: string; invoiceNumber: string } };
    const own = await (await call(`/wallet/invoices/${bought.purchase.id}`, "billing-user-3")).json() as { invoice: { number: string; amountPaise: number }; html: string };
    assert.equal(own.invoice.number, bought.purchase.invoiceNumber);
    assert.ok(own.html.includes(bought.purchase.invoiceNumber));
    assert.ok(own.html.includes("E-Way"));
    assert.equal((await call(`/wallet/invoices/${bought.purchase.id}`, "billing-user-4")).status, 404);
  });

  it("writes amounts in Indian words", async () => {
    const { amountInWords } = await import("../src/lib/billing");
    assert.equal(amountInWords(11_800_050), "One Lakh Eighteen Thousand Rupees and Fifty Paise Only");
  });
});
