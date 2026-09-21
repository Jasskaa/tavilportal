@echo off
echo ============================================
echo   Actualitzant Orquestador 1076 - Tavil
echo ============================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Cal executar aquest script com a Administrador.
    pause
    exit /b 1
)

echo Aturant serveis...
net stop WebOrquestador1076
net stop Orquestador1076

echo.
echo Actualitzant dependencies del servidor...
cd /d "%~dp0Servidor"
python -m pip install -r requirements.txt --quiet

echo.
echo Recompilant l'app web...
cd /d "%~dp0Web"
call npm install
call npm run build

echo.
echo Arrancant serveis...
net start Orquestador1076
net start WebOrquestador1076

echo.
echo Actualitzat correctament!
pause
