# R2FinanceWebsite — agent notes

- **Production domain:** https://finance.i-liquid.be
- **Source of truth:** this repo. Deploy only via push to `main` (or documented sync).
- **API:** R2FinanceAPI only — never call YNAB from the browser.
- **Always commit + push** after finishing work; watch CI green.
- Public repo: never commit secrets, PATs, or passwords.
