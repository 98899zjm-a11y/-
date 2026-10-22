# Root release authority, 2026-10-22

Root is explicitly authorized by the user for the scoped release work recorded below（用户授权记录）.

Direct user authorization in this chat: “按方案执行，允许你接管发布环节，DeepSeek继续帮你修复和审查。不要再反复停下，测试通过后直接更新主机，把完整安装包、员工一键升级补丁和说明给我，原数据不要动。”

Root records this authorization to prepare and sign the new 1.7.0 internal candidate using the existing publisher, incorporating only the exact reviewed runtime, slot, fixed5 install-location and patched delivery-native files listed in reviewed-inputs-ROOT.json. Existing packages, private keys and original business data must be preserved. Outer signing is detached from the immutable archive, which must pass the actual auditor and actual AST/ASAR verification.

Production installation is conditional on applicable native tests, verified recoverable backup and normal program exit; this signing record does not claim those steps completed and does not authorize publishing a public feed. The user confirmed saving and normally exiting the formal host before backup. The backup has byte-verified copies and three successfully opened restoration copies; production has not been installed by this document.
