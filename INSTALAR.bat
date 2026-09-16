@echo off
setlocal enabledelayedexpansion
echo ============================================
echo   Instal.lador Orquestador 1076 - Tavil
echo ============================================
echo.

REM --- Comprovar que s'executa com a administrador (calen permisos per als
REM     serveis NSSM i el firewall) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Cal executar aquest script com a Administrador.
    echo Fes clic dret sobre INSTALAR.bat -^> "Executar com administrador"
    pause
    exit /b 1
)

REM --- Detectar Python ---
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python no trobat. Instal.la Python des de https://python.org
    echo IMPORTANT: marca la casella "Add python.exe to PATH" durant la instal.lacio.
    pause
    exit /b 1
)

REM --- Detectar Node.js (cal per executar el servidor web SSR) ---
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no trobat. Instal.la Node.js LTS des de https://nodejs.org
    pause
    exit /b 1
)

REM --- Comprovar nssm.exe ---
if not exist "%~dp0nssm.exe" (
    echo ERROR: nssm.exe no trobat a la carpeta del projecte.
    echo Descarrega'l de https://nssm.cc/download ^(versio win64^) i col.loca'l aqui.
    pause
    exit /b 1
)

REM --- Comprovar acces a les unitats de xarxa (\\SRVDADES i \\TRUMPFSRV) ---
REM     El servidor NOMES fa servir rutes UNC (\\SRVDADES\..., \\TRUMPFSRV\...),
REM     mai lletres d'unitat (P:\, M:\) -- no cal mapejar res, nomes que
REM     aquest PC tingui acces de xarxa a aquests dos servidors.
echo Comprovant acces a la xarxa...
if not exist "\\SRVDADES\dades domoli" (
    echo AVIS: No es pot accedir a \\SRVDADES\dades domoli des d'aquest PC.
    echo       El sistema no funcionara be fins que aquest recurs sigui accessible.
    echo.
)
if not exist "\\TRUMPFSRV\Maquinas" (
    echo AVIS: No es pot accedir a \\TRUMPFSRV\Maquinas des d'aquest PC.
    echo       Nomes afecta l'Anulador de programes TruBend, la resta funciona igual.
    echo.
)

REM --- Crear estructura de carpetes que fa servir el servidor ---
echo Creant carpetes necessaries...
mkdir "C:\DXF TEMPORAL\MACROS\temp_pdf" 2>nul
mkdir "C:\DXF TEMPORAL\Automatizacion\temp" 2>nul

REM --- Instal.lar dependencies Python ---
echo.
echo Instal.lant dependencies Python (pot trigar uns minuts)...
cd /d "%~dp0Servidor"
python -m pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo ERROR: Ha fallat la instal.lacio de dependencies Python.
    pause
    exit /b 1
)

echo Instal.lant navegador Chromium per a Playwright...
python -m playwright install chromium
if %errorlevel% neq 0 (
    echo ERROR: Ha fallat la instal.lacio de Chromium.
    pause
    exit /b 1
)

REM --- Build de l'app web ---
echo.
echo Instal.lant dependencies i compilant l'app web (pot trigar uns minuts)...
cd /d "%~dp0Web"
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Ha fallat "npm install".
    pause
    exit /b 1
)
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Ha fallat "npm run build".
    pause
    exit /b 1
)
if not exist "%~dp0Web\.output\server\index.mjs" (
    echo ERROR: El build no ha generat .output\server\index.mjs
    pause
    exit /b 1
)

REM --- Localitzar els executables reals ---
for /f "tokens=*" %%i in ('python -c "import sys; print(sys.executable)"') do set PYTHON_EXE=%%i
for /f "tokens=*" %%i in ('where node') do set NODE_EXE=%%i & goto :node_found
:node_found

echo.
echo Python:  %PYTHON_EXE%
echo Node.js: %NODE_EXE%

