/*
 * Core finance logic. Pure functions only (no DOM, no storage) so they can be
 * unit-tested under Node and reused by the browser UI.
 *
 * Money is always stored as integer cents to avoid floating-point drift.
 * Dates are stored as local "YYYY-MM-DD" strings.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Finance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_CATEGORIES = {
    expense: [
      "Housing",
      "Groceries",
      "Dining out",
      "Transport",
      "Utilities",
      "Health",
      "Entertainment",
      "Shopping",
      "Subscriptions",
      "Other",
    ],
    income: ["Salary", "Freelance", "Investments", "Gifts", "Other income"],
  };

  // Budget thresholds (fraction of limit spent).
  const BUDGET_WARNING_AT = 0.8;

  function uid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
    );
  }

  // ---------- money ----------

  function toCents(value) {
    if (typeof value === "number") return Math.round(value * 100);
    const cleaned = String(value).replace(/[^0-9.\-]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }

  function fromCents(cents) {
    return cents / 100;
  }

  function formatMoney(cents, currency) {
    const value = fromCents(cents || 0);
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(value);
    } catch (_) {
      return (currency ? currency + " " : "") + value.toFixed(2);
    }
  }

  // ---------- dates ----------

  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isValidDate(str) {
    const m = DATE_RE.exec(str || "");
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toDateString(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function today() {
    return toDateString(new Date());
  }

  function monthKey(dateStr) {
    return dateStr.slice(0, 7);
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    const total = y * 12 + (m - 1) + delta;
    return Math.floor(total / 12) + "-" + pad((total % 12) + 1);
  }

  function monthLabel(key, style) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
      month: style || "short",
      year: style === "long" ? "numeric" : undefined,
    });
  }

  /**
   * Next occurrence of a recurring date. Monthly recurrences keep the anchor
   * day-of-month, clamped to shorter months (Jan 31 -> Feb 28 -> Mar 31).
   */
  function nextOccurrence(dateStr, frequency, anchorDay) {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (frequency === "weekly" || frequency === "biweekly") {
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + (frequency === "weekly" ? 7 : 14));
      return toDateString(dt);
    }
    const months = frequency === "yearly" ? 12 : 1;
    const key = shiftMonth(y + "-" + pad(m), months);
    const [ny, nm] = key.split("-").map(Number);
    const day = Math.min(anchorDay || d, daysInMonth(ny, nm));
    return key + "-" + pad(day);
  }

  // ---------- validation ----------

  function validateTransaction(tx) {
    const errors = [];
    if (!tx || typeof tx !== "object") return ["Transaction is missing"];
    if (tx.type !== "income" && tx.type !== "expense")
      errors.push("Type must be income or expense");
    if (!Number.isInteger(tx.amount) || tx.amount <= 0)
      errors.push("Amount must be greater than zero");
    if (!isValidDate(tx.date)) errors.push("Date must be a valid YYYY-MM-DD date");
    if (!tx.category || !String(tx.category).trim())
      errors.push("Category is required");
    return errors;
  }

  // ---------- aggregation ----------

  function inMonth(transactions, key) {
    return transactions.filter((t) => monthKey(t.date) === key);
  }

  function summarize(transactions) {
    let income = 0, expenses = 0;
    for (const t of transactions) {
      if (t.type === "income") income += t.amount;
      else expenses += t.amount;
    }
    const net = income - expenses;
    return {
      income,
      expenses,
      net,
      savingsRate: income > 0 ? net / income : null,
    };
  }

  function totalsByCategory(transactions, type) {
    const map = new Map();
    for (const t of transactions) {
      if (t.type !== (type || "expense")) continue;
      map.set(t.category, (map.get(t.category) || 0) + t.amount);
    }
    return [...map.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  }

  /** Income/expense totals for `count` months ending at `endKey` (oldest first). */
  function monthlyTotals(transactions, endKey, count) {
    const keys = [];
    for (let i = count - 1; i >= 0; i--) keys.push(shiftMonth(endKey, -i));
    const rows = new Map(keys.map((k) => [k, { month: k, income: 0, expenses: 0 }]));
    for (const t of transactions) {
      const row = rows.get(monthKey(t.date));
      if (!row) continue;
      if (t.type === "income") row.income += t.amount;
      else row.expenses += t.amount;
    }
    return keys.map((k) => rows.get(k));
  }

  function balance(transactions) {
    return summarize(transactions).net;
  }

  // ---------- budgets ----------

  /**
   * budgets: { [category]: limitCents }
   * Returns one row per budgeted category, plus unbudgeted categories with spend.
   */
  function budgetStatus(budgets, transactions, key) {
    const spent = new Map(
      totalsByCategory(inMonth(transactions, key), "expense").map((r) => [r.category, r.amount])
    );
    const rows = Object.entries(budgets || {})
      .filter(([, limit]) => limit > 0)
      .map(([category, limit]) => {
        const s = spent.get(category) || 0;
        const ratio = s / limit;
        return {
          category,
          limit,
          spent: s,
          remaining: limit - s,
          ratio,
          status: ratio > 1 ? "over" : ratio >= BUDGET_WARNING_AT ? "warning" : "ok",
        };
      })
      .sort((a, b) => b.ratio - a.ratio);
    const unbudgeted = [...spent.entries()]
      .filter(([category]) => !(budgets && budgets[category] > 0))
      .map(([category, amount]) => ({ category, spent: amount }))
      .sort((a, b) => b.spent - a.spent);
    const totalLimit = rows.reduce((s, r) => s + r.limit, 0);
    const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
    return { rows, unbudgeted, totalLimit, totalSpent };
  }

  // ---------- goals ----------

  function goalProgress(goal, fromDate) {
    const saved = Math.max(0, goal.saved || 0);
    const remaining = Math.max(0, goal.target - saved);
    const ratio = goal.target > 0 ? Math.min(1, saved / goal.target) : 0;
    let monthsLeft = null, monthlyNeeded = null;
    if (goal.deadline && isValidDate(goal.deadline)) {
      const start = fromDate || today();
      const [sy, sm, sd] = start.split("-").map(Number);
      const [dy, dm, dd] = goal.deadline.split("-").map(Number);
      monthsLeft = (dy - sy) * 12 + (dm - sm) + (dd >= sd ? 0 : -1);
      if (remaining > 0) {
        monthlyNeeded = monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : remaining;
      } else {
        monthlyNeeded = 0;
      }
    }
    return { saved, remaining, ratio, complete: remaining === 0, monthsLeft, monthlyNeeded };
  }

  // ---------- recurring ----------

  /**
   * Generate the transactions that recurring rules owe up to and including
   * `upTo`. Returns new transactions and the rules with `nextDate` advanced.
   */
  function materializeRecurring(rules, upTo, maxPerRule) {
    const limit = maxPerRule || 400;
    const created = [];
    const updated = (rules || []).map((rule) => {
      if (!rule.active || !isValidDate(rule.nextDate)) return rule;
      let next = rule.nextDate;
      const anchor = Number(rule.startDate ? rule.startDate.slice(8, 10) : next.slice(8, 10));
      let n = 0;
      while (next <= upTo && (!rule.endDate || next <= rule.endDate) && n < limit) {
        created.push({
          id: uid(),
          date: next,
          type: rule.type,
          amount: rule.amount,
          category: rule.category,
          description: rule.description,
          recurringId: rule.id,
        });
        next = nextOccurrence(next, rule.frequency, anchor);
        n++;
      }
      return next === rule.nextDate ? rule : Object.assign({}, rule, { nextDate: next });
    });
    return { created, rules: updated };
  }

  // ---------- CSV ----------

  const CSV_COLUMNS = ["date", "type", "category", "description", "amount"];

  function csvEscape(value) {
    const s = String(value == null ? "" : value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(transactions) {
    const lines = [CSV_COLUMNS.join(",")];
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    for (const t of sorted) {
      lines.push(
        [t.date, t.type, t.category, t.description || "", fromCents(t.amount).toFixed(2)]
          .map(csvEscape)
          .join(",")
      );
    }
    return lines.join("\n") + "\n";
  }

  function parseCSVRows(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim() !== ""));
  }

  /**
   * Parse CSV with a header row. Accepts the export format, and also bank-style
   * files with a single signed "amount" column (negative = expense).
   * Returns { transactions, errors: [{ line, message }] }.
   */
  function parseCSV(text) {
    const rows = parseCSVRows(String(text || "").replace(/^﻿/, ""));
    if (!rows.length) return { transactions: [], errors: [{ line: 0, message: "File is empty" }] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    const iDate = col("date"), iAmount = col("amount");
    if (iDate < 0 || iAmount < 0)
      return {
        transactions: [],
        errors: [{ line: 1, message: 'Header must include "date" and "amount" columns' }],
      };
    const iType = col("type"), iCat = col("category");
    const iDesc = col("description") >= 0 ? col("description") : col("memo");
    const transactions = [], errors = [];
    rows.slice(1).forEach((r, idx) => {
      const line = idx + 2;
      let cents = toCents((r[iAmount] || "").trim());
      let type = iType >= 0 ? (r[iType] || "").trim().toLowerCase() : "";
      if (!type) type = cents < 0 ? "expense" : "income";
      cents = Math.abs(cents);
      const tx = {
        id: uid(),
        date: normalizeDate((r[iDate] || "").trim()),
        type,
        amount: cents,
        category: (iCat >= 0 && (r[iCat] || "").trim()) || (type === "income" ? "Other income" : "Other"),
        description: iDesc >= 0 ? (r[iDesc] || "").trim() : "",
      };
      const problems = validateTransaction(tx);
      if (problems.length) errors.push({ line, message: problems.join("; ") });
      else transactions.push(tx);
    });
    return { transactions, errors };
  }

  /** Accept YYYY-MM-DD, YYYY/MM/DD, and MM/DD/YYYY. */
  function normalizeDate(s) {
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
    if (m) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return m[3] + "-" + pad(+m[1]) + "-" + pad(+m[2]);
    return s;
  }

  return {
    DEFAULT_CATEGORIES,
    BUDGET_WARNING_AT,
    uid,
    toCents,
    fromCents,
    formatMoney,
    isValidDate,
    toDateString,
    today,
    monthKey,
    shiftMonth,
    monthLabel,
    nextOccurrence,
    validateTransaction,
    inMonth,
    summarize,
    totalsByCategory,
    monthlyTotals,
    balance,
    budgetStatus,
    goalProgress,
    materializeRecurring,
    toCSV,
    parseCSV,
    normalizeDate,
  };
});
