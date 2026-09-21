ORQUESTADOR 1076 - TAVIL
========================

QUE ES AIXO
-----------
Portal intern per gestionar les peces de xapa metal.lica del client Tavil
(codi 1076): buscador de peces, descarrega automatica/manual de comandes,
comparador de planols entre revisions, i anul.lador de planols/geos/programes
TruBend obsolets.

Te dues parts:
  - Servidor/  -> API en Python (FastAPI), porta 8080
  - Web/       -> Portal web en React, porta 3000

Les dues corren com a serveis de Windows (via NSSM), s'arranquen soles amb
l'ordinador.

REQUISITS PREVIS
-----------------
1. Python 3.10 o superior -> https://python.org
   IMPORTANT: marca la casella "Add python.exe to PATH" durant la instal.lacio.
2. Node.js LTS -> https://nodejs.org
3. nssm.exe (versio win64) -> https://nssm.cc/download
   Descomprimeix-lo i posa "nssm.exe" (el de la carpeta win64) a l'arrel
   d'aquesta carpeta, al costat d'INSTALAR.bat.
4. Aquest PC ha de tenir acces de xarxa a \\SRVDADES i \\TRUMPFSRV (el
   servidor fa servir sempre rutes de xarxa completes, mai lletres d'unitat
   com P:\ o M:\, aixi que no cal mapejar cap unitat -- nomes que la xarxa
   arribi a aquests dos servidors, com passa a qualsevol PC del taller).
5. SumatraPDF (nomes si aquest PC ha d'imprimir documents) -> instal.la'l
   amb l'opcio "nomes per al meu usuari" perque quedi a la carpeta
   LOCALAPPDATA de l'usuari -- es on el servidor el busca automaticament.

INSTAL.LACIO (primera vegada)
-------------------------------
1. Fes clic dret a INSTALAR.bat -> "Executar com administrador"
   (cal per crear els serveis de Windows i les regles de firewall).
2. La primera vegada et dira que falta Servidor\.env i s'aturara despres
   de crear-lo buit a partir de la plantilla -- obre'l amb el Bloc de
   notes i omple-hi el correu i la contrasenya del portal SharePoint de
   Tavil (PORTAL_USUARIO / PORTAL_CONTRASENYA). Despres, torna a executar
   INSTALAR.bat.
3. Espera que acabi (5-10 minuts la primera vegada -- instal.la dependencies
   de Python, el navegador Chromium per a Playwright, i compila l'app web).
4. Al final et mostrara l'adreca del portal, per exemple:
     Portal web: http://192.168.0.45:3000
   Apunta-la -- es la que fara servir tothom al taller per accedir-hi.
5. Obre aquesta adreca al navegador des de qualsevol PC de la mateixa xarxa.
6. Ves a l'engranatge (Ajustos) -> Impressora, i tria la impressora
   d'aquest PC de la llista -- es guarda al navegador, no cal fer-ho des
   del codi.

NOTA IMPORTANT sobre l'usuari del servei (nomes si cal imprimir):
Si has instal.lat SumatraPDF per al teu usuari normal (no per a tots els
usuaris), el servei "Orquestador1076" -- que per defecte corre com a
LocalSystem -- no el trobara ni tindra acces als controladors d'impressora
del teu usuari. Si la impressio no funciona, obre services.msc -> propietats
del servei "Orquestador1076" -> pestanya "Inicia sessio" -> "Aquest compte" ->
posa el teu usuari i contrasenya de Windows, i reinicia el servei.

Si instal.les en un PC que ja tenia una versio anterior corrent amb altres
noms de servei, desinstal.la primer l'antiga (o para'ls manualment des de
services.msc) per evitar que dos serveis intentin fer servir el mateix port.

CONFIGURACIO DE LA IMPRESSORA
-------------------------------
1. Obre el portal -> icona de l'engranatge (Ajustos)
2. Selecciona la impressora del PC servidor a la llista
3. Tria si el flux automatic (correu) ha d'imprimir els documents o deixar-
   los preparats per descarregar
4. "Desar"

MACRO VBA (Outlook) -- deteccio automatica de correus
-------------------------------------------------------
Nomes cal en UN PC: el que tingui Outlook obert i rebi els correus de Tavil
(compresmec@tavil.net i similars). El servidor NO necessita Outlook.

1. Obre Outlook al PC que rebra els correus -> Alt+F11 (editor VBA)
2. Al panell esquerre, doble clic a "ThisOutlookSession"
3. Esborra el que hi hagi i enganxa tot el contingut de
   Servidor\macro_outlook.vba
4. Ctrl+S per desar
5. Si Outlook et demana pujar el nivell de seguretat de macros
   (Fitxer -> Opcions -> Centre de confiança -> Configuracio del Centre de
   confiança -> Configuracio de macros), tria "Notificacio per a totes les
   macros" i accepta l'avis en obrir Outlook.
6. Revisa la llista de remitents autoritzats a dalt de l'arxiu .vba abans
   d'enganxar-lo -- edita-la si cal abans del pas 4.

Si Outlook i el servidor estan en PCs diferents, canvia dins del .vba:
  Const SERVIDOR As String = "http://IP_DEL_SERVIDOR:8080"

ENTORN DE PROVES (sense esperar un correu real)
--------------------------------------------------
Al portal -> Descarrega de comandes -> "Entorn de proves": simula la
recepcio d'un correu (numero de comanda + PDF opcional) i mostra en directe,
pas a pas, tot el que fa el servidor -- util per verificar que tot funciona
sense haver d'esperar que arribi un correu de veritat.

ACTUALITZAR EL SISTEMA
------------------------
Quan hi hagi canvis nous al codi (copia'ls a les carpetes Servidor/ i Web/
d'aquest paquet primer):
1. Fes clic dret a ACTUALITZAR.bat -> "Executar com administrador"
   (para els serveis, actualitza dependencies, recompila la web, els torna
   a arrancar)

DESINSTAL.LAR
--------------
Fes clic dret a DESINSTALAR.bat -> "Executar com administrador".
Aixo nomes elimina els serveis de Windows i les regles de firewall -- no
esborra cap arxiu ni les dades de \\SRVDADES\dades domoli\Portal Tavil
(historial de peces, index de cerca, logs...), que es comparteixen amb la
resta d'instal.lacions. Esborra-ho manualment si vols eliminar-ho tot.

SI HI HA PROBLEMES
--------------------
- Logs del servidor API:  \\SRVDADES\dades domoli\Portal Tavil\logs\servidor_log.txt
                           \\SRVDADES\dades domoli\Portal Tavil\logs\servidor_error.txt
                           \\SRVDADES\dades domoli\Portal Tavil\logs\servidor.log
- Logs del servidor web:  \\SRVDADES\dades domoli\Portal Tavil\logs\web_servidor_log.txt
                          \\SRVDADES\dades domoli\Portal Tavil\logs\web_servidor_error.txt
- Comprova que els serveis corren: obre services.msc i busca
  "Orquestador1076" i "WebOrquestador1076" (han d'estar "En execucio").
- Comprova que el port no esta ocupat per una altra cosa:
    netstat -ano | findstr :8080
    netstat -ano | findstr :3000
- Si canvies alguna cosa manualment al codi sense fer servir
  ACTUALITZAR.bat, cal reiniciar els serveis perque s'apliqui:
    net stop Orquestador1076  &  net start Orquestador1076
    net stop WebOrquestador1076  &  net start WebOrquestador1076
- Panell "Entorn de proves" (Descarrega de comandes): ensenya en directe
  cada pas del proces -- el primer lloc on mirar si una comanda no es
  processa be.