REM --- Desinstal.lar serveis anteriors d'aquest instal.lador si existien ---
"%~dp0nssm.exe" stop OrquestadorAPI >nul 2>&1
"%~dp0nssm.exe" remove OrquestadorAPI confirm >nul 2>&1
"%~dp0nssm.exe" stop OrquestadorWeb >nul 2>&1
"%~dp0nssm.exe" remove OrquestadorWeb confirm >nul 2>&1

REM --- Servei API (FastAPI / uvicorn, port 8080) ---
echo.
echo Instal.lant servei API (OrquestadorAPI)...
"%~dp0nssm.exe" install OrquestadorAPI "%PYTHON_EXE%"
"%~dp0nssm.exe" set OrquestadorAPI AppDirectory "%~dp0Servidor"
"%~dp0nssm.exe" set OrquestadorAPI AppParameters "-m uvicorn main:app --host 0.0.0.0 --port 8080"
"%~dp0nssm.exe" set OrquestadorAPI AppStdout "C:\DXF TEMPORAL\MACROS\servidor_log.txt"
"%~dp0nssm.exe" set OrquestadorAPI AppStderr "C:\DXF TEMPORAL\MACROS\servidor_error.txt"
"%~dp0nssm.exe" set OrquestadorAPI AppRotateFiles 1
"%~dp0nssm.exe" set OrquestadorAPI AppRotateBytes 5000000
"%~dp0nssm.exe" set OrquestadorAPI Start SERVICE_AUTO_START

REM --- Servei Web (servidor Node.js SSR de TanStack Start, port 3000) ---
REM     IMPORTANT: aquesta app NO es una SPA estatica -- fa server-side
REM     rendering amb Nitro/TanStack Start, cal executar-la amb Node.js
REM     (.output\server\index.mjs), no serveix fer "python -m http.server".
echo Instal.lant servei Web (OrquestadorWeb)...
"%~dp0nssm.exe" install OrquestadorWeb "%NODE_EXE%"
"%~dp0nssm.exe" set OrquestadorWeb AppDirectory "%~dp0Web"
"%~dp0nssm.exe" set OrquestadorWeb AppParameters ".output\server\index.mjs"
"%~dp0nssm.exe" set OrquestadorWeb AppEnvironmentExtra PORT=3000 HOST=0.0.0.0
"%~dp0nssm.exe" set OrquestadorWeb AppStdout "C:\DXF TEMPORAL\MACROS\web_servidor_log.txt"
"%~dp0nssm.exe" set OrquestadorWeb AppStderr "C:\DXF TEMPORAL\MACROS\web_servidor_error.txt"
"%~dp0nssm.exe" set OrquestadorWeb AppRotateFiles 1
"%~dp0nssm.exe" set OrquestadorWeb AppRotateBytes 5000000
"%~dp0nssm.exe" set OrquestadorWeb Start SERVICE_AUTO_START

REM --- Regles de firewall ---
echo.
echo Configurant firewall...
netsh advfirewall firewall delete rule name="OrquestadorAPI" >nul 2>&1
netsh advfirewall firewall delete rule name="OrquestadorWeb" >nul 2>&1
netsh advfirewall firewall add rule name="OrquestadorAPI" dir=in action=allow protocol=TCP localport=8080 >nul
netsh advfirewall firewall add rule name="OrquestadorWeb" dir=in action=allow protocol=TCP localport=3000 >nul

REM --- Arrancar serveis ---
echo.
echo Arrancant serveis...
net start OrquestadorAPI
net start OrquestadorWeb

REM --- Obtenir IP local (orientatiu -- si el PC te mes d'un adaptador de
REM     xarxa pot mostrar-ne una que no toca; comprova-ho amb "ipconfig") ---
set IP=
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /R /C:"IPv4"') do (
    if not defined IP set IP=%%i
)
set IP=%IP: =%

echo.
echo ============================================
echo   Instal.lacio completada correctament!
echo ============================================
echo.
echo   Portal web: http://%IP%:3000
echo   API:        http://%IP%:8080/health
echo.
echo   Guarda aquesta adreca per accedir al portal des de qualsevol PC del taller.
echo   Si l'IP no sembla correcta, comprova-ho amb "ipconfig".
echo ============================================
pause
