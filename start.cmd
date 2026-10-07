@echo off
cd /d "%~dp0"
if not exist "dist\index.html" (
    echo Building site...
    call npm run build
)
echo Starting SAIPEN Website preview at http://localhost:4321 ...
call npx astro preview --open
