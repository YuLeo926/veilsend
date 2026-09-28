# VeilSend 试用、安装与卸载

当前版本是 **0.2.0-beta.1，未签名的实验版**。先用假数据试用，不要直接拿重要客户文件做第一次测试。它不是“保证不泄露”或合规认证产品。

## 下载与安装

1. 打开[官方发布页](https://github.com/YuLeo926/veilsend/releases/tag/v0.2.0-beta.1)，展开 Assets。
2. Windows x64 用户下载 `VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe`，以及同一页的 `SHA256SUMS.txt`。不要下载 Source code 当作安装包。
3. 按[发布校验说明](release.md#verify-the-draft-before-installation)检查文件哈希和构建来源后，再决定是否运行。未知发布者或 SmartScreen 提示不能证明文件真假；不要关闭 Windows 安全保护。如果无法确认来源，先不要安装。
4. 安装到当前用户，记下安装界面显示的目录。缺少 Microsoft WebView2 时，安装过程可能需要联网下载它。
5. 从 Windows 开始菜单搜索 **VeilSend** 并打开。没有结果时，查看刚才记下的安装目录。

支持目标是 Windows 10/11 x64；干净电脑兼容性仍未完成验证。便携 ZIP 需要先完整解压，也需要 WebView2。2026-09-28 已在开发电脑完成便携版的假数据文本试用、保存与文件复查；便携版图片/PDF、断网及全新电脑运行仍未验证。见[补充测试记录](releases/2026-09-28-portable-text-smoke.md)。

## 五分钟试用

1. 在文本模式点击 **Try safe sample**，载入内置假数据。
2. 点击 **Scan locally**，查看拟替换项。
3. 第一次保持默认选择，点击 **Clean & verify**。
4. 点击 **Save clean copy**，保存到自己的文档目录，**不要保存在软件安装目录里**。
5. 打开保存后的文件，检查替换结果和保存结果的检查记录。有 **Needs review**、检测器不可用或异常时，不要直接分享。

“Verified”只表示已支持的检查完成，不代表所有敏感信息都能识别。图片和 PDF 也要人工查看每一处。PDF 输出为图像式文档，会失去文字搜索、选择、表单、签名等功能。

可继续用[仓库中的合成样例](https://github.com/YuLeo926/veilsend/tree/master/fixtures)试用图片和 PDF，不要上传或提交真实文件。

## 卸载在哪里

1. 保存需要的结果并退出 VeilSend。重要结果先备份，放在软件目录之外；当前版本的“卸载保留输出”尚未完成验证。
2. **Windows 11：设置 → 应用 → 安装的应用**。**Windows 10：设置 → 应用 → 应用和功能**。搜索 VeilSend，选择卸载。
3. 找不到时，按 **Win + R**，输入 `appwiz.cpl`，在传统程序列表找 VeilSend。
4. 两处都没有时，从开始菜单的 VeilSend 快捷方式右键选择“打开文件所在位置”，再查看快捷方式的“属性 → 目标”。该目标指向实际程序，所在目录里的 `uninstall.exe` 是卸载入口。
5. 仍然找不到时，可以在项目里运行只读定位工具 `scripts/find-installation.ps1`。它只列出注册表登记的路径及当前运行程序的位置，不执行卸载、不修改系统、不搜索个人文件。**输出含本机路径，只在自己电脑查看，不要原样发到公开反馈。**

安装目录可能受用户选择或启动安装器的应用影响，不能把某次测试电脑的目录当成每个人都相同的目录。不要靠猜路径直接删除文件夹。

只使用便携 ZIP 的情况没有系统卸载项：先退出程序，确认输出保存在其他目录，再自行移除解压目录。

## 怎么反馈

- [试用反馈](https://github.com/YuLeo926/veilsend/issues/new?template=trial-feedback.yml)：任务多久发生一次、以前怎么处理、哪一步有帮助、最需要改进什么。
- [故障反馈](https://github.com/YuLeo926/veilsend/issues/new?template=bug.yml)：仅提供版本、步骤、简短错误码和检测器状态。
- [安全问题私下报告](https://github.com/YuLeo926/veilsend/security/advisories/new)：不要在公开 issue 发布漏洞，也不要提交真实密钥。

GitHub 反馈需要账号，普通 issue **公开可见**。不要附真实日志、文件、客户信息、本地路径、二维码内容或含私人信息的截图。

[官网与真实桌面截图](https://yuleo926.github.io/veilsend/) · [英文试用指南](https://yuleo926.github.io/veilsend/guide.html)
