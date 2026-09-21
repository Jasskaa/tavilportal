@echo off
echo ============================================
echo   Desinstal.lador Orquestador 1076 - Tavil
echo ============================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Cal executar aquest script com a Administrador.
    pause
    exit /b 1
)

if not exist "%~dp0nssm.exe" (
    echo ERROR: nssm.exe no trobat a la carpeta del projecte.
    pause
    exit /b 1
)

echo Aturant i eliminant serveis...
"%~dp0nssm.exe" stop Orquestador1076 >nul 2>&1
"%~dp0nssm.exe" remove Orquestador1076 confirm >nul 2>&1
"%~dp0nssm.exe" stop WebOrquestador1076 >nul 2>&1
"%~dp0nssm.exe" remove WebOrquestador1076 confirm >nul 2>&1

echo Eliminant regles de firewall...
netsh advfirewall firewall delete rule name="Orquestador1076" >nul 2>&1
netsh advfirewall firewall delete rule name="WebOrquestador1076" >nul 2>&1

echo.
echo Desinstal.lat correctament.
echo.
echo NOTA: Aixo NOMES elimina els serveis. No esborra cap arxiu de la carpeta
echo del projecte ni les dades de C:\DXF TEMPORAL\MACROS (historial, logs...).
echo Esborra-ho manualment si vols eliminar-ho tot.
pause
