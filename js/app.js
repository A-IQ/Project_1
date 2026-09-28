/* UI controller: wires state, rendering and user actions together. */
(function () {
  "use strict";

  const F = window.Finance;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "INR", "PKR", "AED", "SAR", "CNY", "SGD", "NZD", "ZAR", "SEK", "NOK", "DKK", "BRL", "MXN"];

  let state = Store.load();
  const firstRun = !state;
  if (!state) state = Store.emptyState();

  const ui = {
    tab: "dashboard",
    month: F.monthKey(F.today()),
  };

  // ---------- helpers ----------

  const money = (cents) => F.formatMoney(cents, state.currency);
  const moneyMajor = (value) => F.formatMoney(Math.round(value * 100), state.currency);

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: y === new Date().getFullYear() ? undefined : "numeric" });
  }

  function persist() {
    if (!Store.save(state)) toast("Couldn't save — browser storage is unavailable or full. Export a backup.");
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readFile(input) {
    return new Promise((resolve, reject) => {
      const file = input.files && input.files[0];
      if (!file) return reject(new Error("No file selected"));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function fillCategorySelect(select, type, selected, includeAll) {
    const cats = state.categories[type].slice();
    if (selected && !cats.includes(selected)) cats.push(selected);
    select.innerHTML =
      (includeAll ? '<option value="">All categories</option>' : "") +
      cats.map((c) => `<option ${c === selected ? "selected" : ""}>${escapeHTML(c)}</option>`).join("");
  }

  function sortedTransactions(list) {
    return list.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1));
  }

  // ---------- recurring ----------

  function runRecurring() {
    const { created, rules } = F.materializeRecurring(state.recurring, F.today());
    state.recurring = rules;
    if (created.length) {
      state.transactions.push(...created);
      persist();
      toast(`Added ${created.length} recurring transaction${created.length === 1 ? "" : "s"}.`);
    }
  }

  // ---------- rendering ----------

  function render() {
    $("#month-label").textContent = F.monthLabel(ui.month, "long");
    $$(".tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === ui.tab)));
    $$(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + ui.tab));
    ({
      dashboard: renderDashboard,
      transactions: renderTransactions,
      budgets: renderBudgets,
      goals: renderGoals,
      recurring: renderRecurring,
      settings: renderSettings,
    })[ui.tab]();
  }

  function renderDashboard() {
    $("#welcome").hidden = state.transactions.length > 0;

    const monthTx = F.inMonth(state.transactions, ui.month);
    const s = F.summarize(monthTx);
    const prev = F.summarize(F.inMonth(state.transactions, F.shiftMonth(ui.month, -1)));
    const allTime = F.balance(state.transactions.filter((t) => F.monthKey(t.date) <= ui.month));

    const delta = (cur, before, goodWhenUp) => {
      if (!before) return '<div class="sub">No data last month</div>';
      const pct = Math.round(((cur - before) / before) * 100);
      if (pct === 0) return '<div class="sub">Same as last month</div>';
      const up = pct > 0;
      const good = up === goodWhenUp;
      return `<div class="sub"><span class="${good ? "pos" : "neg"}">${up ? "▲" : "▼"} ${Math.abs(pct)}%</span> vs last month</div>`;
    };

    $("#stats").innerHTML = [
      `<div class="card stat"><div class="label">Income</div><div class="value">${money(s.income)}</div>${delta(s.income, prev.income, true)}</div>`,
      `<div class="card stat"><div class="label">Expenses</div><div class="value">${money(s.expenses)}</div>${delta(s.expenses, prev.expenses, false)}</div>`,
      `<div class="card stat"><div class="label">Net this month</div><div class="value ${s.net >= 0 ? "pos" : "neg"}">${money(s.net)}</div>` +
        `<div class="sub">${s.savingsRate == null ? "No income recorded" : "Savings rate " + Math.round(s.savingsRate * 100) + "%"}</div></div>`,
      `<div class="card stat"><div class="label">Balance to date</div><div class="value">${money(allTime)}</div><div class="sub">All income minus expenses</div></div>`,
    ].join("");

    // Monthly chart (6 months ending at selected month)
    const rows = F.monthlyTotals(state.transactions, ui.month, 6).map((r) => ({
      label: F.monthLabel(r.month),
      fullLabel: F.monthLabel(r.month, "long"),
      income: F.fromCents(r.income),
      expenses: F.fromCents(r.expenses),
    }));
    Charts.incomeExpenseBars($("#chart-monthly"), rows, { currency: state.currency, format: moneyMajor });
    $("#table-monthly").innerHTML =
      `<table><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td>${escapeHTML(r.fullLabel)}</td><td class="num">${moneyMajor(r.income)}</td><td class="num">${moneyMajor(r.expenses)}</td><td class="num">${moneyMajor(r.income - r.expenses)}</td></tr>`).join("") +
      `</tbody></table>`;

    // Category chart: top 7, rest folded into "Everything else"
    let cats = F.totalsByCategory(monthTx, "expense");
    if (cats.length > 8) {
      const rest = cats.slice(7).reduce((sum, c) => sum + c.amount, 0);
      cats = cats.slice(0, 7).concat([{ category: "Everything else", amount: rest }]);
    }
    const catChart = $("#chart-categories");
    $("#categories-empty").hidden = cats.length > 0;
    catChart.hidden = cats.length === 0;
    $("#category-total").textContent = cats.length ? money(s.expenses) + " total" : "";
    if (cats.length) {
      Charts.categoryBars(catChart, cats.map((c) => ({ label: c.category, value: F.fromCents(c.amount) })), { format: moneyMajor });
    }

    // Budgets snapshot
    const b = F.budgetStatus(state.budgets, state.transactions, ui.month);
    $("#dash-budgets").innerHTML = b.rows.length
      ? b.rows.slice(0, 5).map(meterRow).join("")
      : '<p class="empty">No budgets set. <button type="button" class="link-btn" data-goto="budgets">Create one</button></p>';

    // Recent
    const recent = sortedTransactions(state.transactions).slice(0, 6);
    $("#dash-recent").innerHTML = recent.length
      ? recent.map((t) => `<li><div class="desc"><div>${escapeHTML(t.description || t.category)}</div><div class="muted small">${formatDate(t.date)} · ${escapeHTML(t.category)}</div></div>` +
          `<span class="amt ${t.type === "income" ? "pos" : ""}">${t.type === "income" ? "+" : "−"}${money(t.amount)}</span></li>`).join("")
      : '<li class="empty">No transactions yet.</li>';
  }

  const STATUS_TEXT = {
    ok: ["✓", "On track"],
    warning: ["!", "Close to limit"],
    over: ["✕", "Over budget"],
  };

  function meterRow(r) {
    const pct = Math.min(100, Math.round(r.ratio * 100));
    const [icon, text] = STATUS_TEXT[r.status];
    const left = r.remaining >= 0 ? `${money(r.remaining)} left` : `${money(-r.remaining)} over`;
    return `<div class="meter-row">
      <div class="meter-top"><span>${escapeHTML(r.category)}</span><span class="figures">${money(r.spent)} / ${money(r.limit)}</span></div>
      <div class="meter ${r.status}" role="meter" aria-valuemin="0" aria-valuemax="${r.limit}" aria-valuenow="${r.spent}" aria-label="${escapeHTML(r.category)} budget"><span style="width:${pct}%"></span></div>
      <div class="status ${r.status}"><span class="ic" aria-hidden="true">${icon}</span>${text} · ${Math.round(r.ratio * 100)}% used · ${left}</div>
    </div>`;
  }

  function renderTransactions() {
    const catSel = $("#f-category");
    const current = catSel.value;
    const allCats = [...new Set([...state.categories.expense, ...state.categories.income, ...state.transactions.map((t) => t.category)])];
    catSel.innerHTML = '<option value="">All categories</option>' + allCats.map((c) => `<option ${c === current ? "selected" : ""}>${escapeHTML(c)}</option>`).join("");

    const q = $("#f-search").value.trim().toLowerCase();
    const type = $("#f-type").value;
    const period = $("#f-period").value;
    const list = sortedTransactions(state.transactions).filter(
      (t) =>
        (period === "all" || F.monthKey(t.date) === ui.month) &&
        (!type || t.type === type) &&
        (!catSel.value || t.category === catSel.value) &&
        (!q || (t.description || "").toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    );
    const s = F.summarize(list);
    $("#tx-summary").textContent = list.length
      ? `${list.length} transaction${list.length === 1 ? "" : "s"} · in ${money(s.income)} · out ${money(s.expenses)} · net ${money(s.net)}`
      : "";
    $("#tx-empty").hidden = list.length > 0;
    $("#tx-body").innerHTML = list
      .map(
        (t) => `<tr>
        <td class="date">${formatDate(t.date)}</td>
        <td>${escapeHTML(t.description || "—")}${t.recurringId ? '<span class="tag-rec" title="Created by a recurring rule">↻</span>' : ""}</td>
        <td><span class="pill">${escapeHTML(t.category)}</span></td>
        <td class="num ${t.type === "income" ? "pos" : ""}">${t.type === "income" ? "+" : "−"}${money(t.amount)}</td>
        <td class="actions">
          <button type="button" class="link-btn" data-edit="${t.id}">Edit</button>
          <button type="button" class="link-btn" data-delete="${t.id}" aria-label="Delete">Delete</button>
        </td></tr>`
      )
      .join("");
  }

  function renderBudgets() {
    $("#budget-title").textContent = "Budget status · " + F.monthLabel(ui.month, "long");
    const b = F.budgetStatus(state.budgets, state.transactions, ui.month);
    $("#budget-overview").innerHTML = b.rows.length
      ? `<div class="overview">${meterRow({
          category: "All budgeted categories",
          limit: b.totalLimit,
          spent: b.totalSpent,
          remaining: b.totalLimit - b.totalSpent,
          ratio: b.totalSpent / b.totalLimit,
          status: b.totalSpent > b.totalLimit ? "over" : b.totalSpent / b.totalLimit >= F.BUDGET_WARNING_AT ? "warning" : "ok",
        })}</div><h3>By category</h3>`
      : '<p class="empty">No budgets yet — set monthly limits on the right.</p>';
    $("#budget-rows").innerHTML = b.rows.map(meterRow).join("");
    $("#budget-unbudgeted").innerHTML = b.unbudgeted.length
      ? `<h3>Spending without a budget</h3><ul class="tx-list">${b.unbudgeted
          .map((u) => `<li><div class="desc">${escapeHTML(u.category)}</div><span class="amt">${money(u.spent)}</span></li>`)
          .join("")}</ul>`
      : "";

    const cats = [...new Set([...state.categories.expense, ...Object.keys(state.budgets)])];
    $("#budget-form").innerHTML =
      cats
        .map((c, i) => {
          const v = state.budgets[c] ? F.fromCents(state.budgets[c]).toFixed(2) : "";
          return `<label for="bud-${i}">${escapeHTML(c)}</label><input id="bud-${i}" data-category="${escapeHTML(c)}" inputmode="decimal" placeholder="No limit" value="${v}">`;
        })
        .join("") + '<div class="actions row"><button type="submit" class="btn primary">Save budgets</button></div>';
  }

  function renderGoals() {
    const list = $("#goal-list");
    if (!state.goals.length) {
      list.innerHTML = '<div class="card"><p class="empty">No savings goals yet. Create one to track your progress.</p></div>';
      return;
    }
    list.innerHTML = state.goals
      .map((g) => {
        const p = F.goalProgress(g);
        let plan = "";
        if (p.complete) plan = '<span class="pos">✓ Goal reached!</span>';
        else if (p.monthsLeft != null && p.monthsLeft <= 0) plan = `<span class="neg">Target date passed</span> · ${money(p.remaining)} to go`;
        else if (p.monthlyNeeded != null) plan = `Save ${money(p.monthlyNeeded)}/month for ${p.monthsLeft} month${p.monthsLeft === 1 ? "" : "s"} to reach it by ${formatDate(g.deadline)}`;
        else plan = `${money(p.remaining)} to go`;
        return `<article class="card goal-card">
          <header class="card-head"><h2>${escapeHTML(g.name)}</h2><span class="muted small">${Math.round(p.ratio * 100)}%</span></header>
          <div class="goal-figures"><strong>${money(p.saved)}</strong><span class="muted">of ${money(g.target)}</span></div>
          <div class="meter goal" role="meter" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${p.saved}" aria-label="${escapeHTML(g.name)} progress"><span style="width:${Math.round(p.ratio * 100)}%"></span></div>
          <div class="status">${plan}</div>
          <form class="goal-actions" data-goal="${g.id}">
            <input name="amount" inputmode="decimal" placeholder="Amount" aria-label="Amount">
            <button type="submit" class="btn small primary" name="op" value="add">Add</button>
            <button type="submit" class="btn small" name="op" value="withdraw">Withdraw</button>
            <span style="flex:1"></span>
            <button type="button" class="link-btn" data-goal-edit="${g.id}">Edit</button>
            <button type="button" class="link-btn" data-goal-delete="${g.id}">Delete</button>
          </form>
        </article>`;
      })
      .join("");
  }

  const FREQ_TEXT = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly" };

  function renderRecurring() {
    const form = $("#recurring-form");
    const type = form.elements.type.value;
    fillCategorySelect(form.elements.category, type, form.elements.category.value);
    if (!form.elements.startDate.value) form.elements.startDate.value = F.today();

    $("#recurring-empty").hidden = state.recurring.length > 0;
    $("#recurring-list").innerHTML = state.recurring
      .slice()
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
      .map(
        (r) => `<li class="${r.active ? "" : "paused"}">
        <div class="desc"><div>${escapeHTML(r.description || r.category)}</div>
          <div class="muted small">${FREQ_TEXT[r.frequency]} · ${escapeHTML(r.category)} · ${
            !r.active ? "Paused" : r.endDate && r.nextDate > r.endDate ? "Ended" : "Next " + formatDate(r.nextDate)
          }</div></div>
        <span class="amt ${r.type === "income" ? "pos" : ""}">${r.type === "income" ? "+" : "−"}${money(r.amount)}</span>
        <button type="button" class="btn small" data-rec-toggle="${r.id}">${r.active ? "Pause" : "Resume"}</button>
        <button type="button" class="link-btn" data-rec-delete="${r.id}">Delete</button>
      </li>`
      )
      .join("");
  }

  function renderSettings() {
    $("#currency-select").innerHTML = [...new Set([state.currency, ...CURRENCIES])]
      .map((c) => `<option ${c === state.currency ? "selected" : ""}>${c}</option>`)
      .join("");
    for (const kind of ["expense", "income"]) {
      $("#cat-" + kind).innerHTML = state.categories[kind]
        .map((c) => `<li>${escapeHTML(c)}<button type="button" data-cat-remove="${escapeHTML(c)}" data-kind="${kind}" aria-label="Remove ${escapeHTML(c)}">×</button></li>`)
        .join("");
    }
  }

  // ---------- transaction dialog ----------

  const dialog = $("#tx-dialog");
  const txForm = $("#tx-form");

  function openTxDialog(tx) {
    txForm.reset();
    txForm.querySelector(".form-error").textContent = "";
    $("#tx-dialog-title").textContent = tx ? "Edit transaction" : "Add transaction";
    const type = tx ? tx.type : "expense";
    txForm.elements.id.value = tx ? tx.id : "";
    txForm.querySelector(`input[name=type][value=${type}]`).checked = true;
    fillCategorySelect(txForm.elements.category, type, tx ? tx.category : null);
    txForm.elements.amount.value = tx ? F.fromCents(tx.amount).toFixed(2) : "";
    // Default new entries into the month being viewed.
    const defaultDate = F.monthKey(F.today()) === ui.month ? F.today() : ui.month + "-01";
    txForm.elements.date.value = tx ? tx.date : defaultDate;
    txForm.elements.description.value = tx ? tx.description : "";
    dialog.showModal();
    txForm.elements.amount.focus();
  }

  txForm.addEventListener("change", (e) => {
    if (e.target.name === "type") fillCategorySelect(txForm.elements.category, e.target.value);
  });

  txForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(txForm);
    const tx = {
      id: fd.get("id") || F.uid(),
      type: fd.get("type"),
      amount: F.toCents(fd.get("amount")),
      category: fd.get("category"),
      date: fd.get("date"),
      description: String(fd.get("description") || "").trim(),
    };
    const errors = F.validateTransaction(tx);
    if (errors.length) {
      txForm.querySelector(".form-error").textContent = errors.join(". ");
      return;
    }
    const idx = state.transactions.findIndex((t) => t.id === tx.id);
    if (idx >= 0) {
      tx.recurringId = state.transactions[idx].recurringId;
      state.transactions[idx] = tx;
    } else state.transactions.push(tx);
    persist();
    dialog.close();
    toast(idx >= 0 ? "Transaction updated." : "Transaction added.");
    render();
  });

  $("#tx-cancel").addEventListener("click", () => dialog.close());

  // ---------- events ----------

  $("#add-tx-btn").addEventListener("click", () => openTxDialog());
  $("#prev-month").addEventListener("click", () => { ui.month = F.shiftMonth(ui.month, -1); render(); });
  $("#next-month").addEventListener("click", () => { ui.month = F.shiftMonth(ui.month, 1); render(); });

  $(".tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) setTab(tab.dataset.tab);
  });
  $(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = $$(".tabs [role=tab]");
    const i = tabs.findIndex((t) => t.dataset.tab === ui.tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.dataset.tab);
    next.focus();
  });

  function setTab(tab) {
    ui.tab = tab;
    try { sessionStorage.setItem("pfm.tab", tab); } catch (_) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const go = t.closest("[data-goto]");
    if (go) return setTab(go.dataset.goto);

    const action = t.closest("[data-action]");
    if (action) {
      if (action.dataset.action === "add-tx") openTxDialog();
      if (action.dataset.action === "load-sample") loadSample();
      return;
    }

    if (t.dataset.edit) return openTxDialog(state.transactions.find((x) => x.id === t.dataset.edit));
    if (t.dataset.delete) {
      const tx = state.transactions.find((x) => x.id === t.dataset.delete);
      if (tx && confirm(`Delete "${tx.description || tx.category}" (${money(tx.amount)})?`)) {
        state.transactions = state.transactions.filter((x) => x.id !== tx.id);
        persist();
        render();
      }
      return;
    }
    if (t.dataset.goalEdit) return editGoal(t.dataset.goalEdit);
    if (t.dataset.goalDelete) {
      const g = state.goals.find((x) => x.id === t.dataset.goalDelete);
      if (g && confirm(`Delete goal "${g.name}"?`)) {
        state.goals = state.goals.filter((x) => x.id !== g.id);
        persist();
        render();
      }
      return;
    }
    if (t.dataset.recToggle) {
      const r = state.recurring.find((x) => x.id === t.dataset.recToggle);
      if (r) {
        r.active = !r.active;
        // When resuming, skip occurrences missed while paused.
        if (r.active) while (r.nextDate < F.today()) r.nextDate = F.nextOccurrence(r.nextDate, r.frequency, Number(r.startDate.slice(8)));
        persist();
        runRecurring();
        render();
      }
      return;
    }
    if (t.dataset.recDelete) {
      const r = state.recurring.find((x) => x.id === t.dataset.recDelete);
      if (r && confirm(`Delete recurring "${r.description || r.category}"? Transactions it already created are kept.`)) {
        state.recurring = state.recurring.filter((x) => x.id !== r.id);
        persist();
        render();
      }
      return;
    }
    if (t.dataset.catRemove) {
      const kind = t.dataset.kind;
      const name = t.dataset.catRemove;
      if (state.categories[kind].length <= 1) return toast("Keep at least one category.");
      state.categories[kind] = state.categories[kind].filter((c) => c !== name);
      persist();
      toast(`Removed "${name}". Existing transactions keep their category.`);
      render();
    }
  });

  // Transactions filters
  ["#f-search", "#f-type", "#f-category", "#f-period"].forEach((sel) =>
    $(sel).addEventListener("input", renderTransactions)
  );

  // Budgets
  $("#budget-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const next = {};
    let bad = null;
    for (const input of $$("input[data-category]", e.target)) {
      const raw = input.value.trim();
      if (!raw) continue;
      const cents = F.toCents(raw);
      if (!Number.isFinite(cents) || cents < 0) { bad = input; break; }
      if (cents > 0) next[input.dataset.category] = cents;
    }
    if (bad) {
      bad.focus();
      return toast(`"${bad.value}" isn't a valid amount.`);
    }
    state.budgets = next;
    persist();
    toast("Budgets saved.");
    render();
  });

  // Goals
  const goalForm = $("#goal-form");
  goalForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(goalForm);
    const target = F.toCents(fd.get("target"));
    const saved = fd.get("saved") ? F.toCents(fd.get("saved")) : 0;
    const err = goalForm.querySelector(".form-error");
    if (!String(fd.get("name")).trim()) return (err.textContent = "Name is required.");
    if (!Number.isFinite(target) || target <= 0) return (err.textContent = "Target must be greater than zero.");
    if (!Number.isFinite(saved) || saved < 0) return (err.textContent = "Saved amount can't be negative.");
    const goal = { id: fd.get("id") || F.uid(), name: String(fd.get("name")).trim(), target, saved, deadline: fd.get("deadline") || "" };
    const idx = state.goals.findIndex((g) => g.id === goal.id);
    if (idx >= 0) state.goals[idx] = goal;
    else state.goals.push(goal);
    persist();
    resetGoalForm();
    toast(idx >= 0 ? "Goal updated." : "Goal created.");
    render();
  });
  $("#goal-cancel").addEventListener("click", resetGoalForm);

  function resetGoalForm() {
    goalForm.reset();
    goalForm.elements.id.value = "";
    goalForm.querySelector(".form-error").textContent = "";
    $("#goal-form-title").textContent = "New savings goal";
    $("#goal-cancel").hidden = true;
  }

  function editGoal(id) {
    const g = state.goals.find((x) => x.id === id);
    if (!g) return;
    goalForm.elements.id.value = g.id;
    goalForm.elements.name.value = g.name;
    goalForm.elements.target.value = F.fromCents(g.target).toFixed(2);
    goalForm.elements.saved.value = F.fromCents(g.saved).toFixed(2);
    goalForm.elements.deadline.value = g.deadline || "";
    $("#goal-form-title").textContent = "Edit goal";
    $("#goal-cancel").hidden = false;
    goalForm.elements.name.focus();
  }

  $("#goal-list").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const g = state.goals.find((x) => x.id === form.dataset.goal);
    const cents = F.toCents(form.elements.amount.value);
    if (!g || !Number.isFinite(cents) || cents <= 0) return toast("Enter an amount greater than zero.");
    const op = e.submitter && e.submitter.value;
    g.saved = op === "withdraw" ? Math.max(0, g.saved - cents) : g.saved + cents;
    persist();
    render();
  });

  // Recurring
  const recForm = $("#recurring-form");
  recForm.addEventListener("change", (e) => {
    if (e.target.name === "type") fillCategorySelect(recForm.elements.category, e.target.value);
  });
  recForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(recForm);
    const rule = {
      id: F.uid(),
      description: String(fd.get("description") || "").trim(),
      type: fd.get("type"),
      amount: F.toCents(fd.get("amount")),
      category: fd.get("category"),
      frequency: fd.get("frequency"),
      startDate: fd.get("startDate"),
      nextDate: fd.get("startDate"),
      endDate: fd.get("endDate") || "",
      active: true,
    };
    const errors = F.validateTransaction(Object.assign({}, rule, { date: rule.startDate }));
    if (rule.endDate && rule.endDate < rule.startDate) errors.push("End date must be after the first date");
    const err = recForm.querySelector(".form-error");
    if (errors.length) return (err.textContent = errors.join(". "));
    err.textContent = "";
    state.recurring.push(rule);
    persist();
    recForm.reset();
    runRecurring();
    toast("Recurring transaction added.");
    render();
  });

  // Settings
  $("#currency-select").addEventListener("change", (e) => {
    state.currency = e.target.value;
    persist();
    toast("Currency set to " + state.currency + ". Amounts are not converted.");
  });

  $$(".inline-add").forEach((form) =>
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const kind = form.dataset.kind;
      const name = form.elements.name.value.trim();
      if (!name) return;
      if (state.categories[kind].some((c) => c.toLowerCase() === name.toLowerCase())) return toast("That category already exists.");
      state.categories[kind].push(name);
      persist();
      form.reset();
      render();
    })
  );

  $("#export-json").addEventListener("click", () =>
    download(`pocket-ledger-backup-${F.today()}.json`, JSON.stringify(state, null, 2), "application/json")
  );
  $("#export-csv").addEventListener("click", () =>
    download(`transactions-${F.today()}.csv`, F.toCSV(state.transactions), "text/csv")
  );

  $("#import-json").addEventListener("change", async (e) => {
    try {
      const data = JSON.parse(await readFile(e.target));
      const next = Store.normalize(data);
      if (!confirm(`Replace all current data with this backup (${next.transactions.length} transactions)?`)) return;
      state = next;
      persist();
      toast("Backup restored.");
      render();
    } catch (err) {
      toast("Couldn't read that file: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  $("#import-csv").addEventListener("change", async (e) => {
    try {
      const { transactions, errors } = F.parseCSV(await readFile(e.target));
      if (!transactions.length) {
        toast(errors.length ? `Nothing imported. Line ${errors[0].line}: ${errors[0].message}` : "No rows found.");
        return;
      }
      // Skip rows identical to existing ones so re-importing a statement is safe.
      const sig = (t) => [t.date, t.type, t.amount, t.category, t.description].join("|");
      const existing = new Set(state.transactions.map(sig));
      const fresh = transactions.filter((t) => !existing.has(sig(t)));
      for (const t of fresh) {
        const list = state.categories[t.type];
        if (!list.includes(t.category)) list.push(t.category);
      }
      state.transactions.push(...fresh);
      persist();
      const skipped = transactions.length - fresh.length;
      toast(
        `Imported ${fresh.length} transaction${fresh.length === 1 ? "" : "s"}` +
          (skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : "") +
          (errors.length ? `, ${errors.length} invalid row${errors.length === 1 ? "" : "s"} ignored` : "") + "."
      );
      render();
    } catch (err) {
      toast("Couldn't read that file: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  $("#clear-data").addEventListener("click", () => {
    if (!confirm("Delete ALL transactions, budgets, goals and settings? This cannot be undone.")) return;
    Store.clear();
    state = Store.emptyState();
    persist();
    toast("All data deleted.");
    setTab("dashboard");
  });

  function loadSample() {
    if (state.transactions.length && !confirm("Replace your current data with sample data?")) return;
    state = Store.sampleState(F.today());
    ui.month = F.monthKey(F.today());
    persist();
    toast("Sample data loaded — explore, then delete it from Settings.");
    setTab("dashboard");
  }

  // Redraw charts on resize (they size to their container).
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => ui.tab === "dashboard" && renderDashboard(), 150);
  });

  // Keyboard shortcut: "n" opens the add dialog.
  document.addEventListener("keydown", (e) => {
    if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !dialog.open && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      openTxDialog();
    }
  });

  // ---------- boot ----------
  try {
    const saved = sessionStorage.getItem("pfm.tab");
    if (saved && $(`[data-tab="${saved}"]`)) ui.tab = saved;
  } catch (_) { /* ignore */ }
  if (!firstRun) runRecurring();
  render();
})();
