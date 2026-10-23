# 销售素材模块：主候选可调用登记

此目录是主系统候选的实物入口。它引用独立项目 D:/Codex/xjy-sales-materials-20261023 的 createApplication，不复制源码、依赖或图库数据。尚未注册正式主系统 HTTP/员工权限，也不是安装包或上线完成。

## 文件与运行

- registry.json：模块 ID、入口、固定 127.0.0.1:21963、独立素材 runtime/data 与 local-candidate 权限边界。
- entry.mjs：实际导入独立 server.mjs 并调用 createApplication。拒绝地址、端口、源目录、数据目录或权限字段漂移；不接受 CLI 覆盖。返回地址必须与登记相同，否则关闭刚创建的候选并失败。
- Start-SalesMaterials.ps1：只用已存在 D 盘 Node 24.22.1；健康端口可复用，其他占用失败停止；隐藏启动 Node，日志和临时目录在本目录 runtime，恢复调用者 TEMP/TMP；不杀进程。可加 -Open 打开浏览器，默认不打开。
- freeze-manifest.mjs：审查完毕后 --write 创建 source-manifest.json，若已存在拒绝覆盖；--verify 校验全部 14 个白名单源文件。入口和启动器发现 manifest 时强制校验，缺失源码/摘要漂移均失败，不绕过。冻结前允许启动，但日志明确未冻结。

示例（由 Root 在合适时运行，本子任务未执行启动）：

```powershell
& 'D:/Codex/xjy-agent-sales-media/openclaw-isolated/runtime/node-v24.22.1-win-x64/node.exe' 'D:/Codex/xjy-main-integration-20261023/sales-materials-integration/freeze-manifest.mjs' --write
& 'D:/Codex/xjy-main-integration-20261023/sales-materials-integration/Start-SalesMaterials.ps1' -Open
```

冻结清单只包含入口4文件及独立软件10文件（server、3个lib、vendor状态机、3个public、package/lock）。不读取或打包运行图片、数据库、csrf/token、日志、node_modules、模型。清单不等于依赖完整性证明，也不替代安全扫描或独立审查；更新被列源文件后应由 Root 复查后明确更新冻结记录，不自动重签。

## 实际验证

使用 D 盘 Node 执行 tests/entry.test.mjs：7 通过，0 失败，0 跳过。仅 stub createApplication，没有开端口、启动真实服务、停止进程或改数据。验证固定入口、危险配置前置拒绝、实际调用参数、不符 origin 关闭新对象、无导出拒绝、源码摘要白名单。PowerShell AST 语法解析通过。证据 evidence/entry-test.log。

本轮未生成 source-manifest.json（独立软件仍在联调/审查）；Root 在最终审查后生成冻结并真实启动验收。DeepSeek 由 Root 统一提交；本项当前待独立审查，不能引用别的补丁审查冒称通过。

没有修改既有权限 UI overlay、独立素材源码、正式软件或升级源。独立素材库当前是本机操作者候选权限，正式接入必须走既有模块授权链。

补充复查差异：运行源码后来接入了 vendor/intake-state/intake-state.mjs，首次清单遗漏此依赖。新增静态本地导入图检查，从 server.mjs 递归读取相对路径的静态 import/export 与字面量 dynamic import（不执行被读代码），先实际得到6通过1失败，明确指向遗漏状态机；补入清单后7通过0失败。日志 evidence/import-graph-red.log 与 import-graph-green.log 均保留。检查不解析运行时计算出的任意 import 字符串，不冒称通用 JavaScript 依赖解析器。

清单白名单现在为14项；此轮仅修清单、测试及本交接，不改状态机或其他素材源，不生成 source-manifest.json。代码到此停止修改，等待 Root 统一复查与冻结摘要。
