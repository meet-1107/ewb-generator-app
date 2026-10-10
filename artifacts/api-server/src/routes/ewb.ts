import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { ewbProvider, type ProviderContext } from "../providers/ewb-provider";
import { testCredentials } from "../providers/gstinapi-ewb-provider";
import { audit, currentPeriod, withWorkspace, type CewbRecord, type EwbRecord, type Workspace } from "../lib/store";
import { decryptSecret, encryptSecret, secretsConfigured } from "../lib/secrets";
import { holdCredits, refundCredits, settleCredits, walletSummary } from "../lib/wallet";
import { gstinProblem, stateFromName, VEHICLE_PATTERN, type EwbInput } from "../lib/validation";

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
  dispatch: z.object({ address: z.string().max(400), state: z.string().max(60), pincode: z.string().max(6) }).optional(),
  shipTo: z.object({ address: z.string().max(400), state: z.string().max(60), pincode: z.string().max(6) }).optional(),
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

/** Provider context for `gstin`: its decrypted portal login, or null when the provider doesn't need one. */
function contextFor(workspace: Workspace, gstin: string): ProviderContext | { missing: true } {
  if (!ewbProvider?.needsCredentials) return { credentials: null };
  const saved = workspace.ewbCredentials[gstin];
  if (!saved) return { missing: true };
  return { credentials: { gstin, username: saved.username, password: decryptSecret(saved.passwordEnc) } };
}

function credentialsMissing(res: Response, gstin: string) {
  return res.status(428).json({ error: "credentials_missing", gstin, message: `Add the e-way bill portal API login for ${gstin} first (Account → E-way bill portal login).` });
}

function insufficient(res: Response, cost: number, balance: number, what: string) {
  return res.status(402).json({ error: "insufficient_credits", cost, balance, message: `${what} needs ${cost} credits. Your wallet has ${balance}. Add credits to continue.` });
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
  // Requests are stored under their idempotency key.
  const requestKey = key.data;
  const claim = await withWorkspace(req.workspaceId, (workspace) => {
    const existing = workspace.requests[requestKey];
    if (existing?.state === "generated" && existing.ewbId) return { kind: "replay" as const, ewb: workspace.ewbs[existing.ewbId] };
    if (existing?.state === "pending") return { kind: "pending" as const };
    const duplicate = Object.values(workspace.ewbs).find((ewb) => ewb.invoiceId === input.invoiceId && refreshStatus(ewb).status !== "cancelled");
    if (duplicate) return { kind: "duplicate" as const, ewb: duplicate };
    rollUsage(workspace);
    const ctx = contextFor(workspace, input.seller.gstin);
    if ("missing" in ctx) return { kind: "credentials" as const };
    const hold = holdCredits(workspace, "generate", input.invoiceId);
    if (!hold.ok) return { kind: "credits" as const, cost: hold.cost, balance: hold.balance };
    const request = existing ?? { id: randomUUID(), idempotencyKey: requestKey, invoiceId: input.invoiceId, state: "pending" as const, createdAt: new Date().toISOString() };
    request.state = "pending";
    workspace.requests[requestKey] = request;
    return { kind: "claimed" as const, requestId: request.id, holdId: hold.entryId, ctx };
  }, { requests: [requestKey], ewbs: "all" });

  if (claim.kind === "replay") return res.json({ ewb: claim.ewb, replay: true });
  if (claim.kind === "pending") return res.status(409).json({ error: "pending", message: "This bill is already being submitted. Wait a moment and refresh." });
  if (claim.kind === "duplicate") return res.status(409).json({ error: "duplicate", message: `This invoice already has e-way bill ${claim.ewb.ewbNumber}.`, ewb: claim.ewb });
  if (claim.kind === "credentials") return credentialsMissing(res, input.seller.gstin);
  if (claim.kind === "credits") return insufficient(res, claim.cost, claim.balance, "Generating an e-way bill");

  // Phase 2: call the provider outside the workspace lock.
  let result: Awaited<ReturnType<typeof ewbProvider.generate>>;
  try {
    result = await ewbProvider.generate(input, claim.ctx);
  } catch {
    await withWorkspace(req.workspaceId, (workspace) => {
      const request = workspace.requests[requestKey]!;
      request.state = "rejected";
      request.safeErrorCode = "PROVIDER_UNAVAILABLE";
      refundCredits(workspace, claim.holdId, "Provider did not respond");
    }, { requests: [requestKey] });
    return res.status(502).json({ error: "provider_unavailable", message: "The provider did not respond. Nothing was generated; try again.", reference: claim.requestId.slice(0, 8) });
  }

  // Phase 3: record the outcome.
  const outcome = await withWorkspace(req.workspaceId, (workspace) => {
    const request = workspace.requests[requestKey]!;
    request.completedAt = new Date().toISOString();
    if (!result.ok) {
      request.state = "rejected";
      request.safeErrorCode = result.code;
      refundCredits(workspace, claim.holdId, `Rejected: ${result.code}`);
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
    settleCredits(workspace, claim.holdId, { ewbNumber: record.ewbNumber, targetId: record.id });
    audit(workspace, req.actor, "ewb.generate", record.id, "generated");
    return { ok: true as const, record, wallet: walletSummary(workspace).balance };
  }, { requests: [requestKey], ewbs: [] });

  if (!outcome.ok) {
    const failed = outcome.result as Extract<typeof result, { ok: false }>;
    return res.status(422).json({ error: "rejected", message: failed.message, issues: failed.issues, reference: claim.requestId.slice(0, 8) });
  }
  return res.status(201).json({ ewb: outcome.record, balance: outcome.wallet });
});

