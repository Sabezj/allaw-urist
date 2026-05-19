# Deploy allaw-urist.ru to VPS
# Root cause: Need to build and deploy from dev root (F:\GitHub\vangZ_strict_patched_plus_voice_assistant\)
# to production VPS at 89.125.92.10 under /opt/sed-lex-voice

$ErrorActionPreference = "Stop"

# Configuration
$VPS_IP = "89.125.92.10"
$VPS_USER = "root"
$SSH_KEY = "$env:USERPROFILE\.ssh\id_rsa_deploy"
$DEV_ROOT = "F:\GitHub\vangZ_strict_patched_plus_voice_assistant"
$VPS_PROJECT_DIR = "/opt/sed-lex-voice"
$PROJECT_NAME = "allaw-urist.ru"
$DOMAIN = "allaw-urist.ru"

# SSH/SCP executables
$SSH_EXE = Join-Path $env:WINDIR "System32\OpenSSH\ssh.exe"
$SCP_EXE = Join-Path $env:WINDIR "System32\OpenSSH\scp.exe"
if (!(Test-Path $SSH_EXE)) { $SSH_EXE = "ssh" }
if (!(Test-Path $SCP_EXE)) { $SCP_EXE = "scp" }

Write-Host "=== Deploying $PROJECT_NAME to VPS ===" -ForegroundColor Cyan
Write-Host "VPS: $VPS_USER@$VPS_IP"
Write-Host "Dev Root: $DEV_ROOT"
Write-Host "VPS Dir: $VPS_PROJECT_DIR"
Write-Host ""

# Step 1: Check SSH connection
Write-Host "Step 1: Checking SSH connection..." -ForegroundColor Yellow
try {
    $test = & $SSH_EXE -i $SSH_KEY -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP "echo 'OK'"
    if ($test -ne "OK") {
        throw "SSH connection failed"
    }
    Write-Host "✓ SSH connection successful" -ForegroundColor Green
} catch {
    Write-Host "✗ SSH connection failed: $_" -ForegroundColor Red
    Write-Host "Check: SSH key at $SSH_KEY" -ForegroundColor Yellow
    exit 1
}

