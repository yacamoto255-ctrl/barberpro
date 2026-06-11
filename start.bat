@echo off
title BarberPro Servers
echo.
echo  Iniciando BarberPro...
echo.

REM Mata processos antigos nas portas 3000 e 8080
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080 "') do taskkill /F /PID %%a >nul 2>&1

timeout /t 1 /nobreak >nul

REM Inicia WhatsApp Service (porta 8080)
start "WhatsApp Service :8080" cmd /k "cd /d C:\Users\yagob\Claude\whatsapp-service && node server.js"

timeout /t 2 /nobreak >nul

REM Inicia BarberPro API (porta 3000)
start "BarberPro API :3000" cmd /k "cd /d C:\Users\yagob\Claude\barberpro && node server.js"

timeout /t 3 /nobreak >nul

echo.
echo  Servidores iniciados!
echo  BarberPro:  http://localhost:3000
echo  WhatsApp:   http://localhost:8080
echo.
start http://localhost:3000
