# 新手功能导览

首次访问在空闲时显示五步气泡引导：自然语言修改作品、作品修改记录与撤回、章节蓝图、剧情试演、模型准备。顶部「功能导览」可以随时重开；跳过或完成后，本机记住选择。正在写作或打开全局对话框时不抢占操作。

气泡跟随可见功能入口；未打开项目、面板隐藏或窗口较窄时使用相关入口或居中展示，并明确说明真实操作路径。引导不会切换编辑页、替换输入框、发送模型请求或修改作品。示例仅在用户点击后复制；最后可进入模型设置。

键盘 Tab 保持在引导内，Escape 可退出，退出后焦点返回顶部入口。支持明暗主题、中英俄文、窗口缩放和缺失目标；页面存储不可用时仍可正常退出。

UI 回归：

```powershell
node node_modules/vite/bin/vite.js --config tests/rehearsal/vite.config.mjs --port 5199
# 另开一个终端：
$env:VELA_TEST_URL='http://127.0.0.1:5199/tests/onboarding/index.html'
$env:VELA_BROWSER_CHANNEL='msedge' # 也可使用已安装的 chrome，或安装 Playwright 自带 Chromium 后省略
node tests/onboarding/ui-check.cjs
```

测试页面只在测试配置下使用，不包含在桌面应用入口中。截图和结果写入 `.test-output/onboarding/`。
