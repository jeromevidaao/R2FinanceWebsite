# R2FinanceWebsite

Full-scale **R2Finance** web app — YNAB-grade multi-account register, inbox, categories, payees, and reports — built **only** on [R2FinanceAPI](https://github.com/jeromevidaao/R2FinanceAPI).

| Item | Value |
|------|--------|
| **Live site** | https://finance.i-liquid.be |
| **API** | https://x0wiir7m27.execute-api.us-east-1.amazonaws.com |
| **S3** | `finance.i-liquid.be` (us-east-1) |
| **CloudFront** | `E1KAT8FGSXPPE6` |
| **Android** | [R2FinanceAndroid](https://github.com/jeromevidaao/R2FinanceAndroid) |
| **Stack** | Vite + React + TypeScript (static SPA) |

## Features (API-backed)

| Area | Behavior |
|------|----------|
| **Auth** | Email + password + TOTP MFA via `/v1/auth/*` |
| **Budget home** | On-budget / tracking totals, month inflow/outflow, top spend, inbox CTA |
| **Accounts** | Budget vs tracking lists, balances, types |
| **Register** | Per-account transactions, search, clear filters, categorize |
| **Inbox** | Uncategorized / unapproved → categorize + push |
| **All transactions** | Cross-account search, month/account filters |
| **Categories** | Groups + month activity |
| **Payees** | Search + activity totals |
| **Reports** | Month spend by category / payee / account + 6-month trend |
| **More / sync** | Plan meta, stats, pull / push / tick / full import |
| **Connectors** | Bank of America via Plaid Link (access only; no DDB txn import yet) |

This site **never** talks to YNAB directly. Sync and PATs stay in R2FinanceAPI + Secrets Manager.
Plaid client secrets stay on the API; the browser only receives short-lived Link tokens.

## Local dev

```bash
npm install
npm run dev
```

Optional: `VITE_API_BASE=https://…` in `.env`.

```bash
npm run build   # → dist/
```

## Deploy

Push to `main` → GitHub Actions **CI** → **Deploy** syncs `dist/` to S3 and invalidates CloudFront.

Manual:

```bash
npm run build
aws s3 sync dist/ s3://finance.i-liquid.be/ --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id E1KAT8FGSXPPE6 --paths "/*"
```

## Security (public repo)

- No secrets in git
- Browser uses public API Gateway URL only
- GitHub OIDC role `AWS_ROLE_ARN` for deploy
- Session token lives in `localStorage` after login

## Companion repos

- [R2FinanceAPI](https://github.com/jeromevidaao/R2FinanceAPI)
- [R2FinanceAndroid](https://github.com/jeromevidaao/R2FinanceAndroid)
