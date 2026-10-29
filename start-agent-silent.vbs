Option Explicit
Dim fso, sh, root, http, running
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
running = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://127.0.0.1:4780/api/health", False
http.Send
If Err.Number = 0 Then
  If http.Status = 200 Then running = True
End If
Err.Clear
On Error GoTo 0
If Not running Then
  sh.Run "cmd /c set ""NO_OPEN=1"" && node server.js >> data\server.log 2>&1", 0, False
End If
