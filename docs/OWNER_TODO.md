# Owner-only actions

These steps need the repository owner's accounts, money decisions or judgement. **None of them has been done.**

## 1. Publish the repository on GitHub

```powershell
# Create an empty repository named DocRoof on github.com first (no README, licence or .gitignore), then:
git remote add origin https://github.com/<your-user>/DocRoof.git
git push -u origin main
```

Then open the **Actions** tab and check the `ci` workflow. Integration tests use Testcontainers, which works on
GitHub's ubuntu runners without extra setup. Dependabot (monthly, grouped, max 2 open PRs per ecosystem) starts
automatically from `.github/dependabot.yml`.

## 2. Set the GitHub link on the site

Edit `web/src/app/shared/site.ts`:

```ts
export const GITHUB_URL = 'https://github.com/<your-user>/DocRoof';
```

It is used by the landing footer and the case study.

## 3. Deploy (free tier) — optional, needs accounts

Follow docs/DEPLOYMENT.md:

1. Create the Azure SQL Database **free offer** (portal or `infra/azure/sql-free.bicep`). Confirm the free offer is
   applied and that the limit behaviour is **auto-pause**, so it cannot bill.
2. Create the Render **Blueprint** from `infra/render.yaml` and paste the connection string as a secret.
3. Run `./scripts/smoke.sh https://<service>.onrender.com` (or `smoke.ps1`).
4. Record the URL and the real smoke output in docs/STATUS.md and mark deployment complete there.

## 4. Optional decisions

- Language-model extraction stays disabled unless you choose a provider and set the `Extraction__*` variables
  (docs/EXTRACTION.md). It may cost money; keep the daily quota small.
