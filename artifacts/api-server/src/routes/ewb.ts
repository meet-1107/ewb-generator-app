import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { ewbProvider } from "../providers/ewb-provider";
import { audit, currentPeriod, withWorkspace, type EwbRecord, type Workspace } from "../lib/store";
import { planById } from "../lib/plans";
import { stateFromName, type EwbInput } from "../lib/validation";

const router: IRouter = Router();

const party = z.object({ name: z.string().max(120), gstin: z.string().max(15), address: z.string().max(400), state: z.string().max(60), pincode: z.string().max(6) });
const inputSchema = z.object({
  invoiceId: z.string().min(1).max(80),
  invoiceNumber: z.string().max(40),
  invoiceDate: z.string().max(10),
  documentType: z.string().max(40),
  supplyType: z.enum(["intra", "inter"]),
  seller: party,
  buyer: party,
  lines: z.array(z.object({
    description: z.string().max(200),
    hsn: z.string().max(8),
    quantity: z.string().max(20),
    unit: z.string().max(10),
    taxablePaise: z.number().int().min(0).max(1e13),
    taxRate: z.number().min(0).max(28),
  })).min(1).max(200),
  transport: z.object({
    transporterName: z.string().max(120),
    transporterId: z.string().max(15),
    vehicleNumber: z.string().max(15),
    mode: z.string().max(10),
    distanceKm: z.string().max(5),
    docNumber: z.string().max(20).optional(),
    docDate: z.string().max(10).optional(),
    vehicleType: z.enum(["regular", "odc"]).optional(),
  }),
  totals: z.object({ taxable: z.number(), tax: z.number(), total: z.number() }),
});

function providerMissing(res: Response) {
  return res.status(503).json({ error: "provider_not_configured", message: "EWB provider setup required. You can keep preparing drafts." });
}

/** Re-derives time-based status so clients never see a stale "active". */
export function refreshStatus(record: EwbRecord, now = Date.now()) {
  if (record.status !== "cancelled" && now > Date.parse(record.validUntil)) record.status = "expired";
  return record;
}

function rollUsage(workspace: Workspace) {
  const period = currentPeriod();
  if (workspace.subscription.usagePeriod !== period) {
    workspace.subscription.usagePeriod = period;
    workspace.subscription.usageCount = 0;
  }
}

function normalize(input: EwbInput): EwbInput {
  const upper = (value: string) => value.trim().toUpperCase();
  return {
    ...input,
    seller: { ...input.seller, gstin: upper(input.seller.gstin) },
    buyer: { ...input.buyer, gstin: upper(input.buyer.gstin) || "URP" },
    transport: {
      ...input.transport,
      vehicleNumber: input.transport.vehicleNumber.replace(/[\s-]/g, "").toUpperCase(),
      transporterId: upper(input.transport.transporterId),
    },
  };
}

router.post("/ewb/validate", (req, res) => {
  if (!ewbProvider) return providerMissing(res);
  const parsed = inputSchema.safeParse(req.body?.input);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Some invoice fields could not be read." });
  const result = ewbProvider.validate(normalize(parsed.data));
  return res.json({ ...result, provider: { id: ewbProvider.id, label: ewbProvider.label, sandbox: ewbProvider.sandbox } });
});

