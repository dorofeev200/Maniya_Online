@echo off
rem Weekly auto-backup of VPS irreplaceable state (docs/vps-restore-guide.md).
rem Log: backup/backup-weekly.log (backup/ gitignored — secrets stay local).
setlocal
set "REPO=C:\Users\Admin\Maniya_Online"
set "LOG=%REPO%\backup\backup-weekly.log"
if not exist "%REPO%\backup" mkdir "%REPO%\backup"
if not exist "%LOG%" type nul > "%LOG%"
echo [%date% %time%] --- backup start --->> "%LOG%"
"C:\Program Files\Git\usr\bin\bash.exe" -lc "set -euo pipefail; export HOME=/c/Users/Admin; bash /c/Users/Admin/Maniya_Online/scripts/backup-remote.sh" >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo [%date% %time%] --- backup exit=%RC% --->> "%LOG%"
exit /b %RC%