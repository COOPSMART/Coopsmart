"use strict";

/*
 COOPSMART - connected to Supabase.
 The publishable key below is meant to be public. Security is enforced by the
 database (login + row level security), NOT by this file.
 NEVER put a "secret" or "service_role" key in this file.
*/

const SUPABASE_URL = "https://ylydyviksamphxunlvhe.supabase.co";
const SUPABASE_KEY = "sb_publishable_n_hEiIWVybEtOKjS6QXCXw_B8fbj4kB";

const $ = id => document.getElementById(id);

if (!window.supabase) {
  document.body.insertAdjacentHTML("afterbegin",
    "<p style='padding:16px;color:#a93226'>Could not load the Supabase library. Check your internet connection and reload.</p>");
  throw new Error("Supabase library not loaded");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- Menu rules (display only; the database enforces them) ---------- */

const moduleRules = {
  "SACCO": ["core", "sacco"],
  "Agricultural Cooperative": ["core", "agriculture", "sales", "inventory"],
  "Marketing Cooperative": ["core", "sales", "inventory"],
  "Consumer Cooperative": ["core", "sales", "inventory"],
  "Other Cooperative": ["core"]
};

const rolePermissions = {
  "Manager": ["members","shares","savings","loans","repayments","produce","sales","inventory","reports","users","activity"],
  "Accountant": ["members","shares","savings","loans","repayments","reports"],
  "Secretary": ["members","shares","reports","activity"],
  "Records Officer": ["members","shares","produce","sales","inventory","reports"],
  "Loan Officer": ["members","loans","repayments","reports"]
};

const cooperativePermissions = {
  "SACCO": ["members","shares","savings","loans","repayments","reports","users","activity"],
  "Agricultural Cooperative": ["members","shares","produce","sales","inventory","reports","users","activity"],
  "Marketing Cooperative": ["members","shares","sales","inventory","reports","users","activity"],
  "Consumer Cooperative": ["members","shares","sales","inventory","reports","users","activity"],
  "Other Cooperative": ["members","shares","reports","users","activity"]
};

/* ---------- State ---------- */

let me = null;
let coop = null;
let D = emptyData();

function emptyData() {
  return { members: [], shares: [], savings: [], loans: [], repayments: [],
    produce: [], sales: [], users: [], activity: [], notifications: [] };
}

/* ---------- Helpers ---------- */

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const num = v => Number(v) || 0;
const r2 = v => Math.round(v * 100) / 100;
const sum = (rows, f) => r2(rows.reduce((n, x) => n + num(f(x)), 0));

const money = v => "MWK " + num(v).toLocaleString("en-MW", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

function today() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

function msg(id, text, kind = "success") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "message " + kind;
}

const slug = s => String(s).trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const memberEmail = (reg, username) =>
  `${slug(username)}--${slug(reg)}@members.coopsmart.app`;

function friendly(e) {
  const m = e?.message || String(e);
  if (/members_number_uq/.test(m)) return "That member number already exists in this cooperative.";
  if (/cooperatives_reg_uq/.test(m)) return "That registration number is already in use.";
  if (/row-level security|permission denied/i.test(m)) return "You do not have permission to do that.";
  return m;
}

function setDefaultDates() {
  ["memberDate","shareDate","savingsDate","loanDate","repaymentDate","produceDate","saleDate"]
    .forEach(id => { const el = $(id); if (el && !el.value) el.value = today(); });
}

function setOptions(id, options, placeholder) {
  const select = $(id);
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.appendChild(first);
  options.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  });
  if (options.some(o => o.value === previous)) select.value = previous;
}

const item = (title, body, small) =>
  `<div class="list-item"><strong>${title}</strong>${body}${small ? `<small>${small}</small>` : ""}</div>`;

function list(id, rows, fn, empty) {
  const el = $(id);
  if (el) el.innerHTML = rows.length ? rows.map(fn).join("") : `<p class='muted'>${esc(empty)}</p>`;
}

const memberName = id => D.members.find(m => m.id === id)?.full_name || "Member";
const latest = (rows, n = 12) => rows.slice(-n).reverse();

/* ---------- Loading data ---------- */

