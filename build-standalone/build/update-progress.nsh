; The install page says what the installer is doing, in order, and its bar
; moves for real: the unpack (the long part) reports progress through the
; 7z plugin, so the bar is never a marquee pretending. The phases that
; cannot report (closing the app, removing the previous version's files,
; the copy into place, registration) are named on the status line with how
; long they take. Updates keep the auto-close and the verified relaunch;
; fresh installs keep the ordinary flow.
!macro customHeader
  ShowInstDetails nevershow
!macroend

; Control 1006 is the status line above the bar on the install page.
!macro IronleafStatus TEXT
  Push $R9
  Push $R8
  FindWindow $R9 "#32770" "" $HWNDPARENT
  GetDlgItem $R8 $R9 1006
  SendMessage $R8 ${WM_SETTEXT} 0 "STR:${TEXT}"
  Pop $R8
  Pop $R9
!macroend

; The rename (NeuralVault -> Ironleaf, 20 Nov 2026). The installer id (guid) and app id are unchanged, so an
; install over NeuralVault finds its folder in the registry and installs there (electron-builder's own way: the
; folder keeps its old name, e.g. Programs\NeuralVault, and now holds Ironleaf.exe). Such an install is marked
; (LegacyExe) because earlier versions' in-app updater, taskbar pins and the like start NeuralVault.exe: that name
; is kept as a hard link to Ironleaf.exe (no extra disk), which hands over to Ironleaf.exe at once (src/main/index.ts).
; Read here, before the old version's uninstaller removes the registry key.
!ifndef BUILD_UNINSTALLER
  Var ironleafLegacy
!endif

!macro customInit
  ${If} ${isUpdated}
    SetAutoClose true
  ${EndIf}
  StrCpy $ironleafLegacy "0"
  ReadRegStr $0 HKCU "Software\${APP_GUID}" LegacyExe
  ReadRegStr $1 HKLM "Software\${APP_GUID}" LegacyExe
  ReadRegStr $2 HKCU "Software\${APP_GUID}" ShortcutName
  ReadRegStr $3 HKLM "Software\${APP_GUID}" ShortcutName
  ${If} $0 == "1"
  ${OrIf} $1 == "1"
  ${OrIf} $2 == "NeuralVault"
  ${OrIf} $3 == "NeuralVault"
    StrCpy $ironleafLegacy "1"
  ${EndIf}
!macroend

!macro customInstallMode
  ${If} ${isUpdated}
    ${If} $installMode == "all"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  ${EndIf}
!macroend

; Install page shown: the first phases (closing Ironleaf, removing the
; previous version's files) run before anything can move the bar.
!macro customPageAfterChangeDir
  Function IronleafInstFilesShow
    FindWindow $0 "#32770" "" $HWNDPARENT
    GetDlgItem $1 $0 1016
    ShowWindow $1 ${SW_HIDE}
    GetDlgItem $1 $0 1027
    ShowWindow $1 ${SW_HIDE}
    ; electron-builder adds "\Ironleaf" to a folder whose path lacks that name; for the folder of an install from
    ; before the rename (Programs\NeuralVault) that would put a second copy inside the first, so it is taken off.
    ReadRegStr $2 SHELL_CONTEXT "Software\${APP_GUID}" InstallLocation
    ${If} $2 != ""
    ${AndIf} $INSTDIR == "$2\${APP_FILENAME}"
      StrCpy $INSTDIR $2
    ${EndIf}
    ${If} ${isUpdated}
      !insertmacro IronleafStatus "Step 1 of 4 — Closing Ironleaf and removing the previous version's files. The bar starts moving when unpacking begins."
    ${Else}
      !insertmacro IronleafStatus "Step 1 of 3 — Getting ready to install Ironleaf ${VERSION}."
    ${EndIf}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW IronleafInstFilesShow
!macroend

; Previous version removed (or not found): the unpack is next and drives the
; bar; the copy into place that follows it cannot, so the line says so.
!macro customUnInstallCheck
  IfErrors 0 +2
    DetailPrint "Some of the previous version's files could not be removed; the update continues over them."
  ${If} ${isUpdated}
    !insertmacro IronleafStatus "Step 2 of 4 — Unpacking Ironleaf ${VERSION}. The bar shows this step."
  ${Else}
    !insertmacro IronleafStatus "Step 2 of 3 — Unpacking Ironleaf ${VERSION}. The bar shows this step."
  ${EndIf}
!macroend

; Files are in place: registration and shortcuts are quick.
!macro customFiles_x64
  ${If} ${isUpdated}
    !insertmacro IronleafStatus "Step 3 of 4 — Files are in place. Registering Ironleaf ${VERSION} and its shortcuts."
  ${Else}
    !insertmacro IronleafStatus "Step 3 of 3 — Files are in place. Registering Ironleaf ${VERSION} and its shortcuts."
  ${EndIf}
!macroend

!macro customInstall
  ; An install over NeuralVault: its NeuralVault.exe stays, as a hard link to Ironleaf.exe (a copy where the disk
  ; can't link), and the old Start menu and desktop shortcuts go (the old uninstaller may not have run: the in-app
  ; update moves the old folder aside first), so there is one app with one set of shortcuts.
  ${If} $ironleafLegacy == "1"
    Delete "$INSTDIR\NeuralVault.exe"
    System::Call 'kernel32::CreateHardLinkW(w "$INSTDIR\NeuralVault.exe", w "$INSTDIR\${APP_EXECUTABLE_FILENAME}", p 0) i .r0'
    ${If} $0 == 0
      CopyFiles /SILENT "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\NeuralVault.exe"
    ${EndIf}
    WriteRegStr SHELL_CONTEXT "Software\${APP_GUID}" LegacyExe "1"
    ${If} $oldStartMenuLink != $newStartMenuLink
      WinShell::UninstShortcut "$oldStartMenuLink"
      Delete "$oldStartMenuLink"
    ${EndIf}
    ${If} $oldDesktopLink != $newDesktopLink
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${EndIf}
    Delete "$SMPROGRAMS\NeuralVault.lnk"
  ${EndIf}
  ${If} ${isUpdated}
    !insertmacro IronleafStatus "Step 4 of 4 — Done. Ironleaf ${VERSION} reopens in a moment."
  ${EndIf}
!macroend

!macro customFinishPage
  Function IronleafFinishPre
    ${If} ${isUpdated}
      Abort
    ${EndIf}
  FunctionEnd
  Function IronleafStartFreshInstall
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE IronleafFinishPre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION IronleafStartFreshInstall
  !insertmacro MUI_PAGE_FINISH
!macroend

; The Ironleaf Terms page (3.1 L13; prepare-windows adds it only once the Terms are live): its heading and the line
; above the box. The macro runs just before electron-builder inserts the licence page, which updates skip.
!macro customWelcomePage
  !ifmacrodef licensePage
    !define MUI_PAGE_HEADER_TEXT "Ironleaf Terms"
    !define MUI_PAGE_HEADER_SUBTEXT "Kaitiaki IT Pty Ltd"
    !define MUI_LICENSEPAGE_TEXT_TOP "Please read the Ironleaf Terms. You need to accept them to install Ironleaf."
  !endif
!macroend

; Uninstalling (never an update's removal of the previous version): File Explorer's "Ask Ironleaf about this"
; entries that earlier versions wrote for this Windows user go with it.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\*\shell\NeuralVault.AskAbout"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\NeuralVault.AskAbout"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NeuralVault.AskAbout"
  ${EndIf}
!macroend
