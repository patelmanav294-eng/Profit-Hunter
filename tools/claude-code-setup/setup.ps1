<#
    Ek hi command se Windows par sab set ho jaata hai:
    Node.js -> Claude Code CLI -> Profit-Hunter repo clone -> Python (backtest ke liye)
    -> aakhir me Claude khud start ho jaata hai.

    Chalane ka tareeka - Admin PowerShell me ye ek line paste karo:

        irm https://raw.githubusercontent.com/patelmanav294-eng/Profit-Hunter/claude/chat-session-0c1q0i/tools/claude-code-setup/setup.ps1 | iex

    Koi parameter nahi chahiye. Jo cheez pehle se installed mile use skip kar deta
    hai, isliye dobara chalana bhi safe hai (re-run = update).

    Sirf EK manual step hoga jo automate nahi ho sakta: pehli baar Claude khulega
    to browser me apna Anthropic account se login karna hoga. Ye har AI tool ke
    saath aisa hi hota hai - security ke liye, koi script isko bypass nahi kar sakta.
#>

$ErrorActionPreference = 'Stop'
function Head($t) { Write-Host ""; Write-Host $t -ForegroundColor Cyan
                    Write-Host ("=" * $t.Length) -ForegroundColor DarkCyan }
function Step($t) { Write-Host "  $t" -ForegroundColor DarkGray }
function Ok($t)   { Write-Host "  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  $t" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Claude Code - Master Setup" -ForegroundColor White
Write-Host "  Node.js + Claude Code + Profit-Hunter, ek hi baar me" -ForegroundColor DarkGray

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ============ admin check ============
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  Admin ke bina Node.js install nahi ho payega." -ForegroundColor Red
    Write-Host "  Start button par right-click -> 'Terminal (Admin)' -> phir ye line dobara paste karo." -ForegroundColor Yellow
    Write-Host ""
    return
}

function Refresh-Path {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$m;$u"
}

# ============ Node.js ============
Head "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    Ok ("Pehle se hai: " + (node -v))
} else {
    Step "Nahi mila, install kar raha hoon..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $installed = $false
    if ($winget) {
        try {
            winget install -e --id OpenJS.NodeJS.LTS --silent `
                --accept-package-agreements --accept-source-agreements | Out-Null
            $installed = $true
        } catch { Warn "winget se nahi hua, seedha download try kar raha hoon..." }
    }
    if (-not $installed) {
        Step "nodejs.org se latest LTS dhoondh raha hoon..."
        $idx = Invoke-RestMethod "https://nodejs.org/dist/index.json"
        $lts = $idx | Where-Object { $_.lts } | Select-Object -First 1
        if (-not $lts) { Write-Host "  LTS version nahi mila." -ForegroundColor Red; return }
        $ver = $lts.version
        $msi = Join-Path $env:TEMP "node-$ver.msi"
        Step "Node $ver download ho raha hai..."
        Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-x64.msi" -OutFile $msi -UseBasicParsing
        Step "Install ho raha hai..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
    }
    Refresh-Path
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "  Node.js install ho gaya lekin is terminal me abhi dikh nahi raha." -ForegroundColor Yellow
        Write-Host "  Ye terminal band karke naya Admin PowerShell kholo, phir yehi line dobara paste karo." -ForegroundColor Yellow
        return
    }
    Ok ("Install ho gaya: " + (node -v))
}

# ============ Claude Code CLI ============
Head "Claude Code"
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
    Ok "Pehle se install hai."
} else {
    Step "npm se install kar raha hoon (thodi der lagegi)..."
    npm install -g @anthropic-ai/claude-code
    Refresh-Path
    $claude = Get-Command claude -ErrorAction SilentlyContinue
    if (-not $claude) {
        Write-Host "  Install ho gaya lekin is terminal me abhi dikh nahi raha." -ForegroundColor Yellow
        Write-Host "  Naya Admin PowerShell kholo, phir yehi line dobara paste karo - baaki sab skip ho jayega." -ForegroundColor Yellow
        return
    }
    Ok "Install ho gaya."
}

# ============ Git + repo ============
Head "Profit-Hunter"
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "  Git install nahi hai." -ForegroundColor Red
    Write-Host "  https://git-scm.com/downloads se install karo (default settings theek hain)," -ForegroundColor Yellow
    Write-Host "  phir yehi line dobara paste karo - Node/Claude wapas install nahi honge." -ForegroundColor Yellow
    return
}
$dest = Join-Path $env:USERPROFILE "Desktop\Profit-Hunter"
if (Test-Path (Join-Path $dest ".git")) {
    Step "Pehle se hai, latest kheech raha hoon..."
    Push-Location $dest
    git pull origin claude/chat-session-0c1q0i 2>&1 | Out-Null
    Pop-Location
} else {
    Step "Desktop par clone kar raha hoon..."
    git clone -b claude/chat-session-0c1q0i https://github.com/patelmanav294-eng/Profit-Hunter.git $dest 2>&1 | Out-Null
}
Ok "Ready: $dest"

# ============ Python (Trend Anchor backtest ke liye) ============
Head "Python"
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
    Ok ("Pehle se hai: " + (python --version))
    Step "pandas/numpy check ho raha hai..."
    python -m pip install --quiet --disable-pip-version-check pandas numpy
    Ok "Ready - /backtest, /validate chal sakenge."
} else {
    Warn "Python nahi mila - /backtest aur /validate ke liye zaroori hai (Pine indicator ke liye nahi)."
    Warn "python.org/downloads se install karo (PATH me add tick karna), phir yehi line dobara chalana."
}

# ============ Shuru ============
Head "Shuru"
Write-Host "  Sab set ho gaya." -ForegroundColor Green
Write-Host "  Ab Claude khud khulega - pehli baar browser me apna account se login karna hoga (ye ek hi manual step hai)." -ForegroundColor Yellow
Write-Host ""
Set-Location $dest
claude