async function fetchTable(table) {
  const { data, error } = await db.from(table).select("*")
    .order("created_at", { ascending: true });
  if (error) { console.error(table, error); return []; }
  return data;
}

async function loadAll() {
  const [members, shares, savings, loans, repayments, produce, sales, users, activity, notifications] =
    await Promise.all([
      fetchTable("members"), fetchTable("shares"), fetchTable("savings_transactions"),
      fetchTable("loan_balances"), fetchTable("repayments"), fetchTable("produce_records"),
      fetchTable("sales"), fetchTable("profiles"), fetchTable("activity_log"),
      fetchTable("notifications")
    ]);
  D = { members, shares, savings, loans, repayments, produce, sales, users, activity, notifications };
}

async function refresh() {
  await loadAll();
  renderAll();
}

/* ---------- Visibility ---------- */

function applyVisibility() {
  const modules = moduleRules[coop?.type] || ["core"];
  const roleAccess = me?.role === "staff" ? (rolePermissions[me.position] || []) : [];
  const coopAccess = cooperativePermissions[coop?.type] || [];

  document.querySelectorAll("[data-module], [data-permission]").forEach(el => {
    const moduleOK = !el.dataset.module || modules.includes(el.dataset.module);
    const permOK = !el.dataset.permission ||
      (me?.role === "staff" && roleAccess.includes(el.dataset.permission) &&
        coopAccess.includes(el.dataset.permission));
    el.hidden = !(moduleOK && permOK);
  });
}

/* ---------- Calculations ---------- */

function calcInventory() {
  const map = new Map();
  const get = (name, unit) => {
    const key = (name + "|" + unit).toLowerCase();
    if (!map.has(key)) map.set(key, { itemName: name, unit, received: 0, sold: 0 });
    return map.get(key);
  };
  D.produce.forEach(p => { get(p.produce_name, p.unit).received += num(p.quantity); });
  D.sales.filter(s => s.item_type === "Produce")
    .forEach(s => { get(s.item_name, s.unit).sold += num(s.quantity); });
  return [...map.values()].map(x => ({
    ...x,
    remaining: r2(x.received - x.sold),
    status: x.received - x.sold <= 10 ? "Low stock" : "Available"
  }));
}

/* ---------- Rendering: staff ---------- */

function renderAll() {
  if (!me) return;
  if (me.role === "staff") renderStaff(); else renderMember();
}

function renderStaff() {
  const q = ($("memberSearch")?.value || "").toLowerCase();

  list("memberList",
    D.members.filter(m => (m.member_number + " " + m.full_name + " " + (m.phone || "")).toLowerCase().includes(q)),
    m => item(esc(m.full_name),
      `${esc(m.member_number)} · ${esc(m.phone || "No phone")}`,
      `Registered: ${esc(m.registration_date || "—")}`),
    "No members found.");

  list("shareList", latest(D.shares),
    s => item(esc(memberName(s.member_id)),
      `${num(s.quantity)} shares · ${money(s.total_value)}`, esc(s.date)),
    "No share records yet.");

  list("savingsList", latest(D.savings),
    s => item(`${esc(memberName(s.member_id))} — ${esc(s.type)}`, money(s.amount), esc(s.date)),
    "No savings transactions yet.");

  list("loanList", latest(D.loans),
    l => item(`${esc(l.loan_ref)} · ${esc(memberName(l.member_id))}`,
      `${esc(l.purpose)} — Principal ${money(l.principal)}`,
      `Total payable: ${money(l.total_payable)} · Outstanding: ${money(l.outstanding)}`),
    "No loans recorded.");

  list("repaymentList", latest(D.repayments),
    r => item(esc(memberName(r.member_id)), money(r.amount),
      `Loan: ${esc(D.loans.find(l => l.id === r.loan_id)?.loan_ref || "")} · ${esc(r.date)}`),
    "No repayments recorded.");

  list("produceList", latest(D.produce),
    p => item(`${esc(p.produce_name)} · ${esc(memberName(p.member_id))}`,
      `${num(p.quantity)} ${esc(p.unit)}`, esc(p.date)),
    "No produce received yet.");

  list("saleList", latest(D.sales),
    s => item(`${esc(s.item_name)} (${esc(s.item_type)})`,
      `${num(s.quantity)} ${esc(s.unit)} · ${money(s.total_value)}`, esc(s.date)),
    "No sales recorded yet.");

  const inv = calcInventory();
  list("inventoryList", inv,
    i => item(`${esc(i.itemName)} — ${i.status}`,
      `Received: ${i.received} ${esc(i.unit)} · Sold: ${i.sold} · Remaining: ${i.remaining}`,
      "Low stock means 10 units or fewer."),
    "No inventory records yet.");

  list("userList", D.users,
    u => item(esc(u.full_name),
      `${esc(u.role === "staff" ? u.email : u.username)} · ${esc(u.role === "staff" ? u.position : "Member")}`,
      `Account: ${esc(u.role)}`),
    "No accounts yet.");

  list("activityList", D.activity.slice(-40).reverse(),
    a => item(`${esc(a.user_name)} (${esc(a.user_role)})`, esc(a.action),
      esc(new Date(a.created_at).toLocaleString())),
    "No activities have been recorded yet.");

  const staffNotes = D.notifications.slice().reverse();
  const noteHTML = n => item(esc(n.category || "Notification"), esc(n.message),
    esc(new Date(n.created_at).toLocaleString()));
  list("staffNotifications", staffNotes, noteHTML, "No staff notifications.");
  list("dashboardNotifications", staffNotes.slice(0, 5), noteHTML, "No notifications yet.");
  list("dashboardRecentActivities", D.activity.slice(-5).reverse(),
    a => item(esc(a.user_name), esc(a.action), esc(new Date(a.created_at).toLocaleString())),
    "No recent activities.");

  renderSelects();
  renderStats(inv);
}

