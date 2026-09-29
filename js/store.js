/*
 * Persistence for the app state in localStorage, plus JSON backup/restore
 * and a sample-data generator.
 */
(function (root, factory) {
  const api = factory(root.Finance || (typeof require === "function" ? require("./finance.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Store = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (F) {
  "use strict";

  const STORAGE_KEY = "pfm.state.v1";
  const VERSION = 1;

  function emptyState() {
    return {
      version: VERSION,
      currency: "USD",
      categories: {
        expense: F.DEFAULT_CATEGORIES.expense.slice(),
        income: F.DEFAULT_CATEGORIES.income.slice(),
      },
      transactions: [],
      budgets: {},
      goals: [],
      recurring: [],
    };
  }

  /** Coerce untrusted data (storage or an imported file) into a valid state. */
  function normalize(raw) {
    const base = emptyState();
    if (!raw || typeof raw !== "object") return base;
    const state = Object.assign(base, {
      currency: typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : base.currency,
    });
    if (raw.categories && Array.isArray(raw.categories.expense) && Array.isArray(raw.categories.income)) {
      state.categories = {
        expense: raw.categories.expense.filter((c) => typeof c === "string" && c.trim()),
        income: raw.categories.income.filter((c) => typeof c === "string" && c.trim()),
      };
    }
    state.transactions = (Array.isArray(raw.transactions) ? raw.transactions : [])
      .filter((t) => F.validateTransaction(t).length === 0)
      .map((t) => ({
        id: typeof t.id === "string" ? t.id : F.uid(),
        date: t.date,
        type: t.type,
        amount: t.amount,
        category: String(t.category),
        description: typeof t.description === "string" ? t.description : "",
        recurringId: typeof t.recurringId === "string" ? t.recurringId : undefined,
      }));
    if (raw.budgets && typeof raw.budgets === "object") {
      for (const [cat, limit] of Object.entries(raw.budgets)) {
        if (Number.isInteger(limit) && limit > 0) state.budgets[cat] = limit;
      }
    }
    state.goals = (Array.isArray(raw.goals) ? raw.goals : [])
      .filter((g) => g && typeof g.name === "string" && Number.isInteger(g.target) && g.target > 0)
      .map((g) => ({
        id: typeof g.id === "string" ? g.id : F.uid(),
        name: g.name,
        target: g.target,
        saved: Number.isInteger(g.saved) && g.saved > 0 ? g.saved : 0,
        deadline: F.isValidDate(g.deadline) ? g.deadline : "",
      }));
    state.recurring = (Array.isArray(raw.recurring) ? raw.recurring : [])
      .filter((r) => r && F.isValidDate(r.nextDate) && F.validateTransaction(Object.assign({}, r, { date: r.nextDate })).length === 0)
      .map((r) => ({
        id: typeof r.id === "string" ? r.id : F.uid(),
        description: typeof r.description === "string" ? r.description : "",
        type: r.type,
        amount: r.amount,
        category: String(r.category),
        frequency: ["weekly", "biweekly", "monthly", "yearly"].includes(r.frequency) ? r.frequency : "monthly",
        startDate: F.isValidDate(r.startDate) ? r.startDate : r.nextDate,
        nextDate: r.nextDate,
        endDate: F.isValidDate(r.endDate) ? r.endDate : "",
        active: r.active !== false,
      }));
    return state;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (_) {
      return null;
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  /** Six months of plausible data ending today, for trying the app out. */
  function sampleState(todayStr) {
    const state = emptyState();
    const end = todayStr || F.today();
    const endKey = F.monthKey(end);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const add = (date, type, category, amount, description) => {
      if (date > end) return;
      state.transactions.push({ id: F.uid(), date, type, category, amount: Math.round(amount), description });
    };
    for (let i = 5; i >= 0; i--) {
      const key = F.shiftMonth(endKey, -i);
      const day = (d) => key + "-" + String(d).padStart(2, "0");
      add(day(1), "income", "Salary", 420000, "Monthly salary");
      add(day(1), "expense", "Housing", 145000, "Rent");
      add(day(5), "expense", "Utilities", 9000 + rand() * 6000, "Electricity & water");
      add(day(8), "expense", "Subscriptions", 1599, "Streaming");
      add(day(12), "expense", "Transport", 6000 + rand() * 4000, "Transit pass & fuel");
      for (const d of [3, 10, 17, 24]) add(day(d), "expense", "Groceries", 8000 + rand() * 5000, "Supermarket");
      for (const d of [6, 14, 21]) add(day(d), "expense", "Dining out", 2500 + rand() * 4000, "Restaurant");
      add(day(18), "expense", "Entertainment", 3000 + rand() * 6000, "Cinema & events");
      add(day(20), "expense", "Shopping", 5000 + rand() * 15000, "Clothes & household");
      if (i % 2 === 0) add(day(22), "income", "Freelance", 50000 + rand() * 40000, "Side project");
      if (i % 3 === 1) add(day(26), "expense", "Health", 4000 + rand() * 8000, "Pharmacy");
    }
    state.budgets = {
      Housing: 150000,
      Groceries: 45000,
      "Dining out": 12000,
      Transport: 10000,
      Utilities: 15000,
      Entertainment: 8000,
      Shopping: 15000,
    };
    const inAYear = F.shiftMonth(endKey, 12) + "-01";
    state.goals = [
      { id: F.uid(), name: "Emergency fund", target: 1000000, saved: 420000, deadline: inAYear },
      { id: F.uid(), name: "Summer holiday", target: 250000, saved: 90000, deadline: F.shiftMonth(endKey, 8) + "-01" },
    ];
    const nextMonth = F.shiftMonth(endKey, 1);
    state.recurring = [
      { id: F.uid(), description: "Monthly salary", type: "income", amount: 420000, category: "Salary", frequency: "monthly", startDate: F.shiftMonth(endKey, -5) + "-01", nextDate: nextMonth + "-01", endDate: "", active: true },
      { id: F.uid(), description: "Rent", type: "expense", amount: 145000, category: "Housing", frequency: "monthly", startDate: F.shiftMonth(endKey, -5) + "-01", nextDate: nextMonth + "-01", endDate: "", active: true },
      { id: F.uid(), description: "Streaming", type: "expense", amount: 1599, category: "Subscriptions", frequency: "monthly", startDate: F.shiftMonth(endKey, -5) + "-08", nextDate: (end.slice(8) < "08" ? endKey : nextMonth) + "-08", endDate: "", active: true },
    ];
    return state;
  }

  return { STORAGE_KEY, VERSION, emptyState, normalize, load, save, clear, sampleState };
});
