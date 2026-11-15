# Drops the local DocRoof database and stored files. The next API start re-applies migrations and re-seeds.
# Only touches the local docroof-sql container and the repo-local data/ folder.
param([switch]$Force)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not $Force) {
    $answer = Read-Host "This deletes the local DocRoof database and data/files. Type yes to continue"
    if ($answer -ne "yes") { Write-Host "Cancelled."; exit 1 }
}
$password = if ($env:MSSQL_SA_PASSWORD) { $env:MSSQL_SA_PASSWORD } else { "DocRoof_Local_Dev_2026!" }
$sql = "IF DB_ID(DocRoof) IS NOT NULL BEGIN ALTER DATABASE [DocRoof] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [DocRoof]; END"
docker exec docroof-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P $password -C -b -Q $sql
if ($LASTEXITCODE -ne 0) { throw "Dropping the database failed." }
if (Test-Path "data/files") { Remove-Item -Recurse -Force "data/files" }
Write-Host "Local database dropped. Start the API to migrate and seed again." -ForegroundColor Green
