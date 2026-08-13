# R2FinanceWebsite — agent notes

- **Production domain:** https://finance.i-liquid.be
- **Source of truth:** this repo. Deploy only via push to `main` (or documented sync).
- **API:** R2FinanceAPI only — never call YNAB from the browser.
- **Reflect spending = YNAB net activity:** `buildSpendingReport` must match YNAB month/Reflect Total spending — exclude transfers; include unapproved; **net** refunds in spending categories; only `Inflow: Ready to Assign` is income. Never gross-outflow-only for Total spending. Trust split legs only when sum(legs)==parent; pure-transfer → nothing; stale/partial → parent. Total spending UI uses `formatSpend` (absolute). Never seed `lastFullAt` from delta; underfilled local (<85% server txn total) retries full — sparse ledger undercounts Last 12 Months.
- **Always commit + push** after finishing work; watch CI green.
- Public repo: never commit secrets, PATs, or passwords.
