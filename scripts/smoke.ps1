# Post-deploy smoke test: health, readiness, landing page, guest demo start and document list.
# Usage: ./scripts/smoke.ps1 -BaseUrl https://your-app.example.com
param([Parameter(Mandatory = $true)][string]$BaseUrl)
$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Step([string]$Name, [scriptblock]$Action) {
    try {
        $result = & $Action
        Write-Host ("{0,-28} OK {1}" -f $Name, $result) -ForegroundColor Green
    }
    catch {
        Write-Host ("{0,-28} FAIL {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
}

Step "GET /health" { (Invoke-WebRequest "$base/health" -UseBasicParsing).StatusCode }
Step "GET /health/ready" { (Invoke-WebRequest "$base/health/ready" -UseBasicParsing).StatusCode }
Step "GET / (landing)" {
    if ((Invoke-WebRequest "$base/" -UseBasicParsing).Content -notmatch "<app-root") { throw "no app shell" }
    "app shell served"
}
$script:token = $null
Step "GET antiforgery token" {
    $script:token = (Invoke-RestMethod "$base/api/auth/antiforgery" -WebSession $session).token
    "token"
}
Step "POST /api/demo/start" {
    (Invoke-RestMethod "$base/api/demo/start" -Method Post -WebSession $session -Headers @{ "X-XSRF-TOKEN" = $script:token }).tenantId
}
$script:project = $null
Step "GET /api/auth/me" {
    $script:project = (Invoke-RestMethod "$base/api/auth/me" -WebSession $session).projects[0].id
    "project $script:project"
}
Step "GET project documents" {
    $n = (Invoke-RestMethod "$base/api/projects/$script:project/documents?pageSize=50" -WebSession $session).totalCount
    if ($n -lt 1) { throw "no documents" }
    "$n documents"
}
Write-Host "Smoke test passed for $base" -ForegroundColor Green