# Step 2: Verify local dependencies (no build yet - will build on server)
Write-Host "`nStep 2: Verifying local project..." -ForegroundColor Yellow
if (!(Test-Path "$DEV_ROOT/package.json")) {
    Write-Host "✗ package.json not found at $DEV_ROOT" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Project structure verified" -ForegroundColor Green
Write-Host "⚠ Frontend will be built on VPS with correct domain" -ForegroundColor Yellow

# Step 3: Create temporary deployment package
Write-Host "`nStep 3: Creating deployment package..." -ForegroundColor Yellow
$TEMP_DIR = Join-Path $env:TEMP "allaw-urist-deploy-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $TEMP_DIR -Force | Out-Null

# Copy necessary files (exclude node_modules, include source for server-side build)
$filesToCopy = @(
    "public/*.html",
    "public/*.css",
    "public/*.js",
    "public/modules/*",
    "profiles/*",
    "services/*",
    "src/*",
    "scripts/*.sql",
    "ops/monitoring/*",
    "server.js",
    "embeddingsWorker.js",
    "config.js",
    "profnastil_price.json",
    "package.json",
    "package-lock.json",
    "ecosystem.config.cjs",
    "webpack.config.cjs",
    "webpack.cpnfig.js",
    ".babelrc",
    ".env.example",
    "Dockerfile",
    ".dockerignore"
)

Write-Host "Copying files to temp directory..." -ForegroundColor Gray
foreach ($pattern in $filesToCopy) {
    $sourcePath = Join-Path $DEV_ROOT $pattern
    $relativePath = Split-Path $pattern -Parent
    $destPath = Join-Path $TEMP_DIR $relativePath
    
    if ($relativePath -and !(Test-Path $destPath)) {
        New-Item -ItemType Directory -Path $destPath -Force | Out-Null
    }
    
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $destPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "✓ Deployment package created at $TEMP_DIR" -ForegroundColor Green

# Step 4: Create backup on VPS
Write-Host "`nStep 4: Creating backup on VPS..." -ForegroundColor Yellow
$BACKUP_NAME = "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "if [ -d $VPS_PROJECT_DIR/releases/current ]; then mkdir -p $VPS_PROJECT_DIR/backups && cp -r $VPS_PROJECT_DIR/releases/current $VPS_PROJECT_DIR/backups/$BACKUP_NAME && echo 'Backup created: $BACKUP_NAME'; else echo 'No current release to backup'; fi"

# Step 5: Create release directory on VPS
Write-Host "`nStep 5: Preparing release directory on VPS..." -ForegroundColor Yellow
$RELEASE_NAME = Get-Date -Format 'yyyyMMdd_HHmmss'
$RELEASE_DIR = "$VPS_PROJECT_DIR/releases/$RELEASE_NAME"
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "mkdir -p $RELEASE_DIR"
Write-Host "✓ Created $RELEASE_DIR" -ForegroundColor Green

# Step 6: Upload files to VPS
Write-Host "`nStep 6: Uploading files to VPS..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray

if (Get-Command rsync -ErrorAction SilentlyContinue) {
    # Use rsync for efficient transfer
    $rsyncCmd = "rsync -avz --progress -e 'ssh -i $SSH_KEY' '$TEMP_DIR/' ${VPS_USER}@${VPS_IP}:$RELEASE_DIR/"
    Write-Host "Using rsync..." -ForegroundColor Gray
    Invoke-Expression $rsyncCmd
} else {
    # Fallback to scp
    Write-Host "Using scp (rsync not available)..." -ForegroundColor Gray
    & $SCP_EXE -i $SSH_KEY -r "$TEMP_DIR/*" "${VPS_USER}@${VPS_IP}:$RELEASE_DIR/"
}

Write-Host "✓ Files uploaded" -ForegroundColor Green

# Cleanup temp directory
Remove-Item -Path $TEMP_DIR -Recurse -Force

# Step 7: Install ALL dependencies on VPS (including devDependencies for build)
Write-Host "`nStep 7: Installing dependencies on VPS..." -ForegroundColor Yellow
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "cd $RELEASE_DIR && npm install --no-optional && echo 'Dependencies installed'"

# Step 7b: Build frontend on VPS with production domain
Write-Host "`nStep 7b: Building frontend on VPS..." -ForegroundColor Yellow
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "cd $RELEASE_DIR && export NODE_ENV=production && export DOMAIN=$DOMAIN && npm run build && echo 'Frontend built'"

# Step 7c: Remove devDependencies after build
Write-Host "`nStep 7c: Cleaning up devDependencies..." -ForegroundColor Yellow
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "cd $RELEASE_DIR && npm prune --production && echo 'DevDependencies removed'"

# Step 8: Setup environment file with production settings
Write-Host "`nStep 8: Setting up environment..." -ForegroundColor Yellow
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP @"
cd $RELEASE_DIR && if [ ! -f .env ]; then cp .env.example .env && sed -i 's|NODE_ENV=development|NODE_ENV=production|g' .env && sed -i 's|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,http://$DOMAIN,http://www.$DOMAIN|g' .env && sed -i 's|SSL_DOMAIN=.*|SSL_DOMAIN=$DOMAIN|g' .env && sed -i 's|ENABLE_HTTPS=false|ENABLE_HTTPS=true|g' .env && echo 'Created .env with production defaults' && echo 'REQUIRED: Set OPENAI_API_KEY, ADMIN_API_KEY, ADMIN_SESSION_SECRET, DATABASE_URL'; else echo '.env already exists'; fi
"@

# Step 9: Update symlink to new release
Write-Host "`nStep 9: Switching to new release..." -ForegroundColor Yellow
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "cd $VPS_PROJECT_DIR/releases && rm -f current && ln -s $RELEASE_NAME current && echo 'Symlink updated: current -> $RELEASE_NAME'"

# Step 10: Setup PM2 ecosystem
Write-Host "`nStep 10: Configuring PM2..." -ForegroundColor Yellow
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "cd $VPS_PROJECT_DIR/releases/current && pm2 list | grep -q '$PROJECT_NAME' && pm2 delete $PROJECT_NAME || true"
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "cd $VPS_PROJECT_DIR/releases/current && pm2 start ecosystem.config.cjs --env production && pm2 save && echo 'PM2 configured and started'"

# Step 11: Setup Nginx (if not already configured)
Write-Host "`nStep 11: Checking Nginx configuration..." -ForegroundColor Yellow
$nginxConfig = @"
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade `$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host `$host;
        proxy_cache_bypass `$http_upgrade;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
    }
}
"@

& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "if [ ! -f /etc/nginx/sites-available/$DOMAIN ]; then echo '$nginxConfig' > /etc/nginx/sites-available/$DOMAIN && ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx && echo 'Nginx configured'; else echo 'Nginx already configured'; fi"

# Step 12: Setup SSL with Certbot
Write-Host "`nStep 12: Checking SSL certificate..." -ForegroundColor Yellow
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "if [ ! -d /etc/letsencrypt/live/$DOMAIN ]; then echo 'No SSL certificate found' && echo 'Run: certbot --nginx -d $DOMAIN -d www.$DOMAIN'; else echo 'SSL certificate exists'; fi"

# Step 13: Verify deployment
Write-Host "`nStep 13: Verifying deployment..." -ForegroundColor Yellow
Write-Host "=== Deployment Status ===" -ForegroundColor Cyan
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "ls -lh $VPS_PROJECT_DIR/releases/current"
Write-Host ""
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "pm2 list"
Write-Host ""
& $SSH_EXE -i $SSH_KEY $VPS_USER@$VPS_IP "pm2 logs $PROJECT_NAME --lines 10 --nostream"

Write-Host "`n=== Deployment Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "✓ Release: $RELEASE_NAME" -ForegroundColor Green
Write-Host "✓ Backup: $BACKUP_NAME" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Configure .env on VPS:"
Write-Host "   ssh $VPS_USER@$VPS_IP"
Write-Host "   nano $VPS_PROJECT_DIR/releases/current/.env"
Write-Host ""
Write-Host "2. Setup SSL certificate (if not done):"
Write-Host "   certbot --nginx -d $DOMAIN -d www.$DOMAIN"
Write-Host ""
Write-Host "3. Check application:"
Write-Host "   http://$DOMAIN"
Write-Host ""
Write-Host "To rollback:" -ForegroundColor Yellow
Write-Host "  ssh $VPS_USER@$VPS_IP"
Write-Host "  cd $VPS_PROJECT_DIR/releases"
Write-Host "  rm current && ln -s ../backups/$BACKUP_NAME current"
Write-Host "  pm2 restart $PROJECT_NAME"
Write-Host ""