function renderSelects() {
  const opts = D.members.map(m => ({ value: m.id, label: `${m.member_number} — ${m.full_name}` }));
  ["shareMember", "savingsMember", "loanMember", "produceMember"]
    .forEach(id => setOptions(id, opts, "Choose a member"));

  setOptions("repaymentLoan",
    D.loans.filter(l => num(l.outstanding) > 0).map(l => ({
      value: l.id,
      label: `${l.loan_ref} — ${memberName(l.member_id)} — ${money(l.outstanding)} outstanding`
    })), "Choose an active loan");
}

function renderStats(inv) {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  const shareQty = sum(D.shares, s => s.quantity);
  const shareVal = sum(D.shares, s => s.total_value);
  const deposits = sum(D.savings.filter(s => s.type === "Deposit"), s => s.amount);
  const withdrawals = sum(D.savings.filter(s => s.type === "Withdrawal"), s => s.amount);
  const loansIssued = sum(D.loans, l => l.principal);
  const repaid = sum(D.repayments, r => r.amount);
  const outstanding = sum(D.loans, l => l.outstanding);
  const activeLoans = D.loans.filter(l => num(l.outstanding) > 0).length;
  const produceQty = sum(D.produce, p => p.quantity);
  const salesTotal = sum(D.sales, s => s.total_value);
  const lowStock = inv.filter(i => i.remaining <= 10).length;

  const values = {
    Members: D.members.length,
    Shares: shareQty.toLocaleString(),
    ShareValue: money(shareVal),
    Savings: money(deposits - withdrawals),
    Repayments: money(repaid),
    Outstanding: money(outstanding),
    ActiveLoans: activeLoans,
    Produce: produceQty.toLocaleString(),
    Sales: money(salesTotal),
    InventoryItems: inv.length,
    LowStock: lowStock
  };
  Object.entries(values).forEach(([k, v]) => { set("dashboard" + k, v); set("report" + k, v); });
  set("dashboardLoansIssued", money(loansIssued));
  set("reportLoans", money(loansIssued));
  set("reportCooperativeName", `${coop.name} · ${coop.type} · ${coop.district}`);
}

/* ---------- Rendering: member ---------- */

