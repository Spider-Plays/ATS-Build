# Full legacy import: MRF + candidates + resumes + IFT + employee referrals
param(
  [string]$DataDir = "C:\Users\Karthik_VC\OneDrive - Intact Green Services (India) PVT LTD\Desktop\data"
)

$ErrorActionPreference = "Stop"
$env:ATS_ENV = "staging"

Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 1/3  Legacy import (MRF + candidates + resumes)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
npm run db:import-legacy -- --data-dir $DataDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$ift = Join-Path $DataDir "Interview Feedback Tracker(IFT).csv"
if (Test-Path -LiteralPath $ift) {
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host " 2/3  Interview Feedback Tracker (IFT)" -ForegroundColor Cyan
  Write-Host "========================================" -ForegroundColor Cyan
  npm run db:import-ift-feedback -- --csv $ift
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "IFT CSV not found — skipping" -ForegroundColor Yellow
}

$ref = Join-Path $DataDir "EmployeeReferralTracker.csv"
if (Test-Path -LiteralPath $ref) {
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host " 3/3  Employee Referral Tracker" -ForegroundColor Cyan
  Write-Host "========================================" -ForegroundColor Cyan
  npm run db:import-employee-referrals -- --csv $ref
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "EmployeeReferralTracker.csv not found — skipping" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "All import steps finished." -ForegroundColor Green
