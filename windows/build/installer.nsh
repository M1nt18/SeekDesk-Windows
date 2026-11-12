; electron-builder 26 assisted installer hooks. Keep the standard uninstaller's
; shortcut cleanup, but let the options page own shortcut creation on install.
!ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"

  !define DO_NOT_CREATE_DESKTOP_SHORTCUT
  !define DO_NOT_CREATE_START_MENU_SHORTCUT

  Var seekDeskDesktopShortcut
  Var seekDeskStartMenuShortcut
  Var seekDeskDesktopCheckbox
  Var seekDeskStartMenuCheckbox
  Var seekDeskShortcutDialog
  Var seekDeskIsUpdate

  !macro customHeader
    LangString seekDeskShortcutTitle ${LANG_SIMPCHINESE} "快捷方式"
    LangString seekDeskShortcutTitle ${LANG_ENGLISH} "Shortcuts"
    LangString seekDeskShortcutDescription ${LANG_SIMPCHINESE} "选择安装后创建的快捷方式。"
    LangString seekDeskShortcutDescription ${LANG_ENGLISH} "Choose the shortcuts to create after installation."
    LangString seekDeskShortcutPrompt ${LANG_SIMPCHINESE} "安装 SeekDesk Windows 时："
    LangString seekDeskShortcutPrompt ${LANG_ENGLISH} "When installing SeekDesk Windows:"
    LangString seekDeskDesktopLabel ${LANG_SIMPCHINESE} "创建桌面快捷方式"
    LangString seekDeskDesktopLabel ${LANG_ENGLISH} "Create a desktop shortcut"
    LangString seekDeskStartMenuLabel ${LANG_SIMPCHINESE} "创建开始菜单快捷方式"
    LangString seekDeskStartMenuLabel ${LANG_ENGLISH} "Create a Start menu shortcut"
  !macroend

  !macro customInit
    StrCpy $seekDeskDesktopShortcut ${BST_CHECKED}
    StrCpy $seekDeskStartMenuShortcut ${BST_CHECKED}
    StrCpy $seekDeskIsUpdate "false"

    ; electron-builder uses --updated; SeekDesk's updater also uses /UPDATE.
    ${if} ${isUpdated}
      StrCpy $seekDeskIsUpdate "true"
    ${endif}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/UPDATE" $R1
    ${ifNot} ${Errors}
      StrCpy $seekDeskIsUpdate "true"
    ${endif}

    ${if} $seekDeskIsUpdate == "true"
      ; initMultiUser has already selected the existing installation's shell
      ; context. Snapshot before uninstallOldVersion can remove the old links.
      !insertmacro setLinkVars
      StrCpy $seekDeskDesktopShortcut ${BST_UNCHECKED}
      StrCpy $seekDeskStartMenuShortcut ${BST_UNCHECKED}
      ${if} ${FileExists} "$oldDesktopLink"
      ${orIf} ${FileExists} "$newDesktopLink"
        StrCpy $seekDeskDesktopShortcut ${BST_CHECKED}
      ${endif}
      ${if} ${FileExists} "$oldStartMenuLink"
      ${orIf} ${FileExists} "$newStartMenuLink"
        StrCpy $seekDeskStartMenuShortcut ${BST_CHECKED}
      ${endif}
    ${endif}

    ${if} ${isNoDesktopShortcut}
      StrCpy $seekDeskDesktopShortcut ${BST_UNCHECKED}
    ${endif}
    ClearErrors
  !macroend

  ; This hook is inserted immediately after the directory page and before
  ; MUI_PAGE_INSTFILES in assistedInstaller.nsh.
  !macro customPageAfterChangeDir
    Page custom SeekDeskShortcutPageCreate SeekDeskShortcutPageLeave

    Function SeekDeskShortcutPageCreate
      ${if} $seekDeskIsUpdate == "true"
        Abort
      ${endif}

      !insertmacro MUI_HEADER_TEXT "$(seekDeskShortcutTitle)" "$(seekDeskShortcutDescription)"
      nsDialogs::Create 1018
      Pop $seekDeskShortcutDialog
      ${if} $seekDeskShortcutDialog == error
        Abort
      ${endif}

      ${NSD_CreateLabel} 0 0 100% 24u "$(seekDeskShortcutPrompt)"
      Pop $R0
      ${NSD_CreateCheckbox} 0 32u 100% 12u "$(seekDeskDesktopLabel)"
      Pop $seekDeskDesktopCheckbox
      ${NSD_SetState} $seekDeskDesktopCheckbox $seekDeskDesktopShortcut
      ${NSD_CreateCheckbox} 0 54u 100% 12u "$(seekDeskStartMenuLabel)"
      Pop $seekDeskStartMenuCheckbox
      ${NSD_SetState} $seekDeskStartMenuCheckbox $seekDeskStartMenuShortcut
      nsDialogs::Show
    FunctionEnd

    Function SeekDeskShortcutPageLeave
      ${NSD_GetState} $seekDeskDesktopCheckbox $seekDeskDesktopShortcut
      ${NSD_GetState} $seekDeskStartMenuCheckbox $seekDeskStartMenuShortcut
    FunctionEnd
  !macroend

  ; customInstall runs after files and install metadata have been written.
  ; Explicit creation repairs missing links on reinstall even when the old
  ; installation's KeepShortcuts metadata would otherwise suppress creation.
  !macro customInstall
    ${if} $seekDeskStartMenuShortcut == ${BST_CHECKED}
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      ${if} $oldStartMenuLink != $newStartMenuLink
        WinShell::UninstShortcut "$oldStartMenuLink"
        Delete "$oldStartMenuLink"
        !insertmacro cleanupOldMenuDirectory
      ${endif}
      StrCpy $launchLink "$newStartMenuLink"
    ${endif}

    ${if} $seekDeskDesktopShortcut == ${BST_CHECKED}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${if} $oldDesktopLink != $newDesktopLink
        WinShell::UninstShortcut "$oldDesktopLink"
        Delete "$oldDesktopLink"
      ${endif}
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endif}
  !macroend
!endif
