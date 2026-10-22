# 开源研究记录

2026-10-23 通过当前 GitHub 连接实际检索：

- ERPNext： https://github.com/frappe/erpnext ，当前返回未归档。实际读取develop/license.txt，GPLv3。只参考采购单、收货、审核与往来关系，不复制代码，不作为新增运行依赖。
- Frappe Books： https://github.com/frappe/books ，当前GitHub返回已归档。实际读取master/LICENSE，AGPLv3。只保留原有设计研究参考，不作为新基础或推荐活跃依赖。

已有项目已经有约40万字节的ERP/出纳模块，本轮优先复用其正确领域代码与现有Python/Flask/SQLite/Electron技术栈。没有为换架构引入大型ERP，不把GPL/AGPL代码直接拷进当前源码。后续新依赖仍须核对许可证、安全版本和分发条件。
