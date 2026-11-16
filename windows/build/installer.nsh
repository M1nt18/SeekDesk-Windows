; electron-builder 26 assisted installer hooks. Keep the standard uninstaller's
; shortcut cleanup, but let the options page own shortcut creation on install.
!ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"
  !include "FileFunc.nsh"

  ; Treat the legacy /UPDATE switch exactly like electron-updater's --updated
  ; throughout builder's own license/directory/old-installation safeguards too.
  ; The standard uninstaller keeps builder's original flag implementation.
  !macro _seekDeskUpdated _a _b _t _f
    ClearErrors
    ${StdUtils.TestParameter} $R9 "updated"
    StrCmp "$R9" "true" `${_t}` 0
    ${GetParameters} $R9
    ClearErrors
    ${GetOptions} $R9 "/UPDATE" $R9
    IfErrors +3 0
    ClearErrors
    Goto `${_t}`
    ClearErrors
    Goto `${_f}`
  !macroend
  !undef isUpdated
  !define isUpdated `"" seekDeskUpdated ""`

  !define DO_NOT_CREATE_DESKTOP_SHORTCUT
  !define DO_NOT_CREATE_START_MENU_SHORTCUT

  Var seekDeskDesktopShortcut
  Var seekDeskStartMenuShortcut
  Var seekDeskDesktopCheckbox
  Var seekDeskStartMenuCheckbox
  Var seekDeskShortcutDialog
  Var seekDeskIsUpdate
  Var seekDeskInstallComplete

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
    LangString seekDeskUpdateTitle ${LANG_SIMPCHINESE} "正在安装更新"
    LangString seekDeskUpdateTitle ${LANG_ENGLISH} "Installing update"
    LangString seekDeskUpdateDescription ${LANG_SIMPCHINESE} "更新即将完成，应用将自动重启。请稍候…"
    LangString seekDeskUpdateDescription ${LANG_ENGLISH} "The application will restart when the update is complete. Please wait..."
  !macroend

  !macro SeekDeskSnapshotUpdateShortcuts
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
    ${if} ${isNoDesktopShortcut}
      StrCpy $seekDeskDesktopShortcut ${BST_UNCHECKED}
    ${endif}
  !macroend

  !macro customInit
    StrCpy $seekDeskDesktopShortcut ${BST_CHECKED}
    StrCpy $seekDeskStartMenuShortcut ${BST_CHECKED}
    StrCpy $seekDeskIsUpdate "false"
    StrCpy $seekDeskInstallComplete "false"

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
      !insertmacro SeekDeskSnapshotUpdateShortcuts
    ${endif}

    ${if} ${isNoDesktopShortcut}
      StrCpy $seekDeskDesktopShortcut ${BST_UNCHECKED}
    ${endif}
    ClearErrors
  !macroend

  ; The original mode page still performs UAC and restores the registered
  ; installation directory. Only a single detected scope is unambiguous. With
  ; both per-user and per-machine copies, retain builder's selection page so an
  ; update cannot silently replace the wrong copy based on the default mode.
  !macro customInstallMode
    ${if} $seekDeskIsUpdate == "true"
      ${if} $hasPerMachineInstallation == "1"
      ${andIf} $hasPerUserInstallation == "0"
        StrCpy $isForceMachineInstall "1"
      ${elseIf} $hasPerUserInstallation == "1"
      ${andIf} $hasPerMachineInstallation == "0"
        StrCpy $isForceCurrentInstall "1"
      ${endif}
    ${endif}
  !macroend

  ; This hook is inserted immediately after the directory page and before
  ; MUI_PAGE_INSTFILES in assistedInstaller.nsh.
  !macro customPageAfterChangeDir
    Page custom SeekDeskShortcutPageCreate SeekDeskShortcutPageLeave

    Function SeekDeskShortcutPageCreate
      ${if} $seekDeskIsUpdate == "true"
        ; An ambiguous two-copy install can change scope on the mode page.
        ; Snapshot the final scope before uninstallOldVersion removes its links.
        !insertmacro SeekDeskSnapshotUpdateShortcuts
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

    !ifdef MUI_PAGE_CUSTOMFUNCTION_SHOW
      !define SEEKDESK_ORIGINAL_INSTFILES_SHOW ${MUI_PAGE_CUSTOMFUNCTION_SHOW}
      !undef MUI_PAGE_CUSTOMFUNCTION_SHOW
    !endif
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW SeekDeskInstallFilesShow
    Function SeekDeskInstallFilesShow
      !ifdef SEEKDESK_ORIGINAL_INSTFILES_SHOW
        Call ${SEEKDESK_ORIGINAL_INSTFILES_SHOW}
      !endif
      ${if} $seekDeskIsUpdate == "true"
        ; This is the actual NSIS extraction/installation page, never a timer
        ; or an estimated progress value supplied by the old application.
        SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:$(seekDeskUpdateTitle)"
        !insertmacro MUI_HEADER_TEXT "$(seekDeskUpdateTitle)" "$(seekDeskUpdateDescription)"
        SetAutoClose true
      ${endif}
    FunctionEnd
  !macroend

  !macro customFinishPage
    Function SeekDeskStartApp
      ; Keep the same unelevated launch mechanism as builder's StartApp macro.
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    Function SeekDeskFinishPagePre
      ${if} $seekDeskIsUpdate == "true"
      ${andIf} $seekDeskInstallComplete == "true"
        ; Failed/aborted installs must retain their normal failure handling.
        IfAbort SeekDeskShowFinish
        IfRebootFlag SeekDeskShowFinish
        ${if} ${isForceRun}
          HideWindow
          Call SeekDeskStartApp
        ${endif}
        !insertmacro quitSuccess
      ${endif}
      SeekDeskShowFinish:
    FunctionEnd

    !ifndef HIDE_RUN_AFTER_FINISH
      !define MUI_FINISHPAGE_RUN
      !define MUI_FINISHPAGE_RUN_FUNCTION "SeekDeskStartApp"
    !endif
    !define MUI_PAGE_CUSTOMFUNCTION_PRE SeekDeskFinishPagePre
    !insertmacro MUI_PAGE_FINISH
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
    StrCpy $seekDeskInstallComplete "true"
  !macroend
!endif
