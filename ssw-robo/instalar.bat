@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nao encontrado. Instale em https://nodejs.org ^(versao LTS^) e rode de novo. & pause & exit /b 1)
echo Instalando dependencias...
call npm install || (pause & exit /b 1)
echo Instalando navegador Chromium do robo...
call npx playwright install chromium || (pause & exit /b 1)
echo.
echo Instalacao concluida. Use consultar.bat
pause
