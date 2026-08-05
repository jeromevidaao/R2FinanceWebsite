# AWS resources — finance.i-liquid.be

| Resource | Value |
|----------|--------|
| Domain | `finance.i-liquid.be` |
| Hosted zone | `Z00512643QVC42UPHRWA9` (`i-liquid.be`) |
| S3 bucket | `finance.i-liquid.be` (us-east-1, private + OAC) |
| CloudFront | `E1KAT8FGSXPPE6` → `d3va0zd6znudp4.cloudfront.net` |
| ACM cert | `arn:aws:acm:us-east-1:834917996497:certificate/2004bcba-a485-43cb-bbe5-188e68fed83e` |
| DNS | A + AAAA alias → CloudFront |
| Deploy role | `arn:aws:iam::834917996497:role/github-actions-cleaningbutton-deploy` |
| API | `https://x0wiir7m27.execute-api.us-east-1.amazonaws.com` (R2FinanceAPI) |

HTTPS: ViewerProtocolPolicy `redirect-to-https`, TLS 1.2+, ACM on CloudFront (us-east-1).

SPA: CloudFront custom error 403/404 → `/index.html` (200) for client routes.