function renderMember() {
  const m = D.members[0];
  $("memberWelcome").textContent = "Welcome, " + me.full_name;
  $("myMemberName").textContent = me.full_name;
  $("myMemberUsername").textContent = me.username || "—";
  $("myMemberNumber").textContent = m?.member_number || "Not linked";
  $("myMemberCooperative").textContent = coop.name;

  const shareQty = sum(D.shares, s => s.quantity);
  const shareVal = sum(D.shares, s => s.total_value);
  const balance = r2(D.savings.reduce((n, s) => n + (s.type === "Deposit" ? 1 : -1) * num(s.amount), 0));

  $("myShareQuantity").textContent = shareQty.toLocaleString();
  $("myShareValue").textContent = money(shareVal);
  $("mySavingsBalance").textContent = money(balance);

  list("myLoanList", D.loans,
    l => item(`${esc(l.loan_ref)} — ${esc(l.purpose)}`, `Principal: ${money(l.principal)}`,
      `Total payable: ${money(l.total_payable)} · Paid: ${money(l.paid)} · Outstanding: ${money(l.outstanding)}`),
    "No loans recorded.");

  list("myRepaymentList", D.repayments.slice().reverse(),
    r => item(money(r.amount), "", esc(r.date)), "No repayments recorded.");

  list("memberNotifications", D.notifications.slice().reverse(),
    n => item(n.read ? "Read" : "Unread", esc(n.message), esc(new Date(n.created_at).toLocaleString())) +
      (!n.read && n.recipient_user === me.id
        ? `<button type="button" class="button-small button-secondary" data-mark-read="${esc(n.id)}">Mark as read</button>`
        : ""),
    "No notifications.");

  renderStatement(m, shareQty, shareVal, balance);
}

