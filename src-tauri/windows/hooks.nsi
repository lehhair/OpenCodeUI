; OpenCodeUI - NSIS Installer Hooks
; 安装时注册 Windows 资源管理器右键菜单，卸载时清理

!macro NSIS_HOOK_POSTINSTALL
  ; 右键文件夹 → "Open with OpenCode"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenCodeUI" "" "Open with OpenCode"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenCodeUI" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenCodeUI\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'

  ; 右键文件夹空白处 → "Open with OpenCode"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenCodeUI" "" "Open with OpenCode"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenCodeUI" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenCodeUI\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenCodeUI"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenCodeUI"
!macroend
