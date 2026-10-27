<#
.SYNOPSIS
  Migrate SharePoint candidate export (CSV + resumes) into Stitch ATS / Postgres.

.DESCRIPTION
  Expects either:
    - An extracted folder:  ...\data\Candidate_sheet.csv  and  ...\data\resume\{RESUME_ID}.pdf
    - Or a .zip containing that structure (will extract to a temp folder)

  Uses server DATABASE_URL from .env / .env.staging (local QA by default).

.PARAMETER DataDir
  Path to the extracted `data` folder (contains Candidate_sheet.csv and resume\).

.PARAMETER ZipPath
  Path to data.zip; extracted automatically if DataDir is not set.

.PARAMETER DryRun
  Parse and report only — no database writes.

.PARAMETER SkipResumes
  Import requirements/candidates/interviews/offers only (no PDF attach).

.PARAMETER ForceResume
  Overwrite existing resume files on disk.

.PARAMETER CreatedBy
  User id used when recruiter email is not found in ATS (defaults to first SUPER_ADMIN).

.EXAMPLE
  .\scripts\migrate-sharepoint.ps1 -ZipPath "$env:USERPROFILE\Desktop\data.zip" -DryRun

.EXAMPLE
  .\scripts\migrate-sharepoint.ps1 -DataDir "C:\legacy-import\data"

.EXAMPLE
  .\scripts\migrate-sharepoint.ps1 -ZipPath "C:\Users\...\Desktop\data.zip" -CreatedBy "clxxxx"
#>
[CmdletBinding()]
param(
  [string]$DataDir = "",
  [string]$ZipPath = "",
  [switch]$DryRun,
  [switch]$SkipResumes,
  [switch]$ForceResume,
  [string]$CreatedBy = ""
)

$ErrorActionPreference = "Stop"
$serverRoot = Split-Path -Parent $PSScriptRoot
Set-Location $serverRoot

function Resolve-DataDir {
  if ($DataDir) {
    $resolved = (Resolve-Path $DataDir).Path
    $csv = Join-Path $resolved "Candidate_sheet.csv"
    if (-not (Test-Path $csv)) {
      throw "Candidate_sheet.csv not found in $resolved"
    }
    return $resolved
  }

  if (-not $ZipPath) {
    throw "Pass -DataDir <path\to\data> or -ZipPath <path\to\data.zip>"
  }

  $zip = (Resolve-Path $ZipPath).Path
  $extractRoot = Join-Path $env:TEMP ("ats-sharepoint-import-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Write-Host "Extracting $zip → $extractRoot"
  tar -xf $zip -C $extractRoot

  $candidates = @(
    (Join-Path $extractRoot "data"),
    $extractRoot
  )
  foreach ($dir in $candidates) {
    if (Test-Path (Join-Path $dir "Candidate_sheet.csv")) {
      return $dir
    }
  }

  $found = Get-ChildItem -Path $extractRoot -Recurse -Filter "Candidate_sheet.csv" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($found) {
    return $found.Directory.FullName
  }

  throw "Could not find Candidate_sheet.csv inside $ZipPath"
}

$dataPath = Resolve-DataDir
Write-Host ""
Write-Host "=== SharePoint → Stitch ATS migration ==="
Write-Host "Data dir: $dataPath"
Write-Host "Server:   $serverRoot"
Write-Host "Mode:     $(if ($DryRun) { 'DRY RUN' } else { 'IMPORT' })"
Write-Host ""

$npmArgs = @("run", "db:import-legacy", "--", "--data-dir", $dataPath)
if ($DryRun) { $npmArgs += "--dry-run" }
if ($SkipResumes) { $npmArgs += "--skip-resumes" }
if ($ForceResume) { $npmArgs += "--force-resume" }
if ($CreatedBy) { $npmArgs += @("--created-by", $CreatedBy) }

Write-Host ("npm " + ($npmArgs -join " "))
Write-Host ""
& npm @npmArgs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Done. See docs/qa/LEGACY_IMPORT.md for flags and sync-to-QA notes."