function renderStatement(m, shareQty, shareVal, balance) {
  const box = $("myStatement");
  if (!m) { box.innerHTML = "<p class='muted'>No member record is linked to this account.</p>"; return; }

  const rows = [
    ...D.shares.map(x => ({ date: x.date, type: "Shares", description: `${x.quantity} shares`, amount: x.total_value })),
    ...D.savings.map(x => ({ date: x.date, type: "Savings " + x.type, description: x.type, amount: x.amount })),
    ...D.loans.map(x => ({ date: x.date, type: "Loan", description: x.purpose, amount: x.principal })),
    ...D.repayments.map(x => ({ date: x.date, type: "Repayment", description: "Loan repayment", amount: x.amount }))
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  box.innerHTML = `
    <h3>${esc(coop.name)} — Member Statement</h3>
    <p><strong>${esc(m.full_name)}</strong> · Member no. ${esc(m.member_number)}</p>
    <div class="stats-grid">
      <div class="stat"><span>Total shares</span><strong>${shareQty}</strong></div>
      <div class="stat"><span>Share value</span><strong>${money(shareVal)}</strong></div>
      <div class="stat"><span>Savings balance</span><strong>${money(balance)}</strong></div>
      <div class="stat"><span>Loan outstanding</span><strong>${money(sum(D.loans, l => l.outstanding))}</strong></div>
    </div>
    <h3>Transactions</h3>
    ${rows.length ? `<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>
      ${rows.map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.type)}</td><td>${esc(t.description)}</td><td>${money(t.amount)}</td></tr>`).join("")}
      </tbody></table>` : "<p class='muted'>No transactions recorded yet.</p>"}`;
}
/* ---------- Activity and notifications ---------- */

async function logActivity(action) {
  if (!me) return;
  const { error } = await db.from("activity_log").insert({
    user_name: me.full_name,
    user_role: me.role === "staff" ? me.position : "Member",
    action
  });
  if (error) console.error("Activity log:", error);
}

async function notify(type, text, category) {
  const { error } = await db.from("notifications")
    .insert({ recipient_type: type, message: text, category });
  if (error) console.error("Notification:", error);
}

async function checkLowStock() {
  let created = false;
  for (const i of calcInventory()) {
    if (i.remaining < 0 || i.remaining > 10) continue;
    const text = `Low stock alert: ${i.itemName} has ${i.remaining} ${i.unit} remaining.`;
    if (!D.notifications.some(n => n.message === text && n.recipient_type === "ALL_STAFF")) {
      await notify("ALL_STAFF", text, "low-stock");
      created = true;
    }
  }
  if (created) await refresh();
}

/* ---------- Session ---------- */

async function loadProfile() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return false;

  const { data, error } = await db.from("profiles")
    .select("*, cooperatives(*)").eq("id", session.user.id).maybeSingle();

  if (error || !data) {
    await db.auth.signOut();
    return false;
  }
  me = data;
  coop = data.cooperatives;
  return true;
}

async function enterApp() {
  $("introSection").hidden = true;
  $("setupSection").hidden = true;
  $("loginSection").hidden = true;
  $("appSection").hidden = false;

  $("staffDashboard").hidden = me.role !== "staff";
  $("memberDashboard").hidden = me.role !== "member";
  $("currentUserName").textContent = me.full_name;
  $("currentUserRole").textContent = me.role === "staff" ? me.position : "Member";
  $("currentUserCooperative").textContent = coop.name;

  applyVisibility();
  setDefaultDates();
  await refresh();
  window.scrollTo({ top: 0 });
}

async function leaveApp() {
  await db.auth.signOut();
  me = null; coop = null; D = emptyData();
  $("appSection").hidden = true;
  $("introSection").hidden = false;
  $("setupSection").hidden = false;
  $("loginSection").hidden = false;
  $("loginForm").reset();
  toggleLoginMode();
}

function toggleLoginMode() {
  const member = $("loginMode").value === "member";
  $("loginEmailWrap").hidden = member;
  $("loginRegWrap").hidden = !member;
  $("loginUserWrap").hidden = !member;
  $("loginEmail").required = !member;
  $("loginReg").required = member;
  $("loginUsername").required = member;
}

/* ---------- Form helper ---------- */

function onSubmit(formId, handler) {
  const form = $(formId);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try { await handler(); }
    catch (e) { console.error(e); alert(friendly(e)); }
    finally { if (btn) btn.disabled = false; }
  });
}

async function addRecord(table, row, formId, activityText) {
  const { error } = await db.from(table).insert(row);
  if (error) { alert(friendly(error)); return false; }
  $(formId).reset();
  setDefaultDates();
  await logActivity(activityText);
  await refresh();
  return true;
}

/* ---------- Register a cooperative ---------- */

onSubmit("cooperativeForm", async () => {
  const email = $("registrantEmail").value.trim();
  const password = $("registrantPassword").value;
  msg("cooperativeMessage", "Registering...", "success");

  let { data, error } = await db.auth.signUp({ email, password });

  if (error && /already/i.test(error.message)) {
    ({ data, error } = await db.auth.signInWithPassword({ email, password }));
  }
  if (error) { msg("cooperativeMessage", friendly(error), "error"); return; }
  if (!data.session) {
    msg("cooperativeMessage",
      "Account created, but email confirmation is still switched on in Supabase. Turn it off and try again.", "error");
    return;
  }

  const { error: rpcError } = await db.rpc("register_cooperative", {
    p_name: $("cooperativeName").value,
    p_type: $("cooperativeType").value,
    p_registration: $("cooperativeRegistration").value,
    p_district: $("cooperativeDistrict").value,
    p_full_name: $("registrantName").value
  });

  if (rpcError) { msg("cooperativeMessage", friendly(rpcError), "error"); return; }

  $("cooperativeForm").reset();
  msg("cooperativeMessage", "Cooperative registered.", "success");
  if (await loadProfile()) { await enterApp(); await logActivity("Registered the cooperative"); await refresh(); }
});

/* ---------- Login / logout ---------- */

$("loginMode").addEventListener("change", toggleLoginMode);

onSubmit("loginForm", async () => {
  const member = $("loginMode").value === "member";
  const email = member
    ? memberEmail($("loginReg").value, $("loginUsername").value)
    : $("loginEmail").value.trim();

  const { error } = await db.auth.signInWithPassword({
    email, password: $("loginPassword").value
  });

  if (error) {
    msg("loginMessage", "Login failed. Check your details and try again.", "error");
    return;
  }
  if (!(await loadProfile())) {
    msg("loginMessage", "This account is not linked to a cooperative yet. Register a cooperative first.", "error");
    return;
  }
  msg("loginMessage", "", "success");
  await enterApp();
  await logActivity("Logged in");
  await refresh();
});

$("logoutButton").addEventListener("click", leaveApp);

/* ---------- Members, shares, savings, loans, repayments ---------- */

onSubmit("memberForm", async () => {
  const number = $("memberNumber").value.trim();
  const name = $("memberFullName").value.trim();
  const ok = await addRecord("members", {
    member_number: number,
    full_name: name,
    phone: $("memberPhone").value.trim() || null,
    gender: $("memberGender").value || null,
    registration_date: $("memberDate").value
  }, "memberForm", "Registered member " + number);
  if (ok) await notify("ALL_STAFF", "New member registered: " + name, "member");
  if (ok) await refresh();
});

$("memberSearch").addEventListener("input", () => { if (me?.role === "staff") renderStaff(); });

onSubmit("shareForm", async () => {
  const memberId = $("shareMember").value;
  await addRecord("shares", {
    member_id: memberId,
    quantity: Number($("shareQuantity").value),
    price_per_share: Number($("sharePrice").value),
    date: $("shareDate").value
  }, "shareForm", "Recorded shares for " + memberName(memberId));
});

onSubmit("savingsForm", async () => {
  const memberId = $("savingsMember").value;
  const type = $("savingsTransaction").value;
  await addRecord("savings_transactions", {
    member_id: memberId,
    type,
    amount: Number($("savingsAmount").value),
    date: $("savingsDate").value
  }, "savingsForm", `Recorded savings ${type.toLowerCase()} for ${memberName(memberId)}`);
});

onSubmit("loanForm", async () => {
  const memberId = $("loanMember").value;
  const amount = Number($("loanAmount").value);
  const ok = await addRecord("loans", {
    member_id: memberId,
    purpose: $("loanType").value.trim(),
    principal: amount,
    interest_rate: Number($("loanInterest").value),
    term_months: Number($("loanTerm").value),
    date: $("loanDate").value
  }, "loanForm", "Recorded loan for " + memberName(memberId));
  if (ok) await notify("ALL_STAFF", `Loan recorded for ${memberName(memberId)}: ${money(amount)}`, "loan");
  if (ok) await refresh();
});

onSubmit("repaymentForm", async () => {
  const loan = D.loans.find(l => l.id === $("repaymentLoan").value);
  await addRecord("repayments", {
    loan_id: $("repaymentLoan").value,
    amount: Number($("repaymentAmount").value),
    date: $("repaymentDate").value
  }, "repaymentForm", "Recorded repayment for " + (loan?.loan_ref || "loan"));
});

/* ---------- Produce and sales ---------- */

onSubmit("produceForm", async () => {
  const name = $("produceName").value;
  const ok = await addRecord("produce_records", {
    member_id: $("produceMember").value,
    produce_name: name,
    quantity: Number($("produceQuantity").value),
    unit: $("produceUnit").value,
    date: $("produceDate").value
  }, "produceForm", "Recorded produce received: " + name);
  if (ok) await checkLowStock();
});

onSubmit("saleForm", async () => {
  const itemName = $("saleItemName").value.trim();
  const ok = await addRecord("sales", {
    item_type: $("saleType").value,
    item_name: itemName,
    quantity: Number($("saleQuantity").value),
    unit: $("saleUnit").value,
    price_per_unit: Number($("salePrice").value),
    date: $("saleDate").value
  }, "saleForm", "Recorded sale: " + itemName);
  if (ok) await checkLowStock();
});

$("saleType").addEventListener("change", () => {
  $("saleItemName").placeholder = $("saleType").value === "Produce"
    ? "Enter exact produce name, e.g. Maize" : "Enter product name";
});

/* ---------- Refresh, print, mark as read ---------- */

$("refreshReports").addEventListener("click", refresh);
$("refreshStatement").addEventListener("click", refresh);
$("printStatement").addEventListener("click", () => window.print());

document.addEventListener("click", async event => {
  const btn = event.target.closest("[data-mark-read]");
  if (!btn || !me) return;
  const { error } = await db.from("notifications")
    .update({ read: true }).eq("id", btn.dataset.markRead);
  if (error) { alert(friendly(error)); return; }
  await refresh();
});

/* ---------- Start ---------- */

(async function init() {
  setDefaultDates();
  toggleLoginMode();
  $("appSection").hidden = true;
  if (await loadProfile()) await enterApp();
})();
/* ===================================================
   ACCOUNT CREATION (Manager only)
   =================================================== */

const baseRenderStaff = renderStaff;
renderStaff = function () {
  baseRenderStaff();
  renderUserTools();
};

async function fnError(error) {
  try {
    const j = await error.context.json();
    return j.error || error.message;
  } catch {
    return error.message;
  }
}

async function callCreateUser(body) {
  const { data, error } = await db.functions.invoke("create-user", { body });
  if (error) throw new Error(await fnError(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

function toggleAccountType() {
  const member = $("accountType").value === "member";
  $("accountStaffWrap").hidden = member;
  $("accountMemberWrap").hidden = !member;
  $("accountEmail").required = !member;
  $("accountMember").required = member;
  $("accountUsername").required = member;
}

function renderUserTools() {
  const box = $("userList");
  if (!box || me?.position !== "Manager") return;

  if (!$("accountForm")) {
    box.parentElement.querySelector(".notice")?.remove();
    box.insertAdjacentHTML("beforebegin", `
      <form id="accountForm" class="stack-form">
        <label>Account type
          <select id="accountType">
            <option value="staff">Staff (logs in with email)</option>
            <option value="member">Member (logs in with username)</option>
          </select>
        </label>
        <label>Full name<input id="accountName" required maxlength="100"></label>
        <div id="accountStaffWrap" class="stack-form">
          <label>Email<input id="accountEmail" type="email"></label>
          <label>Staff position
            <select id="accountPosition">
              <option>Manager</option>
              <option>Accountant</option>
              <option>Secretary</option>
              <option>Records Officer</option>
              <option>Loan Officer</option>
            </select>
          </label>
        </div>
        <div id="accountMemberWrap" class="stack-form" hidden>
          <label>Member record<select id="accountMember"></select></label>
          <label>Username<input id="accountUsername" maxlength="30" autocomplete="off" placeholder="Letters, numbers, . _ -"></label>
        </div>
        <label>Password (at least 8 characters)
          <input id="accountPassword" type="text" required minlength="8" autocomplete="off">
        </label>
        <button type="submit">Create Account</button>
      </form>
      <div id="accountMessage" class="message" role="status"></div>
    `);

    $("accountType").addEventListener("change", toggleAccountType);

    onSubmit("accountForm", async () => {
      const kind = $("accountType").value;
      const body = {
        kind,
        full_name: $("accountName").value.trim(),
        password: $("accountPassword").value
      };
      if (kind === "staff") {
        body.email = $("accountEmail").value.trim();
        body.position = $("accountPosition").value;
      } else {
        body.member_id = $("accountMember").value;
        body.username = $("accountUsername").value.trim();
      }

      msg("accountMessage", "Creating account...", "success");
      try {
        await callCreateUser(body);
        const how = kind === "member"
          ? ` The member logs in with registration number "${coop.registration_number}" and username "${body.username}".`
          : " The staff member logs in with their email.";
        $("accountForm").reset();
        toggleAccountType();
        await refresh();
        msg("accountMessage", "Account created." + how, "success");
      } catch (e) {
        msg("accountMessage", e.message, "error");
      }
    });

    toggleAccountType();
  }

  const free = D.members.filter(m => !D.users.some(u => u.member_id === m.id));
  setOptions("accountMember",
    free.map(m => ({ value: m.id, label: `${m.member_number} — ${m.full_name}` })),
    "Choose a member without an account");

  list("userList", D.users, u => `
    <div class="list-item">
      <strong>${esc(u.full_name)}</strong>
      ${esc(u.role === "staff" ? u.email : u.username)} · ${esc(u.role === "staff" ? u.position : "Member")}
      ${u.id === me.id ? "<small>This is you</small>" :
        `<button type="button" class="button-small button-secondary"
          data-reset-user="${esc(u.id)}" data-reset-name="${esc(u.full_name)}">Reset password</button>`}
    </div>`, "No accounts yet.");
}

document.addEventListener("click", async event => {
  const btn = event.target.closest("[data-reset-user]");
  if (!btn) return;
  const pw = prompt(`New password for ${btn.dataset.resetName} (at least 8 characters):`);
  if (!pw) return;
  if (pw.length < 8) { alert("Password must be at least 8 characters."); return; }
  try {
    await callCreateUser({ kind: "reset_password", user_id: btn.dataset.resetUser, password: pw });
    alert("Password changed. Tell the user their new password.");
  } catch (e) {
    alert(e.message);
  }
});