router.get("/ewb", async (req, res) => {
  const ewbs = await withWorkspace(req.workspaceId, (workspace) =>
    Object.values(workspace.ewbs).map((ewb) => refreshStatus(ewb)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
  { ewbs: "all" });
  res.json({ ewbs, provider: ewbProvider ? { id: ewbProvider.id, label: ewbProvider.label, sandbox: ewbProvider.sandbox } : null });
});

router.get("/ewb/:id", async (req, res) => {
  const ewb = await withWorkspace(req.workspaceId, (workspace) => {
    const record = workspace.ewbs[req.params.id];
    if (!record) return null;
    refreshStatus(record);
    record.lastVerifiedAt = new Date().toISOString();
    return record;
  }, { ewbs: [req.params.id] });
  if (!ewb) return res.status(404).json({ error: "not_found", message: "This e-way bill is not in your workspace." });
  return res.json({ ewb });
});

const movement = { fromPlace: z.string().max(50).optional(), fromState: z.string().max(60).optional() };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().min(1).max(100) }),
  z.object({ action: z.literal("extend"), reason: z.string().min(1).max(100), remainingKm: z.number().int(), fromPincode: z.string().max(6).optional(), ...movement }),
  z.object({ action: z.literal("update_vehicle"), reason: z.string().min(1).max(100), vehicleNumber: z.string().max(15), ...movement }),
]);
const WALLET_ACTION = { cancel: "cancel", extend: "extend", update_vehicle: "part_b" } as const;
const ACTION_NAME = { cancel: "Cancelling an e-way bill", extend: "Extending validity", update_vehicle: "Updating Part-B" } as const;

router.post("/ewb/:id/actions", async (req, res) => {
  if (!ewbProvider) return providerMissing(res);
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Add a reason and the required details." });
  const body = parsed.data;
  const current = await withWorkspace(req.workspaceId, (workspace) => {
    const record = workspace.ewbs[req.params.id];
    return record ? structuredClone(refreshStatus(record)) : null;
  }, { ewbs: [req.params.id] });
  if (!current) return res.status(404).json({ error: "not_found", message: "This e-way bill is not in your workspace." });
  if (current.status === "cancelled") return res.status(409).json({ error: "cancelled", message: "This bill is cancelled; no further changes are allowed." });
  if (body.action === "update_vehicle" && current.status === "expired") return res.status(409).json({ error: "expired", message: "The vehicle cannot be changed on an expired bill." });
  if (body.action === "update_vehicle" && current.consolidatedInto) {
    return res.status(409).json({ error: "consolidated", message: `This bill moves under consolidated bill ${current.consolidatedInto}. Change the vehicle on that trip instead.` });
  }

  const hold = await withWorkspace(req.workspaceId, (workspace) => {
    const ctx = contextFor(workspace, current.sellerGstin);
    if ("missing" in ctx) return { kind: "credentials" as const };
    const held = holdCredits(workspace, WALLET_ACTION[body.action], current.id);
    if (!held.ok) return { kind: "credits" as const, cost: held.cost, balance: held.balance };
    return { kind: "held" as const, holdId: held.entryId, ctx };
  });
  if (hold.kind === "credentials") return credentialsMissing(res, current.sellerGstin);
  if (hold.kind === "credits") return insufficient(res, hold.cost, hold.balance, ACTION_NAME[body.action]);

  const where = { fromPlace: ("fromPlace" in body && body.fromPlace?.trim()) || current.fromState, fromState: ("fromState" in body && body.fromState) || current.fromState, transMode: current.transport.mode, transDocNo: current.transport.docNumber, transDocDate: current.transport.docDate };
  let result;
  try {
    if (body.action === "cancel") result = await ewbProvider.cancel({ ewbNumber: current.ewbNumber, generatedAt: new Date(current.generatedAt), reason: body.reason }, hold.ctx);
    else if (body.action === "extend") result = await ewbProvider.extend({ ewbNumber: current.ewbNumber, validUntil: new Date(current.validUntil), distanceKm: Number(current.transport.distanceKm), remainingKm: body.remainingKm, reason: body.reason, vehicleNumber: current.transport.vehicleNumber, fromPincode: body.fromPincode, ...where }, hold.ctx);
    else result = await ewbProvider.updateVehicle({ ewbNumber: current.ewbNumber, vehicleNumber: body.vehicleNumber.replace(/[\s-]/g, "").toUpperCase(), reason: body.reason, ...where }, hold.ctx);
  } catch {
    result = { ok: false as const, code: "PROVIDER_UNAVAILABLE", message: "The provider did not respond. Nothing was changed; try again." };
  }
  if (!result.ok) {
    await withWorkspace(req.workspaceId, (workspace) => refundCredits(workspace, hold.holdId, `Rejected: ${result.code}`));
    return res.status(422).json({ error: result.code, message: result.message });
  }

  const ewb = await withWorkspace(req.workspaceId, (workspace) => {
    const record = workspace.ewbs[req.params.id]!;
    const now = new Date().toISOString();
    settleCredits(workspace, hold.holdId, { ewbNumber: record.ewbNumber, targetId: record.id });
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
      if (result.validUntil) record.validUntil = result.validUntil.toISOString();
      if (record.status === "part_b_pending") record.status = "active";
    }
    record.updatedAt = now;
    record.lastVerifiedAt = now;
    audit(workspace, req.actor, `ewb.${body.action}`, record.id, "ok");
    return { record, balance: workspace.wallet.balance };
  }, { ewbs: [req.params.id] });
  return res.json({ ewb: ewb.record, balance: ewb.balance });
});