router.post("/ewb/generate", async (req, res) => {
  if (!ewbProvider) return providerMissing(res);
  const key = z.string().min(8).max(80).safeParse(req.body?.idempotencyKey);
  const parsed = inputSchema.safeParse(req.body?.input);
  if (!key.success || !parsed.success) return res.status(400).json({ error: "bad_request", message: "Some invoice fields could not be read." });
  const input = normalize(parsed.data);

  // Phase 1: claim the idempotency key and check entitlement/duplicates.
  const claim = await withWorkspace(req.workspaceId, (workspace) => {
    const existing = Object.values(workspace.requests).find((request) => request.idempotencyKey === key.data);
    if (existing?.state === "generated" && existing.ewbId) return { kind: "replay" as const, ewb: workspace.ewbs[existing.ewbId] };
    if (existing?.state === "pending") return { kind: "pending" as const };
    const duplicate = Object.values(workspace.ewbs).find((ewb) => ewb.invoiceId === input.invoiceId && refreshStatus(ewb).status !== "cancelled");
    if (duplicate) return { kind: "duplicate" as const, ewb: duplicate };
    rollUsage(workspace);
    const plan = planById(workspace.subscription.planId);
    if (workspace.subscription.entitlementState === "expired") return { kind: "entitlement" as const, message: "Your plan has expired. Renew to generate new e-way bills; existing records stay available." };
    if (plan.ewbLimit !== null && workspace.subscription.usageCount >= plan.ewbLimit) {
      return { kind: "entitlement" as const, message: `You have used all ${plan.ewbLimit} e-way bills in your ${plan.name} plan this month. Upgrade to continue.` };
    }
    const request = existing ?? { id: randomUUID(), idempotencyKey: key.data, invoiceId: input.invoiceId, state: "pending" as const, createdAt: new Date().toISOString() };
    request.state = "pending";
    workspace.requests[request.id] = request;
    return { kind: "claimed" as const, requestId: request.id };
  });

  if (claim.kind === "replay") return res.json({ ewb: claim.ewb, replay: true });
  if (claim.kind === "pending") return res.status(409).json({ error: "pending", message: "This bill is already being submitted. Wait a moment and refresh." });
  if (claim.kind === "duplicate") return res.status(409).json({ error: "duplicate", message: `This invoice already has e-way bill ${claim.ewb.ewbNumber}.`, ewb: claim.ewb });
  if (claim.kind === "entitlement") return res.status(402).json({ error: "plan_limit", message: claim.message });

  // Phase 2: call the provider outside the workspace lock.
  let result: Awaited<ReturnType<typeof ewbProvider.generate>>;
  try {
    result = await ewbProvider.generate(input);
  } catch {
    await withWorkspace(req.workspaceId, (workspace) => {
      const request = workspace.requests[claim.requestId]!;
      request.state = "rejected";
      request.safeErrorCode = "PROVIDER_UNAVAILABLE";
    });
    return res.status(502).json({ error: "provider_unavailable", message: "The provider did not respond. Nothing was generated; try again.", reference: claim.requestId.slice(0, 8) });
  }

  // Phase 3: record the outcome.
  const outcome = await withWorkspace(req.workspaceId, (workspace) => {
    const request = workspace.requests[claim.requestId]!;
    request.completedAt = new Date().toISOString();
    if (!result.ok) {
      request.state = "rejected";
      request.safeErrorCode = result.code;
      audit(workspace, req.actor, "ewb.generate", input.invoiceId, `rejected:${result.code}`);
      return { ok: false as const, result };
    }
    const now = new Date().toISOString();
    const record: EwbRecord = {
      id: randomUUID(),
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      provider: ewbProvider!.id,
      providerBillId: result.providerBillId,
      ewbNumber: result.ewbNumber,
      status: result.partBPending ? "part_b_pending" : "active",
      generatedAt: result.generatedAt.toISOString(),
      validUntil: result.validUntil.toISOString(),
      validityDays: result.validityDays,
      lastVerifiedAt: now,
      verificationSource: ewbProvider!.label,
      sellerName: input.seller.name,
      sellerGstin: input.seller.gstin,
      buyerName: input.buyer.name,
      buyerGstin: input.buyer.gstin,
      fromState: stateFromName(input.seller.state)?.name ?? input.seller.state,
      toState: stateFromName(input.buyer.state)?.name ?? input.buyer.state,
      totals: input.totals,
      lines: input.lines,
      transport: input.transport,
      history: [{ at: now, action: "Generated", detail: `Valid for ${result.validityDays} day${result.validityDays === 1 ? "" : "s"}` }],
      extensionCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    workspace.ewbs[record.id] = record;
    request.state = "generated";
    request.ewbId = record.id;
    workspace.subscription.usageCount += 1;
    audit(workspace, req.actor, "ewb.generate", record.id, "generated");
    return { ok: true as const, record };
  });

  if (!outcome.ok) {
    const failed = outcome.result as Extract<typeof result, { ok: false }>;
    return res.status(422).json({ error: "rejected", message: failed.message, issues: failed.issues, reference: claim.requestId.slice(0, 8) });
  }
  return res.status(201).json({ ewb: outcome.record });
});

router.get("/ewb", async (req, res) => {
  const ewbs = await withWorkspace(req.workspaceId, (workspace) =>
    Object.values(workspace.ewbs).map((ewb) => refreshStatus(ewb)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
  );
  res.json({ ewbs, provider: ewbProvider ? { id: ewbProvider.id, label: ewbProvider.label, sandbox: ewbProvider.sandbox } : null });
});

router.get("/ewb/:id", async (req, res) => {
  const ewb = await withWorkspace(req.workspaceId, (workspace) => {
    const record = workspace.ewbs[req.params.id];
    if (!record) return null;
    refreshStatus(record);
    record.lastVerifiedAt = new Date().toISOString();
    return record;
  });
  if (!ewb) return res.status(404).json({ error: "not_found", message: "This e-way bill is not in your workspace." });
  return res.json({ ewb });
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().min(1).max(100) }),
  z.object({ action: z.literal("extend"), reason: z.string().min(1).max(100), remainingKm: z.number().int() }),
  z.object({ action: z.literal("update_vehicle"), reason: z.string().min(1).max(100), vehicleNumber: z.string().max(15) }),
]);

