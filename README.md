# Pocket Ledger

A personal financial management tool that runs entirely in your browser. There is no server and no account, and it has no dependencies. Your data stays on your device in `localStorage`.

## Features

- **Dashboard**: income, expenses, net and savings rate for the selected month, each compared with the previous month. It also shows your running balance, a 6‑month income vs. expenses chart (with a table view), spending by category, a budget snapshot and recent transactions.
- **Transactions**: add, edit and delete income and expenses. You can search and filter by type, category and month (or all time).
- **Budgets**: set a monthly limit for each category. Progress meters mark each category as *on track*, *close to limit* (80% or more) or *over budget*, and a separate list shows spending in categories that have no budget.
- **Savings goals**: set a target and an optional date. You can add or withdraw money, and the app works out how much you need to save each month to reach the goal on time.
- **Recurring transactions**: weekly, every 2 weeks, monthly or yearly rules (for example rent or salary). Due entries are added automatically each time you open the app. Month-end dates are clamped, so a rule for the 31st lands on Feb 28/29. Rules can be paused, resumed or deleted.
- **Import/export**: full JSON backup and restore, CSV export, and CSV import. The importer accepts bank-style files with signed amounts and `MM/DD/YYYY` dates, and it skips duplicates.
- **Settings**: choose your currency and manage your own income and expense categories.
- Supports light and dark mode, works on mobile, and can be used with the keyboard (press `n` to add a transaction).

## Getting started

Open `index.html` in any modern browser. Nothing needs to be installed.

Or serve the folder locally:

```bash
npm start            # python3 -m http.server 8000 → http://localhost:8000
```

On first launch you can click **Load sample data** to explore six months of example data, then remove it under **Settings → Delete all data**.

### CSV import format

The first row must be a header that includes `date` and `amount`. The `type` (`income`/`expense`), `category` and `description` (or `memo`) columns are optional. If there is no `type` column, negative amounts are treated as expenses.

```csv
date,type,category,description,amount
2024-03-01,income,Salary,March pay,4200.00
2024-03-02,expense,Groceries,Supermarket,85.40
```

## Development

```
index.html        UI markup
css/styles.css    Styles (light/dark theme tokens)
js/finance.js     Pure finance logic: money, dates, summaries, budgets, goals, recurring, CSV
js/store.js       localStorage persistence, input validation for imports, sample data
js/charts.js      Small SVG charts with hover tooltips
js/app.js         UI controller
tests/            Unit tests (Node's built-in test runner)
```

Run the tests (Node 18+):

```bash
npm test
```

Amounts are stored as integer cents to avoid floating-point rounding errors. Dates are stored as local `YYYY-MM-DD` strings.
