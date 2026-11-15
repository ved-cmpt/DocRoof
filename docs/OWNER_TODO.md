# Owner-only actions

These steps need the repository owner's accounts, money decisions or judgement.

**Remaining:** deploy on Render with the Azure SQL Database free offer (section 3), review the open Dependabot
PRs, and the optional decisions in section 4.

## 1. Publish the repository on GitHub — DONE (2026-11-15)

- `gh search repos docroof` returned no repositories, so there was no name conflict.
- Public repository: https://github.com/ved-cmpt/DocRoof. Description and topics are set; the homepage is empty
  until the hosted URL exists (`gh repo edit ved-cmpt/DocRoof --homepage https://<service>.onrender.com`).
- CI is green on `main`. The first run failed because `Infrastructure/Data` was ignored; PR #4 fixed it.
- `main` is protected: PR required (0 approvals), required check `ci-ok`, force-push and deletion blocked.
  Admins are not included in the rules ("Do not allow bypassing" is off). Turn that on in Settings → Branches if
  every change, including your own, should go through a PR.
- Release: https://github.com/ved-cmpt/DocRoof/releases/tag/v1.0.0
- Dependabot opened PRs #1 (docker), #2 (actions) and #3 (npm). Review them and merge each one once `ci-ok` is
  green.

## 2. Set the GitHub link on the site — DONE (2026-11-15)

`GITHUB_URL` in `web/src/app/shared/site.ts` is `https://github.com/ved-cmpt/DocRoof` (PR #4).

## 3. Deploy (free tier) — optional, needs accounts

Follow docs/DEPLOYMENT.md:

1. Create the Azure SQL Database **free offer** (portal or `infra/azure/sql-free.bicep`). Confirm the free offer is
   applied and that the limit behaviour is **auto-pause**, so it cannot bill.
2. Create the Render **Blueprint** from `infra/render.yaml` and paste the connection string as a secret.
3. Run `./scripts/smoke.sh https://<service>.onrender.com` (or `smoke.ps1`).
4. Record the URL and the real smoke output in docs/STATUS.md and mark deployment complete there.
5. Set the repository homepage to the hosted URL (see section 1).

## 4. Optional decisions

- Language-model extraction stays disabled unless you choose a provider and set the `Extraction__*` variables
  (docs/EXTRACTION.md). It may cost money; keep the daily quota small.
