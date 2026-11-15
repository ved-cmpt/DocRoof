# Owner-only actions

These steps need the repository owner's accounts or approval. Nothing here has been done automatically.

## 1. Publish the repository on GitHub

```powershell
# create an empty repository named DocRoof on github.com first (no README/licence), then:
git remote add origin https://github.com/<your-user>/DocRoof.git
git push -u origin main
```

After the first push, open the **Actions** tab and confirm the `ci` workflow runs. The integration tests use
Testcontainers, which works on GitHub's ubuntu runners without extra setup.

## 2. Set the GitHub link on the site

The landing page footer links to `https://github.com/` as a placeholder. Replace it with the repository URL in
`web/src/app/shared/brand.ts` (search for "link set by owner").

Deployment steps (Azure SQL free offer + Render) are added in Phase 3.
