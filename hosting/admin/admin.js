/* E-Way Easy admin panel. Reads and changes go through /api/admin, which checks the admin role on every call. */
(() => {
  "use strict";

  const API = "/api/admin";
  const app = document.getElementById("app");
  const dialog = document.getElementById("dialog");
  const toastBox = document.getElementById("toast");
  let auth = null;
  let me = null;
  let range = loadRange();

  /* ---------- DOM helpers (text is always set as text, never as HTML) ---------- */

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "html") throw new Error("no raw HTML");
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const svg = (tag, attrs, ...children) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    for (const child of children.flat()) if (child) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  };

  /** Replaces a node's children; nested arrays are flattened and empty values skipped. */
  function put(node, ...children) {
    node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false).map((child) => (child instanceof Node ? child : document.createTextNode(String(child)))));
  }

  function toast(message) {
    toastBox.textContent = message;
    toastBox.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastBox.classList.remove("show"), 3200);
  }

  /* ---------- Formatting ---------- */

  const inr = (paise) => (paise === null || paise === undefined ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100));
  const num = (value) => (value === null || value === undefined ? "—" : new Intl.NumberFormat("en-IN").format(value));
  const pct = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
  const ms = (value) => (value === null || value === undefined ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`);
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");

  const TONES = {
    active: "good", paid: "good", ok: "good", generated: "good", credited: "good", charged: "info", part_b_pending: "warn", created: "warn", pending: "warn", held: "warn",
    expired: "warn", unknown: "warn", cancelled: "", refunded: "", rejected: "bad", timeout: "bad", network: "bad", provider_down: "bad", auth: "bad", rate_limited: "warn", quota: "bad", error: "bad", not_found: "warn",
    high: "bad", medium: "warn", low: "info", suspended: "bad", verified: "good", unverified: "warn",
  };
  const LABELS = { part_b_pending: "Part-B pending", created: "pending", provider_down: "provider down", rate_limited: "rate limited", not_found: "not found" };
  const badge = (value, label) => h("span", { class: `badge ${TONES[value] ?? ""}` }, label ?? LABELS[value] ?? value ?? "—");

  /** Steps of buying credits the app reports, in words and tone. */
  const STEP_LABELS = {
    wallet_opened: ["Opened wallet", ""], checkout_opened: ["Opened checkout", "info"], checkout_closed: ["Closed checkout (went back)", "warn"],
    payment_page_opened: ["Opened payment page", "info"], returned_paid: ["Came back · paid", "good"], returned_unpaid: ["Came back without paying", "bad"], payment_error: ["Payment error", "bad"],
  };
  const stepBadge = (step) => h("span", { class: `badge ${(STEP_LABELS[step] ?? [])[1] ?? ""}` }, (STEP_LABELS[step] ?? [])[0] ?? step ?? "—");
  const OUTCOME_TONES = { Paid: "good", "Came back without paying": "bad", "Expired unpaid": "warn", Cancelled: "", "On payment page (no result yet)": "warn", "Link created": "warn" };
  const outcomeBadge = (outcome) => h("span", { class: `badge ${OUTCOME_TONES[outcome] ?? ""}` }, outcome || "—");

  /* ---------- Date range (India time) ---------- */

  function istDate(offsetDays = 0) {
    const now = new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000);
    return now.toISOString().slice(0, 10);
  }
  const startOf = (date) => new Date(`${date}T00:00:00+05:30`).toISOString();
  const endOf = (date) => new Date(`${date}T23:59:59.999+05:30`).toISOString();
  const PRESETS = {
    today: () => [istDate(), istDate()],
    yesterday: () => [istDate(-1), istDate(-1)],
    "7d": () => [istDate(-6), istDate()],
    "30d": () => [istDate(-29), istDate()],
    month: () => [`${istDate().slice(0, 8)}01`, istDate()],
    lastMonth: () => {
      const first = new Date(`${istDate().slice(0, 8)}01T00:00:00Z`);
      const last = new Date(first.getTime() - 86_400_000);
      return [`${last.toISOString().slice(0, 8)}01`, last.toISOString().slice(0, 10)];
    },
  };
  const PRESET_LABELS = { today: "Today", yesterday: "Yesterday", "7d": "7 days", "30d": "30 days", month: "This month", lastMonth: "Last month", custom: "Custom" };
  function loadRange() {
    try {
      const saved = JSON.parse(localStorage.getItem("admin-range") || "null");
      if (saved && (PRESETS[saved.preset] || saved.preset === "custom")) return saved;
    } catch { /* storage unavailable */ }
    return { preset: "30d" };
  }
  function rangeDates() {
    if (range.preset === "custom" && range.fromDate && range.toDate) return [range.fromDate, range.toDate];
    return (PRESETS[range.preset] || PRESETS["30d"])();
  }
  function rangeQuery() {
    const [from, to] = rangeDates();
    return `from=${encodeURIComponent(startOf(from))}&to=${encodeURIComponent(endOf(to))}`;
  }
  const rangeText = () => { const [from, to] = rangeDates(); return from === to ? day(startOf(from)) : `${day(startOf(from))} – ${day(startOf(to))}`; };

  function rangePicker(onChange) {
    const wrap = h("div", { class: "filters", style: "margin:0" });
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Date range" });
    for (const key of Object.keys(PRESET_LABELS)) {
      seg.append(h("button", { type: "button", "aria-pressed": range.preset === key ? "true" : "false", onclick: () => {
        range = { ...range, preset: key };
        if (key === "custom" && !range.fromDate) { const [from, to] = PRESETS["30d"](); range.fromDate = from; range.toDate = to; }
        save(); onChange();
      } }, PRESET_LABELS[key]));
    }
    wrap.append(seg);
    if (range.preset === "custom") {
      const from = h("input", { class: "input", type: "date", value: range.fromDate, "aria-label": "From", onchange: (e) => { range.fromDate = e.target.value; save(); onChange(); } });
      const to = h("input", { class: "input", type: "date", value: range.toDate, "aria-label": "To", onchange: (e) => { range.toDate = e.target.value; save(); onChange(); } });
      wrap.append(from, to);
    }
    function save() { try { localStorage.setItem("admin-range", JSON.stringify(range)); } catch { /* ignore */ } }
    return wrap;
  }

  /* ---------- API ---------- */

  class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }

  async function api(path, options = {}, retried = false) {
    const user = auth.currentUser;
    if (!user) throw new ApiError("Signed out.", 401, "auth_required");
    const token = await user.getIdToken();
    let response;
    try {
      response = await fetch(`${API}${path}`, { method: options.method || (options.body ? "POST" : "GET"), headers: { authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
    } catch {
      throw new ApiError("Could not reach the server. Check your connection.", 0, "offline");
    }
    if (options.raw && response.ok) return response;
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.error === "reauth_required" && !retried) {
      await reauthenticate();
      return api(path, options, true);
    }
    if (!response.ok) throw new ApiError(data.message || `Request failed (${response.status}).`, response.status, data.error);
    return data;
  }

  async function reauthenticate() {
    const user = auth.currentUser;
    const google = user.providerData.some((item) => item.providerId === "google.com");
    const ok = await confirmDialog({ title: "Confirm it's you", body: "Changes like credit adjustments need a fresh sign-in. Sign in again to continue.", confirm: "Sign in again" });
    if (!ok) throw new ApiError("Cancelled.", 401, "reauth_cancelled");
    if (google) {
      await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    } else {
      const password = await promptDialog({ title: "Enter your password", label: `Password for ${user.email}`, type: "password" });
      if (!password) throw new ApiError("Cancelled.", 401, "reauth_cancelled");
      await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
    }
    await user.getIdToken(true);
  }

  async function download(path, name) {
    const response = await api(path, { raw: true });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- Dialogs ---------- */

  function confirmDialog({ title, body, confirm = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      put(dialog, h("form", { method: "dialog" },
        h("h2", {}, title), h("p", { style: "margin:0;color:var(--text-2)" }, body),
        h("div", { class: "actions" }, h("button", { class: "btn", value: "no" }, "Cancel"), h("button", { class: `btn ${danger ? "danger" : "primary"}`, value: "yes" }, confirm))));
      dialog.onclose = () => resolve(dialog.returnValue === "yes");
      dialog.showModal();
    });
  }

  function promptDialog({ title, label, type = "text" }) {
    return new Promise((resolve) => {
      const input = h("input", { class: "input", type, required: true, autocomplete: type === "password" ? "current-password" : "off" });
      put(dialog, h("form", { method: "dialog" }, h("h2", {}, title), h("label", {}, label, input),
        h("div", { class: "actions" }, h("button", { class: "btn", value: "no", formnovalidate: true }, "Cancel"), h("button", { class: "btn primary", value: "yes" }, "Continue"))));
      dialog.onclose = () => resolve(dialog.returnValue === "yes" ? input.value : null);
      dialog.showModal();
      input.focus();
    });
  }

  function formDialog({ title, fields, submit, danger = false, intro }) {
    return new Promise((resolve) => {
      const inputs = fields.map((field) => {
        const input = field.options
          ? h("select", { class: "input", name: field.name }, field.options.map(([value, label]) => h("option", { value, selected: value === field.value }, label)))
          : h("input", { class: "input", name: field.name, type: field.type || "text", required: field.required !== false, min: field.min, max: field.max, minlength: field.minlength, placeholder: field.placeholder || "", value: field.value ?? "" });
        return { field, input };
      });
      put(dialog, h("form", { method: "dialog" }, h("h2", {}, title), intro ? h("p", { style: "margin:0;color:var(--text-2)" }, intro) : null,
        inputs.map(({ field, input }) => h("label", {}, field.label, input)),
        h("div", { class: "actions" }, h("button", { class: "btn", value: "no", formnovalidate: true }, "Cancel"), h("button", { class: `btn ${danger ? "danger" : "primary"}`, value: "yes" }, submit))));
      dialog.onclose = () => resolve(dialog.returnValue === "yes" ? Object.fromEntries(inputs.map(({ field, input }) => [field.name, input.value])) : null);
      dialog.showModal();
    });
  }

  /* ---------- Building blocks ---------- */

  const tile = (label, value, sub) => h("div", { class: "tile" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), sub ? h("div", { class: "sub" }, sub) : null);
  const loading = () => h("div", { class: "grid kpis" }, Array.from({ length: 6 }, () => h("div", { class: "skeleton" })));
  const errorBox = (error, retry) => h("div", { class: "notice bad" }, error.message || "Something went wrong.", " ", retry ? h("button", { class: "btn small", onclick: retry }, "Retry") : null);

  function table(columns, rows, { onRow, empty = "Nothing here yet." } = {}) {
    if (!rows.length) return h("div", { class: "table-wrap" }, h("div", { class: "empty" }, empty));
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, columns.map((column) => h("th", { class: column.num ? "num" : "", scope: "col" }, column.label)))),
      h("tbody", {}, rows.map((row) => h("tr", { class: onRow ? "link" : "", tabindex: onRow ? "0" : null, onclick: onRow ? () => onRow(row) : null, onkeydown: onRow ? (e) => { if (e.key === "Enter") onRow(row); } : null },
        columns.map((column) => h("td", { class: [column.num ? "num" : "", column.wrap ? "wrap" : "", column.mono ? "mono" : ""].join(" ") }, column.render ? column.render(row) : row[column.key] ?? "—")))))));
  }

  function pager(result, go) {
    return h("div", { class: "pager" }, `${num(result.total)} result${result.total === 1 ? "" : "s"} · page ${result.page} of ${result.pages}`,
      h("div", { class: "filters", style: "margin:0" },
        h("button", { class: "btn small", disabled: result.page <= 1, onclick: () => go(result.page - 1) }, "Previous"),
        h("button", { class: "btn small", disabled: result.page >= result.pages, onclick: () => go(result.page + 1) }, "Next")));
  }

  /** One series of daily values as columns, with a hover tooltip and a screen-reader table. */
  function dayChart(title, points, format) {
    // Drawn at about the size it is shown, so 11px labels stay 11px.
    const width = 340;
    const height = 180;
    const pad = { top: 12, right: 6, bottom: 22, left: 40 };
    const max = Math.max(1, ...points.map((point) => point.value));
    const step = niceStep(max / 3);
    const top = Math.ceil(max / step) * step;
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const slot = plotW / Math.max(1, points.length);
    const barW = Math.min(24, Math.max(2, slot - 2));
    const y = (value) => pad.top + plotH - (value / top) * plotH;
    const tip = h("div", { class: "tooltip" });
    const node = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": title });
    for (let value = 0; value <= top; value += step) {
      node.append(svg("line", { class: "gridline", x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value) }));
      node.append(svg("text", { class: "tick", x: pad.left - 6, y: y(value) + 4, "text-anchor": "end" }, compact(value, format)));
    }
    const labelEvery = Math.ceil(points.length / 5);
    points.forEach((point, index) => {
      const x = pad.left + index * slot + (slot - barW) / 2;
      const barH = Math.max(0, y(0) - y(point.value));
      const r = Math.min(4, barW / 2, barH);
      // Rounded at the data end only, square at the baseline.
      const d = barH > 0 ? `M${x},${y(0)} V${y(point.value) + r} Q${x},${y(point.value)} ${x + r},${y(point.value)} H${x + barW - r} Q${x + barW},${y(point.value)} ${x + barW},${y(point.value) + r} V${y(0)} Z` : "";
      const hit = svg("rect", { class: "bar-hit", x: pad.left + index * slot, y: pad.top, width: slot, height: plotH });
      const bar = svg("path", { class: "bar", d });
      hit.addEventListener("mouseenter", () => {
        bar.classList.add("active");
        tip.textContent = `${day(startOf(point.day))}: ${format ? format(point.value) : num(point.value)}`;
        const box = node.getBoundingClientRect();
        tip.style.left = `${((x + barW / 2) / width) * box.width}px`;
        tip.style.top = `${(y(point.value) / height) * box.height}px`;
        tip.style.opacity = "1";
      });
      hit.addEventListener("mouseleave", () => { bar.classList.remove("active"); tip.style.opacity = "0"; });
      node.append(hit, bar);
      if (index % labelEvery === 0) node.append(svg("text", { class: "tick", x: x + barW / 2, y: height - 6, "text-anchor": "middle" }, new Date(startOf(point.day)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })));
    });
    const total = points.reduce((sum, point) => sum + point.value, 0);
    return h("div", { class: "card" }, h("h2", {}, title), h("div", { class: "note", style: "margin:-6px 0 8px" }, `Total ${format ? format(total) : num(total)} · ${rangeText()}`),
      h("div", { class: "chart" }, node, tip),
      h("table", { class: "sr-only" }, h("caption", {}, title), h("tbody", {}, points.map((point) => h("tr", {}, h("th", {}, point.day), h("td", {}, format ? format(point.value) : point.value))))));
  }
  function niceStep(raw) {
    const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
    return [1, 2, 5, 10].map((m) => m * power).find((value) => value >= raw) || power * 10;
  }
  function compact(value, format) {
    if (format === inr) value = value / 100;
    const prefix = format === inr ? "₹" : "";
    return value >= 100000 ? `${prefix}${(value / 100000).toFixed(1)}L` : value >= 1000 ? `${prefix}${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K` : `${prefix}${value}`;
  }

  /* ---------- Pages ---------- */

  const NAV = [
    { group: "Monitor" },
    { id: "overview", label: "Overview", permission: "overview" },
    { id: "activity", label: "Active users", permission: "users" },
    { id: "users", label: "Users & businesses", permission: "users" },
    { id: "ewbs", label: "E-way bills", permission: "ewbs" },
    { id: "api", label: "API usage & quota", permission: "api" },
    { group: "Money" },
    { id: "payments", label: "Payments", permission: "payments" },
    { id: "credits", label: "Application credits", permission: "credits" },
    { id: "reconciliation", label: "Reconciliation", permission: "reconcile" },
    { group: "Admin" },
    { id: "reports", label: "Reports & export", permission: "export" },
    { id: "audit", label: "Audit log", permission: "audit" },
    { id: "settings", label: "Settings & health", permission: "health" },
    { id: "admins", label: "Admins & roles", permission: "admins" },
  ];
  const canDo = (permission) => me && me.permissions.includes(permission);

  const pages = {
    async overview(view) {
      view.append(head("Overview", "Live totals from accounts, wallets, e-way bills and API logs.", rangePicker(render)));
      const body = h("div", {}, loading());
      view.append(body);
      const o = await api(`/overview?${rangeQuery()}`);
      put(body, 
        notesFor(o),
        h("h3", {}, "Users"),
        h("div", { class: "grid kpis" }, tile("Registered users", num(o.users.total), `${num(o.users.newInRange)} new in period`), tile("Verified email", num(o.users.verified), `${num(o.users.unverified)} unverified`),
          tile("New today", num(o.users.newToday), `${num(o.users.new7d)} in 7 days · ${num(o.users.new30d)} in 30`), tile("Signed in during period", num(o.users.signedInInRange), "by last sign-in"),
          tile("Suspended", num(o.users.suspended)), tile("Never made a bill", num(o.users.neverGenerated))),
        h("h3", { class: "section" }, "E-way bills"),
        h("div", { class: "grid kpis" }, tile("Generated in period", num(o.ewbs.generated), `${num(o.ewbs.allTime)} all time`), tile("Generated today", num(o.ewbs.today)),
          tile("Still active", num(o.ewbs.active), `${num(o.ewbs.partBPending)} Part-B pending`), tile("Cancelled", num(o.ewbs.cancelled), `${num(o.ewbs.expired)} expired`),
          tile("Generation success rate", pct(o.ewbs.successRate), `${num(o.ewbs.failedAttempts)} failed of ${num(o.ewbs.attempts)} attempts`)),
        o.api ? [h("h3", { class: "section" }, "Provider API"), h("div", { class: "grid kpis" }, tile("API requests", num(o.api.total), `${num(o.api.testMode)} in test mode`), tile("Failed", num(o.api.failed), `error rate ${pct(o.api.errorRate)}`),
          tile("Timeouts", num(o.api.timeouts), `${num(o.api.rateLimited)} rate-limited`), tile("Avg response", ms(o.api.avgMs), `p95 ${ms(o.api.p95Ms)}`), quotaTile(o.quota))] : null,
        o.credits ? [h("h3", { class: "section" }, "Application credits"), h("div", { class: "grid kpis" }, tile("Bought in period", num(o.credits.purchased)), tile("Welcome / promo", num(o.credits.granted), `+${num(o.credits.adjustedIn)} / −${num(o.credits.adjustedOut)} adjusted`),
          tile("Consumed", num(o.credits.consumed), `${num(o.credits.returnedHolds)} returned on failures`), tile("Outstanding in wallets", num(o.credits.outstanding), `${num(o.credits.heldNow)} held right now`))] : null,
        o.payments ? [h("h3", { class: "section" }, "Payments (Razorpay)"), h("div", { class: "grid kpis" }, tile("Gross collected", inr(o.payments.grossPaise), `${num(o.payments.paidCount)} payments · ${num(o.payments.creditsSold)} credits`),
          tile("Today", inr(o.payments.todayPaise), `${num(o.payments.todayCount)} payments`), tile("Pending links", num(o.payments.pending)), tile("Expired / cancelled", num(o.payments.expiredOrCancelled)), tile("Refunds", "Not tracked", "no refund flow yet"))] : null,
        h("div", { class: "grid three section" }, dayChart("E-way bills per day", o.ewbs.series), o.api ? dayChart("API requests per day", o.api.series) : null, o.payments ? dayChart("Collected per day", o.payments.series, inr) : null),
        h("div", { class: "grid two section" },
          h("div", { class: "card" }, h("h2", {}, "Latest e-way bills"), table([{ label: "Bill", key: "ewbNumber", mono: true }, { label: "User", render: (r) => r.userEmail ?? "—" }, { label: "Generated", render: (r) => when(r.generatedAt) }, { label: "Status", render: (r) => badge(r.status) }], o.recent.ewbs, { onRow: (r) => go(`ewbs/${r.uid}/${r.id}`), empty: "No e-way bills yet." })),
          o.payments ? h("div", { class: "card" }, h("h2", {}, "Latest payments"), table([{ label: "User", render: (r) => r.userEmail ?? "—" }, { label: "Amount", num: true, render: (r) => inr(r.amountPaise) }, { label: "Credits", num: true, key: "credits" }, { label: "Paid", render: (r) => when(r.paidAt) }], o.recent.payments, { onRow: (r) => go(`payments/${r.uid}/${r.id}`), empty: "No payments yet." })) : null),
        o.recent.admin.length ? h("div", { class: "card section" }, h("h2", {}, "Recent admin activity"), auditTable(o.recent.admin)) : null,
      );
    },

    async activity(view) {
      view.append(head("Active users", "Accounts that opened the app each day, and how many times the app was opened. An open is counted when the app starts, or comes back after 30 minutes away.", rangePicker(render)));
      const body = h("div", {}, loading());
      view.append(body);
      const a = await api(`/activity?${rangeQuery()}`);
      const s = a.summary;
      const days = [...a.days].reverse();
      put(body,
        a.capped ? h("div", { class: "notice warn" }, "Showing the latest 50,000 opens in this period; narrow the dates for exact totals.") : h("div", { class: "note", style: "margin:-8px 0 12px" }, rangeText()),
        h("div", { class: "grid kpis" },
          tile("Active today", num(s.activeToday), `${num(s.opensToday)} app opens today`),
          tile("Active in period", num(s.activeInRange), "different accounts"),
          tile("App opens in period", num(s.opensInRange)),
          tile("Avg daily active", num(s.avgDailyActive), "users per day"),
          tile("Opens per active user", num(s.avgOpensPerUserDay), "per day, on average"),
          tile("Busiest day", s.peakDay && s.peakDay.activeUsers ? `${num(s.peakDay.activeUsers)} users` : "—", s.peakDay && s.peakDay.activeUsers ? `${day(`${s.peakDay.day}T12:00:00+05:30`)} · ${num(s.peakDay.opens)} opens` : "")),
        h("div", { class: "grid two section" }, dayChart("Active users per day", a.activeSeries), dayChart("App opens per day", a.opensSeries)),
        h("div", { class: "grid two section" },
          h("div", { class: "card" }, h("h2", {}, "Day by day"), table([
            { label: "Date", render: (r) => day(`${r.day}T12:00:00+05:30`) },
            { label: "Active users", num: true, render: (r) => num(r.activeUsers) },
            { label: "App opens", num: true, render: (r) => num(r.opens) },
            { label: "Opens per user", num: true, render: (r) => (r.activeUsers ? (r.opens / r.activeUsers).toFixed(1) : "—") },
          ], days, { empty: "No app opens in this period." })),
          h("div", { class: "card" }, h("h2", {}, `Active users (${num(a.users.length)})`), table([
            { label: "Name / email", wrap: true, render: (r) => h("div", {}, h("div", { style: "font-weight:600" }, r.name || r.businessName || "—"), h("div", { class: "note", style: "margin:0" }, r.email || r.uid)) },
            { label: "Business", wrap: true, render: (r) => r.businessName || "—" },
            { label: "Opens", num: true, render: (r) => num(r.opens) },
            { label: "Days active", num: true, render: (r) => num(r.activeDays) },
            { label: "Last opened", render: (r) => when(r.lastOpenAt) },
            { label: "App", render: (r) => [r.platform, r.appVersion].filter(Boolean).join(" ") || "—" },
          ], a.users, { onRow: (r) => go(`users/${r.uid}`), empty: "No one opened the app in this period." }))),
        h("div", { class: "card section" }, h("h2", {}, "Active users: payments and credits"),
          h("p", { class: "note", style: "margin-top:0" }, "Paid and bought are all time; the last step buying credits is in this period (from app 1.3.11)."),
          table([
            { label: "Name / email", wrap: true, render: (r) => h("div", {}, h("div", { style: "font-weight:600" }, r.name || r.businessName || "—"), h("div", { class: "note", style: "margin:0" }, r.email || r.uid)) },
            { label: "Paid", num: true, render: (r) => (r.paidPayments ? `${inr(r.paidPaise)} (${r.paidPayments})` : "Never paid") },
            { label: "Credits bought", num: true, render: (r) => num(r.purchasedCredits) },
            { label: "Credits left", num: true, render: (r) => num(r.balance) },
            { label: "Pending links", num: true, render: (r) => num(r.pendingPayments) },
            { label: "Went back", num: true, render: (r) => (r.closedAtCheckout || r.cameBackUnpaid ? `${num(r.closedAtCheckout)} at checkout · ${num(r.cameBackUnpaid)} from payment` : "—") },
            { label: "Last step buying credits", wrap: true, render: (r) => (r.lastPaymentStep ? h("div", {}, stepBadge(r.lastPaymentStep), h("div", { class: "note", style: "margin:0" }, when(r.lastPaymentStepAt))) : "—") },
          ], a.users, { onRow: (r) => go(`users/${r.uid}`), empty: "No one opened the app in this period." })),
      );
    },

    async users(view, params) {
      if (params[0]) return userDetail(view, params[0]);
      const state = { q: "", status: "", verified: "", paid: "", bills: "", credits: "", sort: "createdAt", page: 1, ...(pages.users.state || {}) };
      pages.users.state = state;
      view.append(head("Users & businesses", "Every registered account, with its business, bills, credits and payments.", canDo("export") ? h("button", { class: "btn", onclick: () => download(`/export/users?${filterQuery(state)}`, "users.csv") }, "Export CSV") : null));
      const list = h("div", {}, loading());
      const reload = () => { state.page = 1; load(); };
      view.append(h("div", { class: "filters" },
        h("input", { class: "input", type: "search", placeholder: "Search name, email, user ID, business, GSTIN, bill no., payment ID", value: state.q, "aria-label": "Search users", onchange: (e) => { state.q = e.target.value; reload(); } }),
        select("Status", state.status, [["", "Any status"], ["active", "Active"], ["suspended", "Suspended"]], (v) => { state.status = v; reload(); }),
        select("Email", state.verified, [["", "Any email"], ["yes", "Verified"], ["no", "Unverified"]], (v) => { state.verified = v; reload(); }),
        select("Paid", state.paid, [["", "Paid or free"], ["yes", "Has paid"], ["no", "Never paid"]], (v) => { state.paid = v; reload(); }),
        select("Bills", state.bills, [["", "Any usage"], ["yes", "Made bills"], ["no", "No bills"]], (v) => { state.bills = v; reload(); }),
        select("Credits", state.credits, [["", "Any balance"], ["low", "Low credits"], ["zero", "Zero credits"]], (v) => { state.credits = v; reload(); }),
        select("Sort", state.sort, [["createdAt", "Newest"], ["lastSignInAt", "Last sign-in"], ["ewbTotal", "Most bills"], ["paidPaise", "Most paid"], ["balance", "Highest balance"]], (v) => { state.sort = v; reload(); })), list);
      async function load() {
        put(list, loading());
        try {
          const result = await api(`/users?${filterQuery(state)}&page=${state.page}`);
          put(list, table([
            { label: "Name / email", wrap: true, render: (r) => h("div", {}, h("div", { style: "font-weight:600" }, r.name || "—"), h("div", { class: "note", style: "margin:0" }, r.email || r.uid)) },
            { label: "Status", render: (r) => h("div", { class: "filters", style: "margin:0;gap:4px" }, badge(r.suspended || r.disabled ? "suspended" : "active", r.suspended || r.disabled ? "suspended" : "active"), badge(r.emailVerified ? "verified" : "unverified")) },
            { label: "Business", wrap: true, render: (r) => h("div", {}, r.businessName || "—", r.gstin ? h("div", { class: "note mono", style: "margin:0" }, r.gstin) : null) },
            { label: "Registered", render: (r) => day(r.createdAt) },
            { label: "Last sign-in", render: (r) => when(r.lastSignInAt) },
            { label: "Bills", num: true, render: (r) => num(r.ewbTotal) },
            { label: "Credits", num: true, render: (r) => num(r.balance) },
            { label: "Bought", num: true, render: (r) => num(r.purchasedCredits) },
            { label: "Paid", num: true, render: (r) => (r.paidPayments ? `${inr(r.paidPaise)} (${r.paidPayments})` : "—") },
            { label: "Plan", render: (r) => `${r.planId} · ${r.planState}` },
          ], result.items, { onRow: (r) => go(`users/${r.uid}`), empty: "No users match these filters." }), pager(result, (p) => { state.page = p; load(); }), h("div", { class: "note" }, `Data as of ${when(result.builtAt)} (refreshed every minute).`));
        } catch (error) { put(list, errorBox(error, load)); }
      }
      await load();
    },

    async ewbs(view, params) {
      if (params[0]) return ewbDetail(view, params[0], params[1]);
      const state = { q: "", status: "", page: 1, ...(pages.ewbs.state || {}) };
      pages.ewbs.state = state;
      view.append(head("E-way bills", "Every bill the provider confirmed, platform-wide. Read-only: bills are changed only from the app.", h("div", { class: "filters", style: "margin:0" }, rangePicker(render), canDo("export") ? h("button", { class: "btn", onclick: () => download(`/export/ewbs?${rangeQuery()}`, "ewbs.csv") }, "Export CSV") : null)));
      const list = h("div", {}, loading());
      view.append(h("div", { class: "filters" },
        h("input", { class: "input", type: "search", placeholder: "Search bill no., invoice no., buyer, GSTIN, user email", value: state.q, "aria-label": "Search bills", onchange: (e) => { state.q = e.target.value; state.page = 1; load(); } }),
        select("Status", state.status, [["", "Any status"], ["active", "Active"], ["part_b_pending", "Part-B pending"], ["expired", "Expired"], ["cancelled", "Cancelled"]], (v) => { state.status = v; state.page = 1; load(); })), list);
      async function load() {
        put(list, loading());
        try {
          const result = await api(`/ewbs?${rangeQuery()}&${filterQuery(state)}&page=${state.page}`);
          put(list, table([
            { label: "E-way bill", mono: true, key: "ewbNumber" },
            { label: "User", wrap: true, render: (r) => h("div", {}, r.userEmail || "—", r.businessName ? h("div", { class: "note", style: "margin:0" }, r.businessName) : null) },
            { label: "Invoice", render: (r) => `${r.invoiceNumber} · ${day(r.invoiceDate)}` },
            { label: "Generated", render: (r) => when(r.generatedAt) },
            { label: "Value", num: true, render: (r) => inr(r.totalPaise) },
            { label: "Credits", num: true, render: (r) => num(r.creditsCharged) },
            { label: "Provider", key: "provider" },
            { label: "Status", render: (r) => badge(r.status) },
          ], result.items, { onRow: (r) => go(`ewbs/${r.uid}/${r.id}`), empty: "No e-way bills in this period." }), pager(result, (p) => { state.page = p; load(); }));
        } catch (error) { put(list, errorBox(error, load)); }
      }
      await load();
    },

    async api(view) {
      const state = { operation: "", outcome: "", page: 1, ...(pages.api.state || {}) };
      pages.api.state = state;
      view.append(head("API usage & quota", "Every outbound provider request is logged (each retry separately). Bills generated ≠ API requests.", h("div", { class: "filters", style: "margin:0" }, rangePicker(render), canDo("export") ? h("button", { class: "btn", onclick: () => download(`/export/api-calls?${rangeQuery()}`, "api-calls.csv") }, "Export CSV") : null)));
      const body = h("div", {}, loading());
      view.append(body);
      async function load() {
        put(body, loading());
        try {
          const data = await api(`/api-usage?${rangeQuery()}&${filterQuery(state)}&page=${state.page}`);
          const s = data.summary;
          put(body, 
            data.capped ? h("div", { class: "notice warn" }, "Showing the latest 20,000 calls in this period; narrow the dates for exact totals.") : null,
            h("div", { class: "grid kpis" }, tile("Requests", num(s.total), `${num(s.testMode)} in test mode`), tile("Succeeded", num(s.ok)), tile("Failed", num(s.failed), `error rate ${pct(s.errorRate)}`), tile("Timeouts / network", num(s.timeouts + s.network)),
              tile("Rate-limited", num(s.rateLimited)), tile("Auth failures", num(s.authFailures)), tile("Provider down", num(s.providerDown)), tile("Response time", ms(s.avgMs), `p50 ${ms(s.p50Ms)} · p95 ${ms(s.p95Ms)}`),
              tile("Busiest hour", data.peakHour ? `${num(data.peakHour[1])} requests` : "—", data.peakHour ? `${day(`${data.peakHour[0].slice(0, 10)}T12:00:00+05:30`)}, ${data.peakHour[0].slice(11)}:00 IST` : ""), quotaTile(data.quota)),
            h("div", { class: "grid two section" },
              h("div", { class: "card" }, h("h2", {}, "By operation"), table([{ label: "Operation", key: "name", mono: true }, { label: "Requests", num: true, render: (r) => num(r.total) }, { label: "Failed", num: true, render: (r) => num(r.failed) }, { label: "Avg time", num: true, render: (r) => ms(r.avgMs) }], s.byOperation)),
              h("div", { class: "card" }, h("h2", {}, "By provider"), table([{ label: "Provider", key: "name" }, { label: "Requests", num: true, render: (r) => num(r.total) }, { label: "Failed", num: true, render: (r) => num(r.failed) }, { label: "Avg time", num: true, render: (r) => ms(r.avgMs) }], s.byProvider))),
            h("div", { class: "filters section" },
              select("Operation", state.operation, [["", "All operations"], ...["ewb_generate", "ewb_cancel", "ewb_part_b", "ewb_extend", "ewb_consolidate", "gstin_lookup", "credentials_test", "distance"].map((op) => [op, op])], (v) => { state.operation = v; state.page = 1; load(); }),
              select("Outcome", state.outcome, [["", "All outcomes"], ["ok", "Succeeded"], ["failed", "Failed (any)"], ["rejected", "Rejected"], ["timeout", "Timeout"], ["rate_limited", "Rate-limited"], ["auth", "Auth failure"], ["provider_down", "Provider down"]], (v) => { state.outcome = v; state.page = 1; load(); })),
            table([
              { label: "Time", render: (r) => when(r.at) }, { label: "Provider", key: "provider" }, { label: "Operation", mono: true, key: "operation" }, { label: "Outcome", render: (r) => badge(r.outcome) },
              { label: "HTTP", num: true, render: (r) => r.httpStatus || "—" }, { label: "Code", mono: true, render: (r) => r.errorCode || "" }, { label: "Time taken", num: true, render: (r) => ms(r.durationMs) },
              { label: "Try", num: true, key: "attempt" }, { label: "Test", render: (r) => (r.testMode ? "yes" : "") }, { label: "User", mono: true, render: (r) => (r.workspaceId ? h("a", { href: `#/users/${encodeURIComponent(r.workspaceId)}` }, r.workspaceId.slice(0, 10)) : "—") }, { label: "Bill", mono: true, render: (r) => r.ewbNumber || "" },
            ], data.calls.items, { empty: "No provider calls in this period." }), pager(data.calls, (p) => { state.page = p; load(); }));
        } catch (error) { put(body, errorBox(error, load)); }
      }
      await load();
    },

    async payments(view, params) {
      if (params[0]) return paymentDetail(view, params[0], params[1]);
      const state = { q: "", status: "", provider: "razorpay", page: 1, ...(pages.payments.state || {}) };
      pages.payments.state = state;
      view.append(head("Payments", "Credit purchases through Razorpay payment links. Amounts are gross, as charged; gateway fees and GST are not recorded by the app.", h("div", { class: "filters", style: "margin:0" }, rangePicker(render), canDo("export") ? h("button", { class: "btn", onclick: () => download(`/export/payments?${rangeQuery()}`, "payments.csv") }, "Export CSV") : null)));
      const list = h("div", {}, loading());
      view.append(h("div", { class: "filters" },
        h("input", { class: "input", type: "search", placeholder: "Search link ID, payment ID, customer", value: state.q, "aria-label": "Search payments", onchange: (e) => { state.q = e.target.value; state.page = 1; load(); } }),
        select("Status", state.status, [["", "Any status"], ["paid", "Paid"], ["created", "Pending"], ["expired", "Expired"], ["cancelled", "Cancelled"]], (v) => { state.status = v; state.page = 1; load(); }),
        select("Gateway", state.provider, [["razorpay", "Razorpay (real)"], ["sandbox", "Sandbox (test)"], ["", "Both"]], (v) => { state.provider = v; state.page = 1; load(); })), list);
      async function load() {
        put(list, loading());
        try {
          const result = await api(`/payments?${rangeQuery()}&${filterQuery(state)}&page=${state.page}`);
          put(list, 
            h("div", { class: "grid kpis", style: "margin-bottom:12px" }, tile("Paid", num(result.totals.paidCount)), tile("Gross collected", inr(result.totals.grossPaise)), tile("Pending", num(result.totals.pending)), tile("Expired / cancelled", num(result.totals.expiredOrCancelled))),
            table([
              { label: "Customer", wrap: true, render: (r) => h("div", {}, r.userName || "—", h("div", { class: "note", style: "margin:0" }, r.userEmail || r.uid)) },
              { label: "Link / order", mono: true, key: "id" }, { label: "Payment ID", mono: true, render: (r) => r.paymentId || "—" },
              { label: "Credits", num: true, render: (r) => num(r.credits) }, { label: "Amount", num: true, render: (r) => inr(r.amountPaise) },
              { label: "Created", render: (r) => when(r.createdAt) }, { label: "Paid", render: (r) => when(r.paidAt) }, { label: "Status", render: (r) => badge(r.status) }, { label: "Outcome", render: (r) => outcomeBadge(r.outcome) }, { label: "Gateway", key: "provider" },
            ], result.items, { onRow: (r) => go(`payments/${r.uid}/${r.id}`), empty: "No payments in this period." }), pager(result, (p) => { state.page = p; load(); }));
        } catch (error) { put(list, errorBox(error, load)); }
      }
      await load();

      // The app's log of each step buying credits: who opened checkout, went back, reached the payment page, came back unpaid or paid.
      const logState = { q: "", step: "", page: 1, ...(pages.payments.logState || {}) };
      pages.payments.logState = logState;
      const log = h("div", {}, loading());
      view.append(h("div", { class: "card section" },
        h("h2", {}, "Buying credits in the app, step by step"),
        h("p", { class: "note", style: "margin-top:0" }, "Reported by the app (from version 1.3.11). A step without a payment link is a checkout the user closed before paying."),
        h("div", { class: "filters" },
          h("input", { class: "input", type: "search", placeholder: "Search email, user ID, link ID", value: logState.q, "aria-label": "Search payment steps", onchange: (e) => { logState.q = e.target.value; logState.page = 1; loadLog(); } }),
          select("Step", logState.step, [["", "All steps"], ...Object.entries(STEP_LABELS).map(([value, [label]]) => [value, label])], (v) => { logState.step = v; logState.page = 1; loadLog(); })),
        log));
      async function loadLog() {
        put(log, loading());
        try {
          const data = await api(`/payment-log?${rangeQuery()}&${filterQuery(logState)}&page=${logState.page}`);
          const s = data.summary;
          put(log,
            data.capped ? h("div", { class: "notice warn" }, "Showing the latest 50,000 steps in this period; narrow the dates for exact totals.") : null,
            h("div", { class: "grid kpis", style: "margin-bottom:12px" },
              tile("Wallet opened", num(s.walletOpens)), tile("Checkout opened", num(s.checkouts), `${num(s.checkoutAccounts)} accounts`), tile("Went back at checkout", num(s.closedAtCheckout)),
              tile("Payment page opened", num(s.paymentPages)), tile("Came back without paying", num(s.cameBackUnpaid)), tile("Came back paid", num(s.cameBackPaid)), tile("Errors", num(s.errors))),
            table([
              { label: "Time", render: (r) => when(r.at) },
              { label: "User", wrap: true, render: (r) => h("div", {}, r.name || "—", h("div", { class: "note", style: "margin:0" }, r.email || r.uid)) },
              { label: "Step", render: (r) => stepBadge(r.step) },
              { label: "Credits", num: true, render: (r) => num(r.credits) },
              { label: "Link", mono: true, render: (r) => (r.purchaseId ? h("a", { href: `#/payments/${encodeURIComponent(r.uid)}/${encodeURIComponent(r.purchaseId)}` }, r.purchaseId) : "—") },
              { label: "Note", wrap: true, render: (r) => r.note || "" },
              { label: "App", render: (r) => r.appVersion || "—" },
            ], data.items, { onRow: (r) => go(`users/${r.uid}`), empty: "No payment steps in this period." }), pager(data, (p) => { logState.page = p; loadLog(); }));
        } catch (error) { put(log, errorBox(error, loadLog)); }
      }
      await loadLog();
    },

    async credits(view) {
      const state = { kind: "", page: 1, ...(pages.credits.state || {}) };
      pages.credits.state = state;
      view.append(head("Application credits", "Every credit movement in customer wallets. To grant or remove credits, open the user.", h("div", { class: "filters", style: "margin:0" }, rangePicker(render), canDo("export") ? h("button", { class: "btn", onclick: () => download(`/export/ledger?${rangeQuery()}`, "credit-ledger.csv") }, "Export CSV") : null)));
      const list = h("div", {}, loading());
      view.append(h("div", { class: "filters" }, select("Type", state.kind, [["", "All types"], ["topup", "Bought"], ["grant", "Welcome"], ["adjust", "Admin adjustment"], ["generate", "Generate"], ["part_b", "Part-B"], ["cancel", "Cancel"], ["extend", "Extend"], ["consolidate", "Consolidate"]], (v) => { state.kind = v; state.page = 1; load(); })), list);
      async function load() {
        put(list, loading());
        try {
          const result = await api(`/ledger?${rangeQuery()}&${filterQuery(state)}&page=${state.page}`);
          put(list, 
            result.ledgerTrimmed ? h("div", { class: "notice warn" }, "Some wallets have more than 1,000 entries; their oldest entries are no longer stored.") : null,
            h("div", { class: "card", style: "margin-bottom:12px" }, h("h2", {}, "Prices"), h("dl", { class: "kv" },
              h("dt", {}, "1 credit"), h("dd", {}, inr(result.pricing.creditPricePaise)),
              h("dt", {}, "Packs offered"), h("dd", {}, result.pricing.packs.map((pack) => `${num(pack)} credits`).join(", ")),
              h("dt", {}, "Cost per action"), h("dd", {}, Object.entries(result.costs).map(([action, cost]) => `${action} ${cost}`).join(" · "))),
              h("div", { class: "note" }, "Prices and packs are server settings (CREDIT_PRICE_PAISE, CREDIT_PACKS_JSON, CREDIT_COSTS_JSON in functions/.env); change them there and deploy.")),
            table([
              { label: "Time", render: (r) => when(r.at) }, { label: "User", render: (r) => h("a", { href: `#/users/${encodeURIComponent(r.uid)}` }, r.userEmail || r.uid.slice(0, 10)) },
              { label: "Type", key: "kind" }, { label: "Credits", num: true, render: (r) => (r.credits > 0 ? `+${num(r.credits)}` : num(r.credits)) }, { label: "State", render: (r) => badge(r.status) },
              { label: "Bill / purchase", mono: true, render: (r) => r.ewbNumber || r.targetId || "" }, { label: "Note", wrap: true, render: (r) => [r.note, r.actor ? ` · by ${r.actor}` : ""].join("") },
            ], result.items, { empty: "No credit movements in this period." }), pager(result, (p) => { state.page = p; load(); }));
        } catch (error) { put(list, errorBox(error, load)); }
      }
      await load();
    },

    async reconciliation(view) {
      view.append(head("Reconciliation", "Cross-checks payments, credits and e-way bills per account. Nothing is changed automatically.", h("button", { class: "btn primary", onclick: () => render() }, "Run again")));
      const body = h("div", {}, loading());
      view.append(body);
      const result = await api("/reconciliation");
      const high = result.findings.filter((finding) => finding.severity === "high").length;
      put(body, 
        h("div", { class: `notice ${high ? "bad" : result.findings.length ? "warn" : ""}` }, high ? `${high} serious finding${high === 1 ? "" : "s"} need a look.` : result.findings.length ? "No serious findings; some items need attention." : "Everything reconciles: every paid purchase was credited once, every charge has a bill, and every balance matches its ledger."),
        result.ledgerTrimmed ? h("div", { class: "notice warn" }, "Some wallets have more than 1,000 ledger entries; balance and charge checks are skipped for them.") : null,
        h("div", { class: "grid kpis" }, Object.entries(result.checked).map(([key, value]) => tile({ accounts: "Accounts checked", purchases: "Purchases checked", ledgerEntries: "Credit entries checked", ewbs: "E-way bills checked", webhookEvents: "Webhook deliveries (90 days)" }[key] || key, num(value)))),
        h("div", { class: "section" }, table([
          { label: "Severity", render: (r) => badge(r.severity) }, { label: "Check", mono: true, key: "kind" }, { label: "Account", render: (r) => h("a", { href: `#/users/${encodeURIComponent(r.uid)}` }, r.userEmail || r.uid) },
          { label: "Record", mono: true, render: (r) => r.target || "" }, { label: "Detail", wrap: true, key: "detail" },
        ], result.findings, { empty: "No findings." })), h("div", { class: "note" }, `Checked at ${when(result.builtAt)}.`));
    },

    async reports(view) {
      view.append(head("Reports & export", "CSV files built from the live records for the selected period. Each export is recorded in the audit log.", rangePicker(render)));
      const reports = [
        ["users", "Users", "Every account with business, bills, credits and payments (all time; filters from the Users page apply there)."],
        ["ewbs", "E-way bills", "Bills generated in the period, with value, status and credits charged."],
        ["payments", "Payments", "Purchases created or paid in the period."],
        ["ledger", "Credit ledger", "Every credit movement in the period: bought, granted, adjusted, consumed."],
        ["api-calls", "API calls", "Every provider request in the period with outcome and timing."],
        ...(canDo("audit") ? [["audit", "Admin audit log", "Every admin action in the period."]] : []),
      ];
      view.append(h("div", { class: "grid three" }, reports.map(([id, title, about]) => h("div", { class: "card" }, h("h2", {}, title), h("p", { class: "note", style: "margin-top:0" }, about),
        h("button", { class: "btn primary", onclick: async (e) => { e.target.disabled = true; try { await download(`/export/${id}?${rangeQuery()}`, `${id}.csv`); } catch (error) { toast(error.message); } finally { e.target.disabled = false; } } }, "Download CSV")))));
    },

    async audit(view) {
      const state = { action: "", page: 1, ...(pages.audit.state || {}) };
      pages.audit.state = state;
      view.append(head("Audit log", "Append-only record of admin sign-ins, views of customer accounts, changes and exports.", rangePicker(render)));
      const list = h("div", {}, loading());
      view.append(h("div", { class: "filters" }, select("Action", state.action, [["", "All actions"], ["admin.credits", "Credit adjustments"], ["admin.user", "User views & suspensions"], ["admin.payment", "Payment re-checks"], ["admin.role", "Role changes"], ["admin.export", "Exports"], ["admin.session", "Sign-ins"], ["admin.access_denied", "Denied access"], ["admin.permission_denied", "Denied actions"]], (v) => { state.action = v; state.page = 1; load(); })), list);
      async function load() {
        put(list, loading());
        try {
          const result = await api(`/audit?${rangeQuery()}&${filterQuery(state)}&page=${state.page}`);
          put(list, auditTable(result.items), pager(result, (p) => { state.page = p; load(); }));
        } catch (error) { put(list, errorBox(error, load)); }
      }
      await load();
    },

    async settings(view) {
      view.append(head("Settings & health", "How the server is configured right now. Secrets are never shown; change settings in functions/.env and deploy."));
      const body = h("div", {}, loading());
      view.append(body);
      const [health, subs] = await Promise.all([api("/health"), canDo("payments") ? api("/subscriptions") : Promise.resolve(null)]);
      const yes = (value, label = "Configured") => badge(value ? "ok" : "unknown", value ? label : "Not set");
      put(body, h("div", { class: "grid two" },
        h("div", { class: "card" }, h("h2", {}, "Services"), h("dl", { class: "kv" },
          h("dt", {}, "Environment"), h("dd", {}, health.environment), h("dt", {}, "Sign-in"), h("dd", {}, health.authMode), h("dt", {}, "Database"), h("dd", {}, `${health.store} · `, badge("ok", "reachable")),
          h("dt", {}, "E-way bill provider"), h("dd", {}, health.ewbProvider ? [health.ewbProvider.label, " ", health.ewbProvider.sandbox ? badge("warn", "test mode") : badge("ok", "live")] : [badge("bad", "not configured"), " ", health.ewbProviderSetting === "gstinapi" ? (health.gstinapi.configured ? "" : "GSTINAPI_KEY is empty") : `EWB_PROVIDER is ${health.ewbProviderSetting}. Set EWB_PROVIDER=gstinapi in functions/.env and deploy.`]),
          h("dt", {}, "GSTIN lookups"), h("dd", {}, yes(health.gstinapi.configured)), h("dt", {}, "Razorpay"), h("dd", {}, yes(health.razorpay.configured), " webhook secret ", yes(health.razorpay.webhookSecret, "set")),
          h("dt", {}, "Distance lookup"), h("dd", {}, yes(health.distanceLookup)), h("dt", {}, "Plan billing"), h("dd", {}, health.billingMode))),
        h("div", { class: "card" }, h("h2", {}, "Last activity"), h("dl", { class: "kv" },
          h("dt", {}, "Last API call"), h("dd", {}, health.lastApiCall ? [when(health.lastApiCall.at), " ", badge(health.lastApiCall.outcome), " ", health.lastApiCall.operation] : "none yet"),
          h("dt", {}, "Last bill generated"), h("dd", {}, health.lastSuccessfulGenerate ? when(health.lastSuccessfulGenerate.at) : "none in 30 days"),
          h("dt", {}, "Last webhook"), h("dd", {}, health.lastWebhook ? [when(health.lastWebhook.at), " ", health.lastWebhook.event] : "none yet"),
          h("dt", {}, "Provider credits"), h("dd", {}, health.quota ? `${num(health.quota.creditsRemaining)} (reported ${when(health.quota.reportedAt)})` : "not reported yet"),
          h("dt", {}, "Dashboard data"), h("dd", {}, `built ${when(health.snapshotBuiltAt)}, refreshed every minute`))),
        h("div", { class: "card" }, h("h2", {}, "Prices"), h("dl", { class: "kv" }, h("dt", {}, "1 credit"), h("dd", {}, inr(health.pricing.creditPricePaise)), h("dt", {}, "Packs"), h("dd", {}, health.pricing.packs.join(", ")),
          h("dt", {}, "Costs"), h("dd", {}, Object.entries(health.creditCosts).map(([action, cost]) => `${action} ${cost}`).join(" · ")))),
        subs ? h("div", { class: "card" }, h("h2", {}, "Plans"), h("p", { class: "note", style: "margin-top:0" }, subs.sold ? "Paid plans are on sale." : "Paid plans are not sold (display only); customers pay with credits."),
          table([{ label: "Plan · state", key: "key" }, { label: "Accounts", num: true, key: "count" }], Object.entries(subs.counts).map(([key, count]) => ({ key, count })))) : null,
        await appVersionCard()));

      // Android app updates: apps older than the minimum must update from the Play Store before they open.
      async function appVersionCard() {
        const { setting, storeUrl } = await api("/app-version");
        const edit = async () => {
          const values = await formDialog({
            title: "Android app updates",
            intro: "Use the version code from the Play Console (not the version name). Set the minimum only after that version is live on the Play Store, or older apps cannot open until they can download it.",
            fields: [
              { name: "minVersionCode", label: "Minimum version code (older apps must update)", type: "number", required: false, min: 0, value: String(setting.minVersionCode || "") },
              { name: "latestVersionCode", label: "Latest version code (older apps are offered the update)", type: "number", required: false, min: 0, value: String(setting.latestVersionCode || "") },
              { name: "message", label: "Message on the update screen (optional)", required: false, value: setting.message || "" },
            ],
            submit: "Save",
          });
          if (!values) return;
          try {
            await api("/app-version", { body: { minVersionCode: Number(values.minVersionCode) || 0, latestVersionCode: Number(values.latestVersionCode) || 0, message: values.message || "" } });
            toast("Saved: apps pick it up within a minute.");
            render();
          } catch (error) { toast(error.message); }
        };
        return h("div", { class: "card" }, h("h2", {}, "Android app updates"), h("dl", { class: "kv" },
          h("dt", {}, "Must update below"), h("dd", {}, setting.minVersionCode ? `version code ${setting.minVersionCode}` : "Off (no forced update)"),
          h("dt", {}, "Offer update below"), h("dd", {}, setting.latestVersionCode ? `version code ${setting.latestVersionCode}` : "Off"),
          h("dt", {}, "Message"), h("dd", {}, setting.message || "Default"),
          h("dt", {}, "Play Store"), h("dd", {}, h("a", { href: storeUrl, target: "_blank", rel: "noopener" }, "Open listing")),
          h("dt", {}, "Last changed"), h("dd", {}, setting.updatedAt ? `${when(setting.updatedAt)}${setting.updatedBy ? ` by ${setting.updatedBy}` : ""}` : "never")),
          canDo("admins") ? h("button", { class: "btn primary", onclick: edit }, "Change") : h("p", { class: "note" }, "Only a super admin can change this."));
      }
    },

    async admins(view) {
      view.append(head("Admins & roles", "Roles are stored on the Firebase account and checked by the server on every call.", h("button", { class: "btn primary", onclick: grant }, "Add or change admin")));
      const body = h("div", {}, loading());
      view.append(body);
      const data = await api("/admins");
      put(body, 
        h("div", { class: "card" }, h("h2", {}, "Admins"), table([{ label: "Email", render: (r) => r.email }, { label: "Role", render: (r) => r.role }, { label: "Source", render: (r) => r.source }, { label: "", render: (r) => (r.source === "role" ? h("button", { class: "btn small danger", onclick: (e) => { e.stopPropagation(); remove(r.email); } }, "Remove") : "") }],
          [...data.bootstrap.map((email) => ({ email, role: "super", source: "SUPER_ADMIN_EMAILS" })), ...data.admins.map((admin) => ({ ...admin, source: "role" }))])),
        h("div", { class: "card section" }, h("h2", {}, "What each role can do"), table([{ label: "Role", key: "label" }, { label: "Permissions", wrap: true, render: (r) => r.permissions.join(", ") }], data.roles)));
      async function grant() {
        const values = await formDialog({ title: "Add or change an admin", intro: "The person must already have a verified E-Way Easy account. They need to sign in again to use the panel.", submit: "Save role", fields: [{ name: "email", label: "Account email", type: "email" }, { name: "role", label: "Role", options: data.roles.map((role) => [role.role, role.label]) }] });
        if (!values) return;
        try { await api("/admins", { body: { email: values.email, role: values.role } }); toast("Role saved"); render(); } catch (error) { toast(error.message); }
      }
      async function remove(email) {
        if (!(await confirmDialog({ title: `Remove admin access for ${email}?`, body: "They are signed out of the panel within a minute.", confirm: "Remove", danger: true }))) return;
        try { await api("/admins", { body: { email, role: null } }); toast("Admin access removed"); render(); } catch (error) { toast(error.message); }
      }
    },
  };

  /* ---------- Detail pages ---------- */

  async function userDetail(view, uid) {
    view.append(h("p", {}, h("a", { href: "#/users" }, "← All users")));
    const body = h("div", {}, loading());
    view.append(body);
    const d = await api(`/users/${encodeURIComponent(uid)}?fresh=1`);
    const u = d.user;
    const suspended = u.suspended || u.disabled;
    const actions = h("div", { class: "filters", style: "margin:0" },
      canDo("credits.adjust") ? h("button", { class: "btn primary", onclick: adjust }, "Adjust credits") : null,
      canDo("users.suspend") ? h("button", { class: `btn ${suspended ? "" : "danger"}`, onclick: suspend }, suspended ? "Reactivate account" : "Suspend account") : null);
    const tabs = [
      ["Profile", () => h("div", { class: "grid two" },
        h("div", { class: "card" }, h("h2", {}, "Account"), h("dl", { class: "kv" }, h("dt", {}, "User ID"), h("dd", { class: "mono" }, u.uid), h("dt", {}, "Email"), h("dd", {}, u.email || "—", " ", badge(u.emailVerified ? "verified" : "unverified")),
          h("dt", {}, "Registered"), h("dd", {}, when(u.createdAt)), h("dt", {}, "Last sign-in"), h("dd", {}, when(u.lastSignInAt)), h("dt", {}, "Status"), h("dd", {}, badge(suspended ? "suspended" : "active", suspended ? "suspended" : "active")),
          h("dt", {}, "Admin role"), h("dd", {}, u.adminRole || "none"))),
        h("div", { class: "card" }, h("h2", {}, "Business"), d.business ? h("dl", { class: "kv" }, h("dt", {}, "Name"), h("dd", {}, d.business.name || "—"), h("dt", {}, "GSTIN"), h("dd", { class: "mono" }, d.business.gstin || "—"),
          h("dt", {}, "State"), h("dd", {}, d.business.state || "—"), h("dt", {}, "Address"), h("dd", {}, [d.business.address, d.business.pincode].filter(Boolean).join(" ") || "—"), h("dt", {}, "Phone"), h("dd", {}, d.business.phone || "—"),
          h("dt", {}, "Portal logins"), h("dd", {}, d.portalLogins.length ? d.portalLogins.map((login) => `${login.gstin} (saved ${day(login.updatedAt)})`).join(", ") : "none")) : h("p", { class: "note" }, u.businessName ? `${u.businessName}` : "Business details are not available to your role, or not set up yet.")),
        d.subscription ? h("div", { class: "card" }, h("h2", {}, "Plan"), h("dl", { class: "kv" }, h("dt", {}, "Plan"), h("dd", {}, d.subscription.planId), h("dt", {}, "State"), h("dd", {}, d.subscription.entitlementState), h("dt", {}, "Renews / trial ends"), h("dd", {}, day(d.subscription.renewalAt)),
          h("dt", {}, "Bills this month"), h("dd", {}, num(d.subscription.usageCount))), h("p", { class: "note" }, "Plans are display-only; billing is by credits.")) : null)],
      ["Usage", () => h("div", {}, h("div", { class: "grid kpis" }, tile("Bills generated", num(u.ewbTotal), `${num(u.ewbActive)} active · ${num(u.ewbCancelled)} cancelled`), tile("Submissions rejected", num(d.attempts.rejected)), tile("Outcome unknown", num(d.attempts.unknown)), tile("Still pending", num(d.attempts.pending)),
        d.api ? tile("API calls (90 days)", num(d.api.total), `${num(d.api.failed)} failed`) : null, tile("Last activity", day(u.lastActivityAt))),
        d.api ? h("div", { class: "card section" }, h("h2", {}, "API calls by operation (90 days)"), table([{ label: "Operation", key: "name", mono: true }, { label: "Requests", num: true, key: "total" }, { label: "Failed", num: true, key: "failed" }, { label: "Avg time", num: true, render: (r) => ms(r.avgMs) }], d.api.byOperation, { empty: "No API calls." })) : null)],
      d.wallet ? ["Credits", () => h("div", {}, h("div", { class: "grid kpis" }, tile("Balance", num(d.wallet.balance)), tile("Bought", num(u.purchasedCredits)), tile("Welcome", num(u.grantedCredits)), tile("Adjusted", num(u.adjustedCredits)), tile("Consumed", num(u.consumedCredits)), tile("Held now", num(u.heldCredits))),
        h("div", { class: "section" }, table([{ label: "Time", render: (r) => when(r.at) }, { label: "Type", key: "kind" }, { label: "Credits", num: true, render: (r) => (r.credits > 0 ? `+${r.credits}` : r.credits) }, { label: "State", render: (r) => badge(r.status) }, { label: "Bill / purchase", mono: true, render: (r) => r.ewbNumber || r.targetId || "" }, { label: "Note", wrap: true, render: (r) => [r.note, r.actor ? ` · by ${r.actor}` : ""].join("") }, { label: "Entry ID", mono: true, key: "id" }], d.wallet.ledger, { empty: "No credit movements." })))] : null,
      d.purchases ? ["Payments", () => table([{ label: "Link / order", mono: true, key: "id" }, { label: "Payment ID", mono: true, render: (r) => r.paymentId || "—" }, { label: "Credits", num: true, key: "credits" }, { label: "Amount", num: true, render: (r) => inr(r.amountPaise) }, { label: "Created", render: (r) => when(r.createdAt) }, { label: "Paid", render: (r) => when(r.paidAt) }, { label: "Status", render: (r) => badge(r.status) }, { label: "Gateway", key: "provider" }], d.purchases, { onRow: (r) => go(`payments/${uid}/${r.id}`), empty: "No payments." })] : null,
      ["E-way bills", () => table([{ label: "E-way bill", mono: true, key: "ewbNumber" }, { label: "Invoice", render: (r) => r.invoiceNumber }, { label: "Generated", render: (r) => when(r.generatedAt) }, { label: "Value", num: true, render: (r) => inr(r.totalPaise) }, { label: "Credits", num: true, key: "creditsCharged" }, { label: "Status", render: (r) => badge(r.status) }], d.ewbs, { onRow: (r) => go(`ewbs/${uid}/${r.id}`), empty: "No e-way bills." })],
      d.audit ? ["Audit", () => h("div", {}, h("div", { class: "card" }, h("h2", {}, "Admin actions on this account"), auditTable(d.audit.admin)), h("div", { class: "card section" }, h("h2", {}, "Account events"), table([{ label: "Time", render: (r) => when(r.at) }, { label: "Action", mono: true, key: "action" }, { label: "Target", mono: true, key: "targetId" }, { label: "Outcome", key: "outcome" }], d.audit.workspace, { empty: "No events." })))] : null,
    ].filter(Boolean);
    const tabBar = h("div", { class: "tabs", role: "tablist" });
    const panel = h("div", { role: "tabpanel" });
    tabs.forEach(([label, make], index) => tabBar.append(h("button", { role: "tab", "aria-selected": index === 0 ? "true" : "false", onclick: (e) => { for (const button of tabBar.children) button.setAttribute("aria-selected", "false"); e.target.setAttribute("aria-selected", "true"); put(panel, make()); } }, label)));
    put(panel, tabs[0][1]());
    put(body, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, u.name || u.email || u.uid), h("p", {}, [u.email, u.businessName].filter(Boolean).join(" · "))), actions), tabBar, panel);

    async function adjust() {
      const values = await formDialog({ title: "Adjust credits", intro: `Current balance: ${num(u.balance)}. Use a negative number to remove credits. The change is recorded in the customer's ledger and the audit log.`, submit: "Apply", fields: [{ name: "credits", label: "Credits (+ to add, − to remove)", type: "number", min: -100000, max: 100000 }, { name: "reason", label: "Reason (shown in the ledger)", minlength: 5, placeholder: "e.g. Goodwill for failed bill on 12 Oct" }] });
      if (!values) return;
      const credits = Math.trunc(Number(values.credits));
      if (!credits) return toast("Enter a non-zero whole number.");
      if (!(await confirmDialog({ title: `${credits > 0 ? "Add" : "Remove"} ${num(Math.abs(credits))} credits?`, body: `${u.email || u.uid} · balance ${num(u.balance)} → ${num(u.balance + credits)}`, confirm: "Confirm", danger: credits < 0 }))) return;
      const reference = crypto.randomUUID().replace(/-/g, "");
      try {
        const result = await api(`/users/${encodeURIComponent(uid)}/credits`, { body: { credits, reason: values.reason, reference } });
        toast(`Done. New balance ${num(result.balance)}.`);
        render();
      } catch (error) { if (error.code !== "reauth_cancelled") toast(error.message); }
    }
    async function suspend() {
      const values = await formDialog({ title: suspended ? "Reactivate this account?" : "Suspend this account?", intro: suspended ? "They can sign in and use the app again." : "They are signed out and the API refuses their requests within a minute. Their data is kept.", danger: !suspended, submit: suspended ? "Reactivate" : "Suspend", fields: [{ name: "reason", label: "Reason (for the audit log)", minlength: 5 }] });
      if (!values) return;
      try { await api(`/users/${encodeURIComponent(uid)}/suspension`, { body: { suspended: !suspended, reason: values.reason } }); toast(suspended ? "Account reactivated" : "Account suspended"); render(); } catch (error) { if (error.code !== "reauth_cancelled") toast(error.message); }
    }
  }

  async function ewbDetail(view, uid, id) {
    view.append(h("p", {}, h("a", { href: "#/ewbs" }, "← All e-way bills")));
    const d = await api(`/ewbs/${encodeURIComponent(uid)}/${encodeURIComponent(id)}`);
    const e = d.ewb;
    view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", { class: "mono" }, e.ewbNumber), h("p", {}, `Invoice ${e.invoiceNumber} · ${e.sellerName} → ${e.buyerName}`)), badge(e.status)),
      h("div", { class: "grid two" },
        h("div", { class: "card" }, h("h2", {}, "Bill"), h("dl", { class: "kv" }, h("dt", {}, "Provider"), h("dd", {}, `${e.provider} · ${e.verificationSource || ""}`), h("dt", {}, "Provider reference"), h("dd", { class: "mono" }, e.providerBillId),
          h("dt", {}, "Generated"), h("dd", {}, when(e.generatedAt)), h("dt", {}, "Valid until"), h("dd", {}, when(e.validUntil)), h("dt", {}, "Route"), h("dd", {}, `${e.fromState} → ${e.toState}, ${e.transport.distanceKm} km by ${e.transport.mode}`),
          h("dt", {}, "Vehicle"), h("dd", {}, e.transport.vehicleNumber || "—"), h("dt", {}, "Value"), h("dd", {}, `${inr(e.totals.taxable)} + ${inr(e.totals.tax)} tax = ${inr(e.totals.total)}`), e.cancelledAt ? [h("dt", {}, "Cancelled"), h("dd", {}, `${when(e.cancelledAt)} · ${e.cancelReason || ""}`)] : null, e.consolidatedInto ? [h("dt", {}, "Consolidated into"), h("dd", { class: "mono" }, e.consolidatedInto)] : null)),
        h("div", { class: "card" }, h("h2", {}, "History"), table([{ label: "Time", render: (r) => when(r.at) }, { label: "Event", key: "action" }, { label: "Detail", wrap: true, key: "detail" }], e.history || []))),
      h("div", { class: "card section" }, h("h2", {}, "Submissions"), table([{ label: "Request", mono: true, render: (r) => r.id.slice(0, 8) }, { label: "Created", render: (r) => when(r.createdAt) }, { label: "Completed", render: (r) => when(r.completedAt) }, { label: "State", render: (r) => badge(r.state) }, { label: "Code", mono: true, render: (r) => r.safeErrorCode || "" }], d.requests, { empty: "No submission records." })),
      d.ledger ? h("div", { class: "card section" }, h("h2", {}, "Credit entries"), table([{ label: "Time", render: (r) => when(r.at) }, { label: "Type", key: "kind" }, { label: "Credits", num: true, key: "credits" }, { label: "State", render: (r) => badge(r.status) }, { label: "Entry", mono: true, key: "id" }], d.ledger, { empty: "No credit entries for this bill." })) : null,
      d.apiCalls ? h("div", { class: "card section" }, h("h2", {}, "Provider calls"), table([{ label: "Time", render: (r) => when(r.at) }, { label: "Operation", mono: true, key: "operation" }, { label: "Outcome", render: (r) => badge(r.outcome) }, { label: "HTTP", num: true, key: "httpStatus" }, { label: "Time taken", num: true, render: (r) => ms(r.durationMs) }, { label: "Try", num: true, key: "attempt" }], d.apiCalls, { empty: "No calls logged (bills from before API logging started have none)." })) : null);
  }

  async function paymentDetail(view, uid, id) {
    view.append(h("p", {}, h("a", { href: "#/payments" }, "← All payments")));
    const d = await api(`/payments/${encodeURIComponent(uid)}/${encodeURIComponent(id)}`);
    const p = d.purchase;
    const credited = d.credits.reduce((sum, entry) => sum + entry.credits, 0);
    const consistent = (p.status === "paid" && credited === p.credits) || (p.status !== "paid" && credited === 0);
    view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, `${inr(p.amountPaise)} · ${num(p.credits)} credits`), h("p", { class: "mono" }, p.id)),
      h("div", { class: "filters", style: "margin:0" }, badge(p.status), outcomeBadge(d.outcome), canDo("payments.recheck") && p.provider === "razorpay" && p.status !== "paid" ? h("button", { class: "btn primary", onclick: recheck }, "Re-check with Razorpay") : null)),
      h("div", { class: `notice ${consistent ? "" : "bad"}` }, consistent ? (p.status === "paid" ? `Reconciled: paid, and ${num(credited)} credits were added once.` : "Not paid, and no credits were added.") : `Mismatch: status ${p.status}, ${num(credited)} credits added for a ${num(p.credits)}-credit purchase.`),
      h("div", { class: "grid two" },
        h("div", { class: "card" }, h("h2", {}, "Order"), h("dl", { class: "kv" }, h("dt", {}, "Customer"), h("dd", {}, h("a", { href: `#/users/${encodeURIComponent(uid)}` }, uid)), h("dt", {}, "Gateway"), h("dd", {}, p.provider), h("dt", {}, "Payment ID"), h("dd", { class: "mono" }, p.paymentId || "—"),
          h("dt", {}, "Amount"), h("dd", {}, `${inr(p.amountPaise)} INR (gross; fees and GST not recorded)`), h("dt", {}, "Created"), h("dd", {}, when(p.createdAt)), h("dt", {}, "Paid"), h("dd", {}, when(p.paidAt)), h("dt", {}, "Receipt"), h("dd", {}, "Not issued by the app"), h("dt", {}, "Refunds"), h("dd", {}, "Not tracked by the app"))),
        h("div", { class: "card" }, h("h2", {}, "Credits added"), table([{ label: "Time", render: (r) => when(r.at) }, { label: "Credits", num: true, key: "credits" }, { label: "Entry", mono: true, key: "id" }], d.credits, { empty: "None." }))),
      h("div", { class: "card section" }, h("h2", {}, "In the app"), table([{ label: "Time", render: (r) => when(r.at) }, { label: "Step", render: (r) => stepBadge(r.step) }, { label: "Credits", num: true, render: (r) => num(r.credits) }, { label: "Note", wrap: true, render: (r) => r.note || "" }, { label: "App", render: (r) => r.appVersion || "—" }], d.appSteps || [], { empty: "No steps reported (app before 1.3.11, or a payment made elsewhere)." })),
      h("div", { class: "card section" }, h("h2", {}, "Webhook deliveries"), table([{ label: "Received", render: (r) => when(r.at) }, { label: "Event", key: "event" }, { label: "Amount paid", num: true, render: (r) => inr(r.amountPaid) }, { label: "Credited", render: (r) => (r.credited ? "yes" : "no (already settled or short)") }], d.events, { empty: "No webhook received for this link." })));
    async function recheck() {
      try { const result = await api(`/payments/${encodeURIComponent(uid)}/${encodeURIComponent(id)}/recheck`, { body: {} }); toast(result.credited ? "Paid: credits added." : `Razorpay says: ${result.gateway.status}. No change.`); render(); } catch (error) { toast(error.message); }
    }
  }

  /* ---------- Small parts ---------- */

  function head(title, about, right) {
    return h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), about ? h("p", {}, about) : null), right || null);
  }
  function select(label, value, options, onChange) {
    return h("select", { class: "input", "aria-label": label, onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
  }
  function filterQuery(state) {
    return Object.entries(state).filter(([key, value]) => key !== "page" && value !== "" && value !== undefined).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  }
  function quotaTile(quota) {
    return quota ? tile("gstinapi.in credits left", num(quota.creditsRemaining), `as reported ${when(quota.reportedAt)}`) : tile("gstinapi.in credits left", "Not reported", "shown after the provider reports it");
  }
  function notesFor(o) {
    const notes = [];
    if (o.api?.capped) notes.push("API totals cover the latest 20,000 calls in this period.");
    if (o.credits?.ledgerTrimmed) notes.push("Some wallets keep only their last 1,000 credit entries, so older movements are missing from credit totals.");
    return notes.length ? h("div", { class: "notice warn" }, notes.join(" ")) : h("div", { class: "note", style: "margin:-8px 0 12px" }, `${rangeText()} · data as of ${when(o.builtAt)}`);
  }
  function auditTable(items) {
    return table([{ label: "Time", render: (r) => when(r.at) }, { label: "Admin", render: (r) => r.adminEmail || "—" }, { label: "Action", mono: true, key: "action" }, { label: "Target", mono: true, render: (r) => r.target || "" }, { label: "Outcome", key: "outcome" }, { label: "Reason", wrap: true, render: (r) => r.reason || "" }], items, { empty: "No admin activity." });
  }

  /* ---------- Shell, routing, sign-in ---------- */

  function go(path) { location.hash = `#/${path}`; }

  function route() {
    const [id = "overview", ...params] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    return { id, params };
  }

  async function render() {
    if (!me) return;
    const { id, params } = route();
    const allowed = NAV.filter((item) => item.id && canDo(item.permission));
    const current = allowed.find((item) => item.id === id) || allowed[0];
    const shell = h("div", { class: "shell" });
    const nav = h("nav", { class: "nav", "aria-label": "Admin sections" }, NAV.filter((item) => !item.id || canDo(item.permission)).map((item) => item.id
      ? h("a", { href: `#/${item.id}`, "aria-current": item.id === current?.id ? "page" : null, onclick: () => shell.classList.remove("nav-open") }, item.label)
      : h("div", { class: "group" }, item.group)));
    const view = h("main", { class: "content", id: "main" });
    shell.append(
      h("aside", { class: "sidebar" }, h("div", { class: "brand" }, h("div", { class: "brand-mark" }, "EW"), "E-Way Easy Admin"), nav),
      h("div", { class: "main" },
        h("header", { class: "topbar" }, h("button", { class: "btn menu-btn", "aria-label": "Open menu", onclick: () => shell.classList.toggle("nav-open") }, "☰"),
          h("strong", {}, current?.label || ""),
          h("div", { class: "who" }, h("span", {}, `${me.email} · ${me.roleLabel}`), h("button", { class: "btn small", onclick: () => render() }, "Refresh"), h("button", { class: "btn small", onclick: () => auth.signOut() }, "Sign out"))),
        view));
    put(app, shell);
    if (!current) { view.append(h("div", { class: "notice" }, "Your role has no sections.")); return; }
    try {
      await pages[current.id](view, current.id === id ? params : []);
    } catch (error) {
      if (error.code === "not_admin") { me = null; return showDenied(); }
      view.append(errorBox(error, render));
    }
  }

  function showLogin(message) {
    const email = h("input", { class: "input", type: "email", required: true, autocomplete: "username", placeholder: "you@company.com", "aria-label": "Email" });
    const password = h("input", { class: "input", type: "password", required: true, autocomplete: "current-password", placeholder: "Password", "aria-label": "Password" });
    const error = h("div", { class: "notice bad", hidden: !message }, message || "");
    const fail = (e) => { error.hidden = false; error.textContent = /popup|cancel/i.test(e.code || "") ? "Sign-in was cancelled." : e.message || "Sign-in failed."; };
    put(app, h("div", { class: "center-screen" }, h("div", { class: "card login" },
      h("div", { class: "brand" }, h("div", { class: "brand-mark" }, "EW"), "E-Way Easy Admin"),
      h("p", { style: "margin:0;color:var(--text-2)" }, "Sign in with an admin account. Access is checked by the server."), error,
      h("button", { class: "btn primary", style: "width:100%;justify-content:center;margin-top:12px", onclick: () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(fail) }, "Continue with Google"),
      h("div", { class: "divider" }, "or"),
      h("form", { onsubmit: (e) => { e.preventDefault(); auth.signInWithEmailAndPassword(email.value.trim(), password.value).catch(fail); } }, email, password,
        h("button", { class: "btn", type: "submit", style: "justify-content:center" }, "Sign in with email"),
        h("button", { class: "btn small", type: "button", style: "justify-content:center", onclick: () => { if (!email.value) return fail({ message: "Enter your email first." }); auth.sendPasswordResetEmail(email.value.trim()).then(() => { error.hidden = false; error.className = "notice"; error.textContent = "If the account exists, a reset link was sent."; }).catch(fail); } }, "Forgot password")))));
  }

  function showDenied() {
    put(app, h("div", { class: "center-screen" }, h("div", { class: "card login" }, h("h1", {}, "No admin access"),
      h("p", { style: "color:var(--text-2)" }, `${auth.currentUser?.email || "This account"} is signed in but has no admin role. Ask a super admin to add you, then sign in again.`),
      h("button", { class: "btn primary", onclick: () => auth.signOut() }, "Sign out"))));
  }

  async function start() {
    let config;
    try {
      const response = await fetch("/__/firebase/init.json");
      if (!response.ok) throw new Error(String(response.status));
      config = await response.json();
    } catch {
      put(app, h("div", { class: "center-screen" }, h("div", { class: "card login" }, h("h1", {}, "Setup needed"),
        h("p", {}, "Open the panel from your Firebase Hosting site (https://<project>.web.app/admin/). The Firebase project needs a Web app registered (Firebase console → Project settings → Your apps → Add app → Web)."))));
      return;
    }
    firebase.initializeApp(config);
    auth = firebase.auth();
    // Sessions end when the browser closes; tokens refresh hourly and are checked by the server.
    await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => undefined);
    auth.onAuthStateChanged(async (user) => {
      me = null;
      if (!user) return showLogin();
      put(app, h("div", { class: "center-screen" }, h("div", { class: "spinner", "aria-label": "Checking access" })));
      try {
        me = await api("/me");
        render();
      } catch (error) {
        if (error.code === "not_admin") return showDenied();
        if (error.code === "email_unverified") return showLogin("Verify your email address first.");
        showLogin(error.message);
      }
    });
    window.addEventListener("hashchange", () => render());
    // Signed-in admins are signed out after 30 minutes without activity.
    let idle;
    const touch = () => { clearTimeout(idle); idle = setTimeout(() => { if (auth.currentUser) { auth.signOut(); toast("Signed out after 30 minutes without activity."); } }, 30 * 60_000); };
    for (const event of ["click", "keydown", "pointermove"]) document.addEventListener(event, touch, { passive: true });
    touch();
  }

  start();
})();