/* ---------- Consolidated e-way bills ---------- */

const consolidateSchema = z.object({
  ewbIds: z.array(z.string().min(1).max(80)).min(1).max(100),
  vehicleNumber: z.string().min(1).max(15),
  fromPlace: z.string().min(1).max(50),
  fromState: z.string().min(1).max(60),
  transMode: z.enum(["Road", "Rail", "Air", "Ship"]).default("Road"),
  transDocNo: z.string().max(20).optional(),
  transDocDate: z.string().max(10).optional(),
});

router.get("/ewb-consolidated", async (req, res) => {
  const cewbs = await withWorkspace(req.workspaceId, (workspace) => Object.values(workspace.cewbs).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)), { cewbs: "all" });
  res.json({ cewbs });
});

router.post("/ewb-consolidated", async (req, res) => {
  if (!ewbProvider) return providerMissing(res);
  const parsed = consolidateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Choose bills and add the vehicle, place and state." });
  const body = { ...parsed.data, vehicleNumber: parsed.data.vehicleNumber.replace(/[\s-]/g, "").toUpperCase(), ewbIds: [...new Set(parsed.data.ewbIds)] };
  if (body.transMode === "Road" && !VEHICLE_PATTERN.test(body.vehicleNumber)) return res.status(400).json({ error: "vehicle_format", message: "Vehicle number format looks wrong (example: MH12AB1234)." });
  if (!stateFromName(body.fromState)) return res.status(400).json({ error: "bad_request", message: "Choose the state the vehicle starts from." });

  const claim = await withWorkspace(req.workspaceId, (workspace) => {
    const bills = body.ewbIds.map((id) => workspace.ewbs[id]);
    if (bills.some((bill) => !bill)) return { kind: "error" as const, status: 404, message: "Some selected bills are not in your workspace." };
    const records = bills.map((bill) => refreshStatus(bill!));
    const unusable = records.find((bill) => bill.status === "cancelled" || bill.status === "expired");
    if (unusable) return { kind: "error" as const, status: 409, message: `${unusable.ewbNumber} is ${unusable.status}; only active bills can be consolidated.` };
    const gstins = new Set(records.map((bill) => bill.sellerGstin));
    if (gstins.size > 1) return { kind: "error" as const, status: 409, message: "Consolidate bills from one GSTIN at a time." };
    const gstin = records[0]!.sellerGstin;
    const ctx = contextFor(workspace, gstin);
    if ("missing" in ctx) return { kind: "credentials" as const, gstin };
    const held = holdCredits(workspace, "consolidate");
    if (!held.ok) return { kind: "credits" as const, cost: held.cost, balance: held.balance };
    return { kind: "held" as const, holdId: held.entryId, ctx, ewbNumbers: records.map((bill) => bill.ewbNumber) };
  }, { ewbs: body.ewbIds });
  if (claim.kind === "error") return res.status(claim.status).json({ error: "not_allowed", message: claim.message });
  if (claim.kind === "credentials") return credentialsMissing(res, claim.gstin);
  if (claim.kind === "credits") return insufficient(res, claim.cost, claim.balance, "A consolidated e-way bill");

  let result;
  try {
    result = await ewbProvider.consolidate({ ewbNumbers: claim.ewbNumbers, vehicleNumber: body.vehicleNumber, fromPlace: body.fromPlace.trim(), fromState: body.fromState, transMode: body.transMode, transDocNo: body.transDocNo, transDocDate: body.transDocDate }, claim.ctx);
  } catch {
    result = { ok: false as const, code: "PROVIDER_UNAVAILABLE", message: "The provider did not respond. Nothing was created; try again." };
  }
  if (!result.ok) {
    await withWorkspace(req.workspaceId, (workspace) => refundCredits(workspace, claim.holdId, `Rejected: ${result.code}`));
    return res.status(422).json({ error: result.code, message: result.message });
  }

  const saved = await withWorkspace(req.workspaceId, (workspace) => {
    const now = new Date().toISOString();
    const cewb: CewbRecord = {
      id: randomUUID(),
      cewbNumber: result.cewbNumber,
      provider: ewbProvider!.id,
      ewbIds: body.ewbIds,
      ewbNumbers: claim.ewbNumbers,
      vehicleNumber: body.vehicleNumber,
      fromPlace: body.fromPlace.trim(),
      fromState: stateFromName(body.fromState)!.name,
      transMode: body.transMode,
      transDocNo: body.transDocNo,
      transDocDate: body.transDocDate,
      generatedAt: result.generatedAt.toISOString(),
      createdAt: now,
    };
    workspace.cewbs[cewb.id] = cewb;
    for (const id of body.ewbIds) {
      const record = workspace.ewbs[id]!;
      record.consolidatedInto = cewb.cewbNumber;
      record.transport = { ...record.transport, vehicleNumber: body.vehicleNumber };
      if (record.status === "part_b_pending") record.status = "active";
      record.history.push({ at: now, action: "Consolidated", detail: `Moved under consolidated bill ${cewb.cewbNumber} · vehicle ${body.vehicleNumber}` });
      record.updatedAt = now;
    }
    settleCredits(workspace, claim.holdId, { ewbNumber: cewb.cewbNumber, targetId: cewb.id });
    audit(workspace, req.actor, "ewb.consolidate", cewb.id, "ok");
    return { cewb, balance: workspace.wallet.balance };
  }, { cewbs: [], ewbs: body.ewbIds });
  return res.status(201).json(saved);
});

