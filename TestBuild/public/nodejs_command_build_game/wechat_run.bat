@echo off
cd /d "D:\cocosProject\public\nodejs_command_build_game"

set /p environment=Enter environment:
set /p version=Enter version:

npm run wechat_build environment=%environment% version=%version%

pause