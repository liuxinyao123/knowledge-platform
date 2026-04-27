<#
.SYNOPSIS
    一次性安装 Claude Code 四阶段流水线命令包（本地每人执行一次）。

.DESCRIPTION
    基于 superpowers-openspec-team-skills 的约定，把 .claude/commands/
    下的工作流文件与 openspec CLI 准备齐全。默认安装 Bundle
    'superpowers-openspec-execution'，包含工作流 A/B/C/D 四条命令。

.PARAMETER Bundle
    要安装的命令包名：
      - superpowers-openspec-execution （默认，全部四个工作流）
      - openspec-feature                (仅 D)
      - superpowers-feature              (仅 C)

.PARAMETER ProjectRoot
    项目根目录。默认当前路径。

.PARAMETER CheckDependencies
    仅检查依赖（Node/openspec CLI/.claude/commands 是否齐全），不做安装。

.EXAMPLE
    .\scripts\install-claude-code.ps1 -Bundle superpowers-openspec-execution -ProjectRoot .

.EXAMPLE
    .\scripts\install-claude-code.ps1 -Bundle superpowers-openspec-execution -CheckDependencies
#>
[CmdletBinding()]
param(
    [ValidateSet('superpowers-openspec-execution', 'openspec-feature', 'superpowers-feature')]
    [string]$Bundle = 'superpowers-openspec-execution',

    [string]$ProjectRoot = ".",

    [switch]$CheckDependencies
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = Resolve-Path -Path $ProjectRoot | Select-Object -ExpandProperty Path

function Write-Section($msg) {
    Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Test-Tool($name, $probe) {
    try {
        & $probe | Out-Null
        Write-Host "  [OK] $name" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [MISSING] $name" -ForegroundColor Red
        return $false
    }
}

# ---- 依赖检查 ----
Write-Section "Dependency check (Bundle = $Bundle)"

$nodeOk    = Test-Tool 'Node.js (>=18)' { node --version }
$pnpmOk    = Test-Tool 'pnpm'            { pnpm --version }
$openspec  = Test-Tool 'openspec CLI'    { openspec --version }

if (-not $openspec) {
    Write-Host "  Tip: install via 'npm install -g @openspec/cli' (name may vary)" -ForegroundColor Yellow
}

$commandsDir = Join-Path $resolvedRoot '.claude/commands'
$claudeMd    = Join-Path $resolvedRoot 'CLAUDE.md'
$memoryDir   = Join-Path $resolvedRoot '.superpowers-memory'

Write-Host "  commands dir: $commandsDir"
Write-Host "  CLAUDE.md   : $claudeMd"
Write-Host "  memory dir  : $memoryDir"

if ($CheckDependencies) {
    if ($nodeOk -and $pnpmOk -and $openspec -and (Test-Path $commandsDir)) {
        Write-Host "`nAll checks passed." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`nChecks failed. See messages above." -ForegroundColor Red
        exit 1
    }
}

# ---- 安装 ----
Write-Section "Installing bundle '$Bundle'"

$expectedCommands = switch ($Bundle) {
    'superpowers-openspec-execution' {
        @(
            'openspec-superpowers-workflow.md',
            'superpowers-openspec-execution-workflow.md',
            'superpowers-feature-workflow.md',
            'openspec-feature-workflow.md'
        )
    }
    'openspec-feature'      { @('openspec-feature-workflow.md') }
    'superpowers-feature'   { @('superpowers-feature-workflow.md') }
}

if (-not (Test-Path $commandsDir)) {
    New-Item -ItemType Directory -Path $commandsDir | Out-Null
    Write-Host "Created $commandsDir"
}

$missing = @()
foreach ($f in $expectedCommands) {
    $p = Join-Path $commandsDir $f
    if (-not (Test-Path $p)) { $missing += $f }
}

if ($missing.Count -gt 0) {
    Write-Host "Missing command files (commit them from the reference repo):" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  - $_" }
    Write-Host "Refer to https://github.com/SYZ-Coder/superpowers-openspec-team-skills" -ForegroundColor Yellow
} else {
    Write-Host "All bundle command files present." -ForegroundColor Green
}

# ---- .superpowers-memory bootstrap ----
if (-not (Test-Path $memoryDir)) {
    New-Item -ItemType Directory -Path $memoryDir | Out-Null
    @"
# Superpowers Memory

共享项目记忆。每次工作流启动时 Claude 会读取并尝试保持最新。
子目录建议：

- decisions/   架构决策记录 (ADR)
- glossary.md  业务名词统一
- open-questions.md  未解问题
"@ | Set-Content -Path (Join-Path $memoryDir 'README.md') -Encoding utf8
    New-Item -ItemType Directory -Path (Join-Path $memoryDir 'decisions') | Out-Null
    Write-Host "Bootstrapped $memoryDir"
}

# ---- CLAUDE.md 校验 ----
if (Test-Path $claudeMd) {
    $content = Get-Content $claudeMd -Raw
    foreach ($cmd in $expectedCommands) {
        $name = [IO.Path]::GetFileNameWithoutExtension($cmd)
        if ($content -notmatch [regex]::Escape($name)) {
            Write-Host "[WARN] CLAUDE.md does not reference '$name'" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "[WARN] CLAUDE.md not found at $claudeMd" -ForegroundColor Yellow
}

Write-Section "Done"
Write-Host "下一步：在 Claude Code 会话首句调用 \$<workflow-name> 触发对应流水线。"
