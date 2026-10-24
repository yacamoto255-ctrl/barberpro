@echo off
cd /d "%~dp0"
if not exist node_modules (echo Rode primeiro o instalar.bat & pause & exit /b 1)
node src\cli.js %* --csv=saida\fretes.csv
pause
