@echo off
title Mesa RPG Digital
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado. Baixe em https://nodejs.org
    pause
    exit
)

if not exist "node_modules" (
    echo Instalando dependencias...
    npm install
)

echo.
echo === Mesa RPG Digital ===
echo Acesse: http://localhost:5000
echo.
node app.js
pause
