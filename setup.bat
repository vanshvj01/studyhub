@echo off
cd /d "%~dp0"
title StudyHub setup
echo ============================
echo   StudyHub one-click setup
echo ============================
echo.

rem Free port 3000 in case a previous StudyHub server is still running
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do (
  echo Stopping previous server (PID %%p)...
  taskkill /f /pid %%p >nul 2>nul
)

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker not found.
  echo Install Docker Desktop from https://www.docker.com/products/docker-desktop/
  echo then launch it and run this file again.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker is installed but not running.
  echo Open Docker Desktop from the Start menu, wait for the whale icon
  echo to say "Engine running", then double-click this file again.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install the LTS version from https://nodejs.org then run this again.
  pause
  exit /b 1
)

echo [1/4] Starting MySQL + MongoDB containers...
docker compose up -d
if errorlevel 1 (
  echo [ERROR] docker compose failed. See message above.
  pause
  exit /b 1
)

echo [2/4] Waiting for MySQL to finish initializing (first run takes ~30s)...
set tries=0
:waitloop
set /a tries+=1
docker compose exec -T mysql mysqladmin ping -h localhost --silent >nul 2>nul
if not errorlevel 1 goto mysqlready
if %tries% geq 30 (
  echo [ERROR] MySQL did not become ready. Run: docker compose logs mysql
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul
goto waitloop
:mysqlready
echo       MySQL is ready.

echo [3/4] Creating .env and installing dependencies...
if not exist .env copy .env.example .env >nul
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] npm install failed. See message above.
  pause
  exit /b 1
)

echo [4/4] Starting StudyHub...
echo.
echo   Opening http://localhost:3000  (login: vansh@studyhub.dev / password123)
echo   Keep this window open. Press Ctrl+C to stop the server.
echo.
start "" http://localhost:3000
call npm start
pause