router.post("/ewb/:id/actions", async (req, res) => {
  if (!ewbProvider) return providerMissing(res);
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Add a reason and the required details." });
  const body = parsed.data;
  const current = await withWorkspace(req.workspaceId, (workspace) => {
    const record = workspace.ewbs[req.params.id];
    return record ? structuredClone(refreshStatus(record)) : null;
  });
  if (!current) return res.status(404).json({ error: "not_found", message: "This e-way bill is not in your workspace." });
  if (current.status === "cancelled") return res.status(409).json({ error: "cancelled", message: "This bill is cancelled; no further changes are allowed." });

  let result;
  if (body.action === "cancel") result = await ewbProvider.cancel({ generatedAt: new Date(current.generatedAt), reason: body.reason });
  else if (body.action === "extend") result = await ewbProvider.extend({ validUntil: new Date(current.validUntil), distanceKm: Number(current.transport.distanceKm), remainingKm: body.remainingKm, reason: body.reason });
  else {
    if (current.status === "expired") return res.status(409).json({ error: "expired", message: "The vehicle cannot be changed on an expired bill." });
    result = await ewbProvider.updateVehicle({ vehicleNumber: body.vehicleNumber.replace(/[\s-]/g, "").toUpperCase(), reason: body.reason });
  }
  if (!result.ok) return res.status(422).json({ error: result.code, message: result.message });

  const ewb = await withWorkspace(req.workspaceId, (workspace) => {
    const record = workspace.ewbs[req.params.id]!;
    const now = new Date().toISOString();
    if (body.action === "cancel") {
      record.status = "cancelled";
      record.cancelledAt = now;
      record.cancelReason = body.reason;
      record.history.push({ at: now, action: "Cancelled", detail: body.reason });
    } else if (body.action === "extend") {
      record.validUntil = result.validUntil!.toISOString();
      record.status = record.transport.vehicleNumber ? "active" : "part_b_pending";
      record.extensionCount += 1;
      record.history.push({ at: now, action: "Validity extended", detail: `${body.reason} · ${body.remainingKm} km remaining` });
    } else {
      const vehicle = body.vehicleNumber.replace(/[\s-]/g, "").toUpperCase();
      record.history.push({ at: now, action: "Vehicle updated", detail: `${record.transport.vehicleNumber || "None"} → ${vehicle} · ${body.reason}` });
      record.transport = { ...record.transport, vehicleNumber: vehicle };
      if (record.status === "part_b_pending") record.status = "active";
    }
    record.updatedAt = now;
    record.lastVerifiedAt = now;
    audit(workspace, req.actor, `ewb.${body.action}`, record.id, "ok");
    return record;
  });
  return res.json({ ewb });
});

export default router;
