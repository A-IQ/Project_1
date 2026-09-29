const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/finance.js");
const Store = require("../js/store.js");

const tx = (date, type, amount, category, description) => ({
  id: F.uid(), date, type, amount, category, description: description || "",
});

test("toCents parses user input and rejects junk", () => {
  assert.equal(F.toCents("12.34"), 1234);
  assert.equal(F.toCents("$1,234.5"), 123450);
  assert.equal(F.toCents(0.1 + 0.2), 30);
  assert.equal(F.toCents("-5"), -500);
  assert.ok(Number.isNaN(F.toCents("")));
  assert.ok(Number.isNaN(F.toCents("abc")));
});

test("date helpers", () => {
  assert.ok(F.isValidDate("2024-02-29"));
  assert.ok(!F.isValidDate("2023-02-29"));
  assert.ok(!F.isValidDate("2024-13-01"));
  assert.equal(F.shiftMonth("2024-01", -1), "2023-12");
  assert.equal(F.shiftMonth("2024-12", 1), "2025-01");
  assert.equal(F.shiftMonth("2024-05", -17), "2022-12");
});

test("nextOccurrence clamps month-end and keeps the anchor day", () => {
  assert.equal(F.nextOccurrence("2024-01-31", "monthly", 31), "2024-02-29");
  assert.equal(F.nextOccurrence("2024-02-29", "monthly", 31), "2024-03-31");
  assert.equal(F.nextOccurrence("2024-12-28", "weekly"), "2025-01-04");
  assert.equal(F.nextOccurrence("2024-12-28", "biweekly"), "2025-01-11");
  assert.equal(F.nextOccurrence("2024-02-29", "yearly", 29), "2025-02-28");
});

test("validateTransaction", () => {
  assert.deepEqual(F.validateTransaction(tx("2024-01-01", "expense", 100, "Food")), []);
  assert.equal(F.validateTransaction(tx("2024-01-01", "expense", 0, "Food")).length, 1);
  assert.equal(F.validateTransaction(tx("bad", "other", 1.5, "")).length, 4);
});

test("summarize and category totals", () => {
  const list = [
    tx("2024-03-01", "income", 300000, "Salary"),
    tx("2024-03-02", "expense", 50000, "Groceries"),
    tx("2024-03-05", "expense", 25000, "Groceries"),
    tx("2024-03-09", "expense", 100000, "Housing"),
  ];
  const s = F.summarize(list);
  assert.equal(s.income, 300000);
  assert.equal(s.expenses, 175000);
  assert.equal(s.net, 125000);
  assert.equal(s.savingsRate, 125000 / 300000);
  assert.equal(F.summarize([]).savingsRate, null);
  assert.deepEqual(F.totalsByCategory(list), [
    { category: "Housing", amount: 100000 },
    { category: "Groceries", amount: 75000 },
  ]);
});

test("monthlyTotals returns contiguous months, oldest first", () => {
  const list = [
    tx("2023-12-15", "expense", 100, "A"),
    tx("2024-02-01", "income", 500, "B"),
    tx("2024-05-01", "income", 999, "B"), // outside range
  ];
  const rows = F.monthlyTotals(list, "2024-02", 3);
  assert.deepEqual(rows, [
    { month: "2023-12", income: 0, expenses: 100 },
    { month: "2024-01", income: 0, expenses: 0 },
    { month: "2024-02", income: 500, expenses: 0 },
  ]);
});

test("budgetStatus flags warning and over", () => {
  const list = [
    tx("2024-03-02", "expense", 8500, "Food"),
    tx("2024-03-03", "expense", 12000, "Fun"),
    tx("2024-03-04", "expense", 1000, "Travel"),
    tx("2024-03-05", "expense", 2000, "Misc"),
    tx("2024-04-01", "expense", 99999, "Food"), // other month
  ];
  const b = F.budgetStatus({ Food: 10000, Fun: 10000, Travel: 10000 }, list, "2024-03");
  const by = Object.fromEntries(b.rows.map((r) => [r.category, r]));
  assert.equal(by.Food.status, "warning");
  assert.equal(by.Fun.status, "over");
  assert.equal(by.Fun.remaining, -2000);
  assert.equal(by.Travel.status, "ok");
  assert.equal(b.rows[0].category, "Fun"); // sorted by ratio
  assert.deepEqual(b.unbudgeted, [{ category: "Misc", spent: 2000 }]);
  assert.equal(b.totalLimit, 30000);
  assert.equal(b.totalSpent, 21500);
});

