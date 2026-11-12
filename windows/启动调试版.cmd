@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
call npm start
if errorlevel 1 pause
endlocal
