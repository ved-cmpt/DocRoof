# Deployment

**Status: NOT COMPLETE.** Everything needed is in the repository and the production image was built and
smoke-tested locally (see docs/STATUS.md), but no hosted environment exists yet: it needs the owner's accounts.
Nothing below has been run against a real cloud account.

## Target ($0 preferred)

| Piece | Service | Notes |
| --- | --- | --- |
| App | Render **free web service** (Docker) | One container serves the API and the built Angular app from the same origin. Free instances sleep after inactivity; the first request after a sleep takes longer. |
| Database + files | **Azure SQL Database free offer** (serverless, General Purpose) | `Storage__Mode=Database` stores uploads in the `StoredFiles` table, so the container needs no disk. The free allowance is monthly; the template sets `AutoPause` when it is used up instead of billing. |

Alternatives the owner may prefer: Azure App Service or Azure Container Apps for the container (the same image works;
set the same environment variables and use `/health/ready` as the health probe).

## Image

`Dockerfile` (multi-stage): Node 24 builds Angular → .NET 10 SDK publishes the API → `mcr.microsoft.com/dotnet/aspnet:10.0`
runtime, non-root `app` user, listening on **8080**, `HEALTHCHECK` that probes `/health`.

Local verification (already done once, see STATUS):

```powershell
docker compose --profile app up -d --build      # SQL Server + production image on http://localhost:5180
./scripts/smoke.ps1 -BaseUrl http://localhost:5180
docker compose --profile app rm -sf app         # stop the app container, keep SQL Server
```

## Environment variables

| Variable | Required | Example / notes |
| --- | --- | --- |
| `ASPNETCORE_ENVIRONMENT` | yes | `Production` |
| `PORT` | Render only | `8080` (Render routes traffic to this port) |
| `ConnectionStrings__DocRoof` | yes (secret) | `Server=tcp:<server>.database.windows.net,1433;Database=docroof;User ID=<login>;Password=<password>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=90;` — the long timeout absorbs serverless resume |
| `Database__MigrateOnStartup` | yes | `true` (applies EF Core migrations, triggers and the view on start) |
| `Database__SeedSampleTenant` | no | `false` in production (visitors use the guest demo; there are no shared login accounts) |
| `Storage__Mode` | yes | `Database` |
| `Storage__MaxUploadBytes` | no | `10485760` (10 MB) is a sensible hosted limit |
| `Demo__IpHashSalt` | yes (secret) | random string; Render's blueprint generates one |
| `Demo__MaxActiveWorkspaces` | no | `100` |
| `Demo__MaxWorkspacesPerIpPerHour` | no | `5` |
| `ForwardedHeaders__Enabled` | yes behind a proxy | `true` so client IPs (rate limits, quotas) and HTTPS scheme come from the proxy headers |
| `Extraction__Provider`, `Extraction__Endpoint`, `Extraction__ApiKey`, `Extraction__DailyQuotaPerTenant` | no | leave unset: rules-based extraction needs nothing. See docs/EXTRACTION.md |

Never set `Cookies__AllowInsecure` or `Database__SampleUserPassword` in a hosted environment.

**CORS:** not needed — the API serves the frontend from the same origin. Only add CORS if a separate frontend origin
is introduced, and then also revisit `SameSite=Strict` cookies.

**HTTPS:** Render terminates TLS and forwards `X-Forwarded-Proto`; with `ForwardedHeaders__Enabled=true` the app sees
HTTPS, issues `Secure` cookies and sends HSTS.

## Step by step (owner)

### 1. Azure SQL Database (free offer)

1. Sign in to the Azure portal → **Create a resource** → **SQL Database**. Or use the template:
   ```bash
   az login
   az group create -n docroof-rg -l canadacentral
   az deployment group create -g docroof-rg -f infra/azure/sql-free.bicep \
     -p serverName=<globally-unique-name> administratorLogin=<login> administratorPassword='<strong password>'
   ```
2. In the portal, open the database → confirm **Free offer applied** and the behaviour "**Auto-pause the database
   until next month**" when the free limit is reached (so it never bills).
3. Networking: the template allows public TLS connections because Render's free plan has no fixed outbound IPs. If
   you want to restrict access, host the container in Azure (App Service/Container Apps with VNet integration) or use
   a provider plan with static egress IPs and replace the firewall rule.
4. Copy the connection string from the deployment output and insert the password.

### 2. Render

1. Push the repository to GitHub (docs/OWNER_TODO.md, step 1).
2. Render dashboard → **New** → **Blueprint** → select the repository → set the blueprint path to
   `infra/render.yaml` (or copy it to the repository root as `render.yaml`).
3. Enter `ConnectionStrings__DocRoof` when prompted (it is `sync: false`, so it is never stored in Git).
4. Deploy. The first start applies migrations (watch the logs for "Applying database migrations").

### 3. Verify

```bash
./scripts/smoke.sh https://<your-service>.onrender.com
```

```powershell
./scripts/smoke.ps1 -BaseUrl https://<your-service>.onrender.com
```

The smoke test checks `/health`, `/health/ready`, that the landing page is served, that a guest demo starts and that
the seeded register lists documents. Then open the site, choose **Try the live demo** and follow the guided task.

### 4. After deploying

- Update `GITHUB_URL` in `web/src/app/shared/site.ts` and the link in README.
- Update docs/STATUS.md with the real URL and smoke-test output (only after it actually passes).

## Operations

- **Guest data** expires after 24 h and is purged every 15 minutes by `GuestCleanupService`.
- **Reminders** run hourly (`Reminders__IntervalMinutes`).
- **Logs** are structured JSON on stdout in production.
- **Rollback:** redeploy the previous image; migrations so far are additive.
