# R2FinanceWebsite — agent notes

- **Production domain:** https://finance.i-liquid.be
- **Source of truth:** this repo. Deploy only via push to `main` (or documented sync).
- **API:** R2FinanceAPI only — never call YNAB from the browser.
- **Reflect spending = YNAB net activity:** `buildSpendingReport` must match YNAB month/Reflect Total spending — exclude transfers; include unapproved; **net** refunds in spending categories; only `Inflow: Ready to Assign` is income. Never gross-outflow-only for Total spending. Pure-transfer splits only when legs sum to parent; otherwise use parent. Total spending UI uses `formatSpend` (absolute) so it matches Android/YNAB.
- **Always commit + push** after finishing work; watch CI green.
- Public repo: never commit secrets, PATs, or passwords.