/* ---------- E-way bill portal API login (per GSTIN) ---------- */

router.get("/ewb-credentials", async (req, res) => {
  const credentials = await withWorkspace(req.workspaceId, (workspace) =>
    Object.values(workspace.ewbCredentials).map(({ gstin, username, updatedAt }) => ({ gstin, username, updatedAt })),
  );
  res.json({ credentials, required: Boolean(ewbProvider?.needsCredentials), canStore: secretsConfigured });
});

router.put("/ewb-credentials", async (req, res) => {
  const parsed = z.object({ gstin: z.string().length(15), username: z.string().min(1).max(60), password: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Enter the GSTIN, API username and password." });
  const gstin = parsed.data.gstin.toUpperCase();
  if (gstinProblem(gstin)) return res.status(400).json({ error: "bad_request", message: gstinProblem(gstin) });
  if (!secretsConfigured) return res.status(503).json({ error: "not_configured", message: "The server cannot store passwords securely yet (EWB_CREDENTIALS_SECRET is not set)." });
  // Check the login with the portal first so a typo is caught now, not at generation.
  let check: { valid: boolean | null; message: string } = { valid: null, message: "" };
  if (ewbProvider?.id === "gstinapi") {
    try {
      check = await testCredentials({ gstin, username: parsed.data.username.trim(), password: parsed.data.password });
    } catch {
      check = { valid: null, message: "Could not check the login right now; it was saved and will be checked on first use." };
    }
    if (check.valid === false) return res.status(400).json({ error: "credentials_invalid", message: `The portal refused this login: ${check.message}` });
  }
  const saved = await withWorkspace(req.workspaceId, (workspace) => {
    const updatedAt = new Date().toISOString();
    workspace.ewbCredentials[gstin] = { gstin, username: parsed.data.username.trim(), passwordEnc: encryptSecret(parsed.data.password), updatedAt };
    audit(workspace, req.actor, "ewb.credentials.save", gstin, "ok");
    return { gstin, username: parsed.data.username.trim(), updatedAt };
  });
  return res.json({ credential: saved, checked: check.valid === true, message: check.message });
});

router.delete("/ewb-credentials/:gstin", async (req, res) => {
  const gstin = req.params.gstin.toUpperCase();
  await withWorkspace(req.workspaceId, (workspace) => {
    delete workspace.ewbCredentials[gstin];
    audit(workspace, req.actor, "ewb.credentials.delete", gstin, "ok");
  });
  return res.json({ ok: true });
});

export default router;
