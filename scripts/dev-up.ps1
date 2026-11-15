# Starts SQL Server (Docker, host port 14330) and optionally the API (5180) and web app (4210).
# Usage: ./scripts/dev-up.ps1            -> database only, prints next steps
#        ./scripts/dev-up.ps1 -StartApps -> also opens the API and web app in new windows
param([switch]$StartApps)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

docker compose up -d sql
Write-Host "Waiting for SQL Server to become healthy..."
$status = ""
for ($i = 0; $i -lt 60; $i++) {
    $status = docker inspect -f "{{.State.Health.Status}}" docroof-sql 2>$null
    if ($status -eq "healthy") { break }
    Start-Sleep -Seconds 3
}
if ($status -ne "healthy") { throw "SQL Server did not become healthy (status: $status)" }
Write-Host "SQL Server is healthy on 127.0.0.1:14330" -ForegroundColor Green

if (-not (Test-Path "web/node_modules")) { Push-Location web; npm ci; Pop-Location }

if ($StartApps) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "dotnet run --project api/src/DocRoof.Api --launch-profile http"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location web; npm start"
    Write-Host "API: http://localhost:5180  App: http://localhost:4210"
} else {
    Write-Host ""
    Write-Host "Next, in two terminals:"
    Write-Host "  dotnet run --project api/src/DocRoof.Api --launch-profile http   # API on http://localhost:5180 (migrates + seeds)"
    Write-Host "  cd web; npm start                                               # App on http://localhost:4210"
}
