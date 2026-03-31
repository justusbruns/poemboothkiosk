@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: BuildBooth.bat - PoemBooth Kiosk Deployment Launcher
:: ============================================================================
:: This batch file provides an easy double-click interface to deploy
:: PoemBooth Kiosk on a new Windows PC.
::
:: Requirements:
::   - Windows 10/11
::   - Administrator privileges (will auto-elevate)
::   - Node.js, npm, OpenSSL installed
:: ============================================================================

title PoemBooth Kiosk Deployment

:: Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo ============================================================================
    echo  Administrator privileges required. Requesting elevation...
    echo ============================================================================
    echo.

    :: Re-launch as administrator
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: Display banner
cls
echo.
echo ================================================================================
echo.
echo        ____                     ____              _   _       _  ___           _
echo       / __ \                   / __ \            ^| ^| ^| ^|     ^| ^|/ (_)         ^| ^|
echo      ^| ^|  ^| ^|_ __   ___ _ __ ^| ^|  ^| ^|_ __   ___^| ^|_^| ^|__  ^| ' / _  ___  ___^| ^| __
echo      ^| ^|  ^| ^| '_ \ / _ \ '_ \^| ^|  ^| ^| '_ \ / _ \ __^| '_ \ ^|  ^< ^| ^|/ _ \/ __^| ^|/ /
echo      ^| ^|__^| ^| ^|_) ^|  __/ ^| ^| ^| ^|__^| ^| ^| ^| ^|  __/ ^|_^| ^| ^| ^| . \^| ^| (_) \__ \   ^<
echo       \____/^| .__/ \___^|_^| ^|_^|\____/^|_^| ^|_^|\___^|\__^|_^| ^|_^|_^|\_\_^|\___/^|___/_^|\_\
echo             ^| ^|
echo             ^|_^|
echo.
echo                         Unified Deployment Launcher
echo.
echo ================================================================================
echo.

:: Get Asset Tag (REQUIRED)
:GET_ASSET_TAG
echo.
echo  Enter Device Asset Tag (e.g., PB-005):
set /p ASSET_TAG=  ^>

if "!ASSET_TAG!"=="" (
    echo.
    echo  [ERROR] Asset Tag is required!
    goto GET_ASSET_TAG
)

:: Get Hub ID (REQUIRED)
:GET_HUB_ID
echo.
echo  Enter Hub ID (UUID from booking system):
set /p HUB_ID=  ^>

if "!HUB_ID!"=="" (
    echo.
    echo  [ERROR] Hub ID is required!
    goto GET_HUB_ID
)

:: Get Serial Number (OPTIONAL)
echo.
echo  Enter Device Serial Number (optional, press Enter to skip):
set /p SERIAL_NUMBER=  ^>

:: Confirm details
echo.
echo ================================================================================
echo  Deployment Configuration
echo ================================================================================
echo.
echo   Asset Tag:      !ASSET_TAG!
echo   Hub ID:         !HUB_ID!
if not "!SERIAL_NUMBER!"=="" (
    echo   Serial Number:  !SERIAL_NUMBER!
) else (
    echo   Serial Number:  ^(not provided^)
)
echo.
echo ================================================================================
echo.

:: Confirm before proceeding
set /p CONFIRM="  Proceed with deployment? (Y/N): "
if /i not "!CONFIRM!"=="Y" (
    echo.
    echo  Deployment cancelled.
    echo.
    pause
    exit /b
)

:: Run deployment script
echo.
echo ================================================================================
echo  Starting Deployment...
echo ================================================================================
echo.

:: Build PowerShell command
set PS_SCRIPT="%~dp0installer\Deploy-PoemBoothKiosk.ps1"
set PS_ARGS=-AssetTag "!ASSET_TAG!" -HubId "!HUB_ID!"

if not "!SERIAL_NUMBER!"=="" (
    set PS_ARGS=!PS_ARGS! -SerialNumber "!SERIAL_NUMBER!"
)

:: Execute PowerShell script
powershell -ExecutionPolicy Bypass -File !PS_SCRIPT! !PS_ARGS!

:: Check result
if %errorLevel% equ 0 (
    echo.
    echo ================================================================================
    echo  [SUCCESS] Deployment completed successfully!
    echo ================================================================================
    echo.
    echo  Next steps:
    echo   1. Review the output above for any warnings
    echo   2. Reboot the PC: shutdown /r /t 0
    echo   3. The kiosk will start automatically after reboot
    echo.
) else (
    echo.
    echo ================================================================================
    echo  [ERROR] Deployment failed!
    echo ================================================================================
    echo.
    echo  Please review the error messages above.
    echo  Common issues:
    echo   - Missing prerequisites (Node.js, OpenSSL)
    echo   - Incorrect Supabase credentials
    echo   - Network connectivity issues
    echo.
    echo  See QUICK_DEPLOYMENT.md for troubleshooting help.
    echo.
)

:: Pause to review output
echo.
pause

endlocal
