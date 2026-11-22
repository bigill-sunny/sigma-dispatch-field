@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo Install Node.js 24 or newer, then reopen this launcher. & pause & exit /b 1)
node -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)" || (echo Node.js 24 or newer is required. & pause & exit /b 1)
node server.js --open
pause
