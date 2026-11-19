@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

rem 清理指定目录下超过 N 天的日志文件
set "LOG_DIR=%~1"
if "%LOG_DIR%"=="" set "LOG_DIR=%~dp0logs"
set /a DAYS=30
if not "%~2"=="" set /a DAYS=%~2

if not exist "%LOG_DIR%" (
    echo 目录不存在: %LOG_DIR%
    exit /b 1
)

set /a COUNT=0
for /f "delims=" %%F in ('forfiles /p "%LOG_DIR%" /m *.log /d -%DAYS% /c "cmd /c echo @path" 2^>nul') do (
    del /q %%F
    set /a COUNT+=1
)

echo 已删除 !COUNT! 个超过 %DAYS% 天的日志
endlocal
