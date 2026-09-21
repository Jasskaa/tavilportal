' ============================================================
' CONFIGURACIO -- modifica nomes aquestes linies si cal
' ============================================================
' Adreca del servidor Orquestador (API, port 8080). Com que la macro corre
' al mateix PC que el servidor (Outlook nomes cal en un PC concret, el
' servidor no necessita Outlook), 127.0.0.1 funciona sempre; nomes cal
' canviar-ho si algun dia Outlook i el servidor van en PCs diferents.
Const SERVIDOR As String = "http://127.0.0.1:8080"

' Carpeta on es guarden temporalment els PDF adjunts dels correus, abans que
' el servidor els reculli. Ha de coincidir EXACTAMENT amb el que fa servir
' main.py (RUTA_TEMP_PDF) -- viu a \\SRVDADES perque es comparteix entre
' totes les instal.lacions (veure CARPETA_PORTAL_TAVIL a main.py).
Const RUTA_TEMP_PDF As String = "\\SRVDADES\dades domoli\Portal Tavil\temp_pdf\"

' Arxiu on es deixa constancia de l'assumpte de cada correu detectat (backup
' -- el servidor tambe el rep directament via POST /auto-descargar, aixo
' nomes serveix per si calgues reprocessar-ho amb el polling de l'EWS).
Const RUTA_TXT As String = "\\SRVDADES\dades domoli\Portal Tavil\inbox_tavil.txt"

' Remitents autoritzats -- nomes es processen correus d'aquestes adreces.
' Per afegir-ne un de nou, augmenta l'index superior de l'array (ara 0 a 3,
' 4 remitents) i afegeix la linia remitentes(4) = "...".
Dim remitentes(3) As String
' ============================================================

Private Sub Application_NewMailEx(ByVal EntryIDCollection As String)
    Dim IDs() As String
    IDs = Split(EntryIDCollection, ",")
    Dim i As Integer
    For i = 0 To UBound(IDs)
        Dim Item As Object
        On Error Resume Next
        Set Item = Application.Session.GetItemFromID(Trim(IDs(i)))
        On Error GoTo 0
        If Not Item Is Nothing Then
            If TypeOf Item Is Outlook.MailItem Then
                ProcesarEmail Item
            End If
        End If
    Next i
End Sub

Private Sub ProcesarEmail(mail As Outlook.MailItem)
    remitentes(0) = "compresmec@tavil.net"
    remitentes(1) = "ot@domoli.com"
    remitentes(2) = "ot2@domoli.com"
    remitentes(3) = "jaskaranmr18@gmail.com"

    Dim emailRemitente As String
    emailRemitente = ""
    On Error Resume Next
    If mail.SenderEmailType = "EX" Then
        emailRemitente = mail.Sender.GetExchangeUser().PrimarySmtpAddress
    Else
        emailRemitente = mail.SenderEmailAddress
    End If
    On Error GoTo 0
    If emailRemitente = "" Then emailRemitente = mail.SenderEmailAddress
    emailRemitente = LCase(Trim(emailRemitente))

    Dim i As Integer
    Dim esValido As Boolean
    esValido = False
    For i = 0 To UBound(remitentes)
        If remitentes(i) <> "" And emailRemitente = LCase(remitentes(i)) Then
            esValido = True
            Exit For
        End If
    Next i

    If Not esValido Then Exit Sub

    Dim asunto As String
    asunto = mail.Subject

    Dim codigo As String
    codigo = ""
    Dim j As Integer
    For j = 1 To Len(asunto) - 9
        Dim trozo As String
        trozo = Mid(asunto, j, 10)
        If trozo Like "##########" Then
            codigo = trozo
            Exit For
        End If
    Next j

    If codigo = "" Then Exit Sub

    Dim fileNum As Integer
    fileNum = FreeFile
    Open RUTA_TXT For Append As #fileNum
        Print #fileNum, asunto
    Close #fileNum

    Dim rutaPDF As String
    rutaPDF = ""

    If mail.Attachments.Count > 0 Then
        If Dir(RUTA_TEMP_PDF, vbDirectory) = "" Then
            MkDir RUTA_TEMP_PDF
        End If
        Dim att As Outlook.Attachment
        For Each att In mail.Attachments
            If LCase(Right(att.FileName, 4)) = ".pdf" Then
                rutaPDF = RUTA_TEMP_PDF & att.FileName
                att.SaveAsFile rutaPDF
                Exit For
            End If
        Next att
    End If

    On Error Resume Next
    Dim http As Object
    Set http = CreateObject("MSXML2.XMLHTTP")
    Dim body As String
    body = "{""comanda"":""" & codigo & """,""pdf_correo"":""" & Replace(rutaPDF, "\", "\\") & """}"
    http.Open "POST", SERVIDOR & "/auto-descargar", False
    http.setRequestHeader "Content-Type", "application/json"
    http.Send body
    On Error GoTo 0
End Sub
