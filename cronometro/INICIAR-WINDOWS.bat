@echo off
rem Cronometro Sync - de dois cliques para iniciar (Windows).
title Cronometro Sync
cd /d "%~dp0"

if not exist "server.js" goto semarquivos
where node >nul 2>nul
if errorlevel 1 goto semnode

node server.js --abrir
echo.
echo  O servidor foi encerrado. Pode fechar esta janela.
pause >nul
exit /b 0

:semnode
echo.
echo  ============================================================
echo   Falta instalar o Node.js neste computador (so uma vez).
echo   Vou abrir o site: baixe a versao "LTS", instale e depois
echo   de dois cliques neste arquivo de novo.
echo  ============================================================
echo.
start "" "https://nodejs.org/pt-br/download"
pause
exit /b 1

:semarquivos
echo.
echo  Nao encontrei os arquivos do cronometro.
echo  Descompacte (extraia) o arquivo ZIP inteiro antes e abra
echo  este arquivo de dentro da pasta "cronometro".
echo.
pause
exit /b 1
