# 1.7.0 源码同步检查记录

日期：2026-10-23。用户明确选择上传当前 1.7.0 完整源码。本次保存全部已获得的可编辑维护源码和相关工程工具，不发布安装包，不外推完整软件验收。源目录中的未提交成果保持原样；整理、检查和发布工作在 D 盘独立副本完成。

## 实际执行

| 检查 | 结果与边界 |
| --- | --- |
| 原维护源码保全 | 首轮选择的 1,558 个源码文件与导入快照 SHA256 零差异；截断草稿仅发布路径改为文本归档，原字节相同 |
| JavaScript/CJS/MJS | 813 个文件 `node --check` 通过；只解析，不加载产品模块 |
| Python | 510 个文件用既有 Python 的 `ast.parse` 通过；不 import、不生成 pyc |
| TypeScript/TSX | 138 个文件用既有 TypeScript `createSourceFile` 的 parseDiagnostics 检查，零语法错误；不是类型/依赖或运行验证 |
| PowerShell | 46 个 PS1 通过既有 PowerShell Parser 解析；未执行脚本；不等于 Win10/PS5.1 运行验收 |
| JSON | 首轮 10 个配置/包清单可解析；后生成的 SOURCE_INDEX 另经实际解析及逐条核对 |
| Git 实际对象 | 使用 `git write-tree` / `git ls-tree -rz` / `git cat-file --batch`，从实际暂存 blob 原样导出；检查普通 blob 模式、禁止类型、SQLite/EXE/ZIP/LFS 内容头及索引 SHA |
| 索引覆盖 | SOURCE_INDEX 覆盖本次 `source-1.7.0/` 内容及 `.gitattributes`，排除索引自身以避免循环；全仓旧文件不重复列入该新源码索引，但整个最终 Git tree 都执行内容扫描 |
| 原仓库工具例外 | 原 main 已跟踪的 `mobile/android/gradle/wrapper/gradle-wrapper.jar` 保留；固定路径且内容 SHA 与原 HEAD blob 一致，不是新增发行包 |
| 密钥检查 | Gitleaks **8.30.1** 原默认规则对全部实际 Git blob 扫描；原始 20 条 generic-api-key 命中逐条读上下文，属于文件摘要、公钥 SPKI 指纹、占位符、界面存储键和合成测试常量。原报告及精确处置保存在本机；使用这些已审指纹作 baseline 的后续复扫为零未审命中，没有通配忽略目录或降低熵阈值 |
| 补充检查 | 不依赖熵的凭据赋值检查 100 个候选均为合成测试/占位/代码片段；50 个长数字、手机号、私钥头候选按上下文核实为 FILETIME/文件身份/精度边界/合成测试字符串等，未发现实际业务账户或凭据 |
| 图片 | 商品示意图、图标、空白打印底纸与未填写质保模板经目视；没有上传业务截图/客户票据 |
| 格式 | 本次新写说明、Git 属性和忽略规则通过 `git diff --cached --check`；原样导入文件已有的尾空格/结尾空行警告保留，未篡改冻结源码字节，未宣称全量格式通过 |

`checkout-index` 和初次 `git archive` 导出会受 Windows 行尾转换影响，曾导致 `.gitattributes` 与索引摘要不同；系统 tar 还遇到中文路径问题。失败输出保留，最终改为直接读取 Git blob，不改索引断言、不替换中文字符、不重写原源码。最终 SHA 检查基于这种原 blob 导出方式。

## sequence 34 源码来源

`source-1.7.0/release34-runtime-source/` 位于 `source-1.7.0` 内，受 `/source-1.7.0/** -text whitespace=cr-at-eol` 覆盖；`git check-attr` 对该目录 main.cjs 和安装 PS1 均确认 `text: unset`，保持原字节。该运行源码目录全部 87 个成员进入 SOURCE_INDEX 和全 tree 扫描。

原 ASAR SHA256 为 `2ea40525ef41a01e4cc456f2717b762017328a10c0403e749ceebaa54ea0983d`。只读解析 ASAR header/files，拒绝链接及 unpacked 成员，只取 CJS/MJS/JS 和 package.json，排除 generated、renderer-dist、web-runtime。只读提取结果与维护源码分目录保存；它不替代维护源，也不声称覆盖包内全部生成资源。安装和审批的可编辑脚本另存 `release34-install-source/`。目录范围与缺失原始源码详见 KNOWN_LIMITATIONS。

## DeepSeek 独立审查

已实际通过内置浏览器提交源码同步范围、检查方法、真实结果、ASAR 提取核心代码、失败证据和修正说明，收到首轮回复及复查回复。[本项审查会话](https://chat.deepseek.com/a/chat/s/3b958c68-e4b3-450e-86db-bc3d00441141)。DeepSeek 评估的是所提交的源码同步方案、代码片段与执行证据，没有运行本机测试，也没有逐文件审查整个产品。

处理记录：

- 按意见隔离截断草稿后缀、补逐模块构建边界表、把索引绑定实际 Git blob、对全 tree 做禁止类型及魔数检查。
- 首轮关于未提供的熵阈值及其方向推理有误，已明确指出并补充独立候选检查；DeepSeek 在复查中撤回该 P0。
- 复查明确无剩余 P0/P1 安全内容阻断，原样导入的格式警告属于非阻断事项；结论仅限源码同步。
- 其剩余条件是最终说明入树后重生成索引/复扫，确认 release34-runtime-source 的属性和索引覆盖，普通推送后远程提交与本地相同。这些由本次发布执行者按最终实际 tree 完成核验；不能把审查回复代替实际上传结果。

未执行产品全量业务回归、构建安装包、主机/员工安装、真实数据库检查、手机/打印或性能验收。本次不修改正式软件、业务数据、仓库权限，也不重写公共历史。