test("goalProgress computes the monthly saving needed", () => {
  const p = F.goalProgress({ target: 120000, saved: 20000, deadline: "2025-01-15" }, "2024-01-15");
  assert.equal(p.remaining, 100000);
  assert.equal(p.monthsLeft, 12);
  assert.equal(p.monthlyNeeded, Math.ceil(100000 / 12));
  const done = F.goalProgress({ target: 100, saved: 150 });
  assert.equal(done.complete, true);
  assert.equal(done.ratio, 1);
  assert.equal(done.monthlyNeeded, null);
});

test("materializeRecurring creates due items and advances nextDate", () => {
  const rules = [
    { id: "r1", active: true, type: "expense", amount: 1000, category: "Rent", description: "Rent", frequency: "monthly", startDate: "2024-01-31", nextDate: "2024-01-31" },
    { id: "r2", active: false, type: "expense", amount: 5, category: "X", frequency: "weekly", startDate: "2024-01-01", nextDate: "2024-01-01" },
    { id: "r3", active: true, type: "income", amount: 10, category: "Pay", frequency: "weekly", startDate: "2024-01-01", nextDate: "2024-01-01", endDate: "2024-01-10" },
  ];
  const { created, rules: out } = F.materializeRecurring(rules, "2024-04-01");
  const rent = created.filter((c) => c.recurringId === "r1").map((c) => c.date);
  assert.deepEqual(rent, ["2024-01-31", "2024-02-29", "2024-03-31"]);
  assert.equal(out[0].nextDate, "2024-04-30");
  assert.equal(out[1], rules[1]); // paused rule untouched
  assert.deepEqual(created.filter((c) => c.recurringId === "r3").map((c) => c.date), ["2024-01-01", "2024-01-08"]);
  // Running again is idempotent.
  assert.equal(F.materializeRecurring(out, "2024-04-01").created.length, 0);
});

test("CSV round trip preserves data, including quotes and commas", () => {
  const list = [
    tx("2024-03-01", "income", 123456, "Salary", "March, \"bonus\" included"),
    tx("2024-03-02", "expense", 999, "Food", "Line\nbreak"),
  ];
  const { transactions, errors } = F.parseCSV(F.toCSV(list));
  assert.deepEqual(errors, []);
  assert.deepEqual(
    transactions.map(({ id, ...rest }) => rest),
    list.map(({ id, ...rest }) => rest)
  );
});

test("parseCSV handles bank-style signed amounts and reports bad rows", () => {
  const csv = "Date,Memo,Amount\r\n03/15/2024,Coffee,-4.50\r\n2024/03/16,Refund,12\r\nnope,Bad,1\r\n";
  const { transactions, errors } = F.parseCSV(csv);
  assert.equal(transactions.length, 2);
  assert.deepEqual(
    transactions.map((t) => [t.date, t.type, t.amount, t.category, t.description]),
    [
      ["2024-03-15", "expense", 450, "Other", "Coffee"],
      ["2024-03-16", "income", 1200, "Other income", "Refund"],
    ]
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 4);
  assert.equal(F.parseCSV("foo,bar\n1,2").errors[0].line, 1);
});

test("Store.normalize drops invalid records from untrusted input", () => {
  const s = Store.normalize({
    currency: "EUR",
    transactions: [tx("2024-01-01", "expense", 100, "Food"), { date: "x", amount: -1 }],
    budgets: { Food: 5000, Bad: -3, Frac: 1.5 },
    goals: [{ name: "Car", target: 100000, saved: 5 }, { name: "Nope", target: 0 }],
    recurring: [{ type: "expense", amount: 100, category: "Rent", nextDate: "2024-02-01", frequency: "daily" }],
  });
  assert.equal(s.currency, "EUR");
  assert.equal(s.transactions.length, 1);
  assert.deepEqual(s.budgets, { Food: 5000 });
  assert.equal(s.goals.length, 1);
  assert.equal(s.recurring.length, 1);
  assert.equal(s.recurring[0].frequency, "monthly");
  assert.equal(Store.normalize(null).transactions.length, 0);
});

test("sample data is valid and never in the future", () => {
  const s = Store.sampleState("2024-06-10");
  assert.ok(s.transactions.length > 50);
  for (const t of s.transactions) {
    assert.deepEqual(F.validateTransaction(t), []);
    assert.ok(t.date <= "2024-06-10");
  }
  assert.equal(Store.normalize(s).transactions.length, s.transactions.length);
  // No recurring rule is due yet, so opening the app won't duplicate sample rows.
  assert.equal(F.materializeRecurring(s.recurring, "2024-06-10").created.length, 0);
});
