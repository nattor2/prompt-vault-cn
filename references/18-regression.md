# 自动行为回归

需要 Node.js 22 或以上。维护者在 skill 目录运行；普通用户使用模板时无需运行。样本唯一来源为 `tests/fixtures/behavior.json`，覆盖验收矩阵18行及英文触发正反例，共25例；包含生成、单独执行复制块、描述触发分类三种阶段。

```powershell
node --test tests/catalog.test.cjs tests/privacy.test.cjs tests/regression.test.cjs
node scripts/catalog.cjs --check
node scripts/regression.cjs --check-fixtures
node scripts/regression.cjs --list
```

这些命令只验证本地代码与样本结构，不执行模型，不能作为模型行为通过率。

## 执行模型

先安装并登录 Codex CLI，确保可独立执行 `codex exec`。适配器使用该 CLI 当前配置的模型及服务，不硬编码模型。可用 `CODEX_CLI` 环境变量指定可执行文件绝对路径。请自行检查当前配置的工具与服务授权；只读沙箱限制文件写入，不保证模型没有网络工具。测试输入均为合成场景，不使用真实隐私材料。

```powershell
node scripts/regression.cjs --run --adapter scripts/codex-adapter.json --out ../regression-run-001
```

输出目录必须全新、位于 skill 目录之外，父目录需已存在。可通过 `--ids matrix-01-system-architecture` 选择个别样本，其余视为未覆盖。脚本为每例分别调用适配器；Codex 适配器使用独立临时目录、ephemeral 会话及结构化输出。单例超时或错误计为失败，不跳过，也不改成模拟答案。调用可能产生费用。CLI 未配置或不可达时先修复环境，不能报告行为通过。

也可自行编写适配器：配置为 JSON `{ "command": "$NODE", "args": ["absolute-adapter.cjs"], "timeout_ms": 120000, "backend": "service-and-model-identity" }`。无 shell 执行，stdin 为一份 JSON 输入包，stdout 仅返回 `{ "output": "实际交付正文", "template_id": null }`；生成模板时 template_id 用稳定小写 key，例如 `cd-09`。任务要求 JSON 时把实际 JSON 序列化为 output 字符串。不要把参考答案、评审标准或“我已通过”当模型输出。配置中不放密钥，凭据由适配器本机安全读取。

报告中的 `live_adapter` 只表示本次调用了所选程序；自定义程序也可能是 mock，必须另外如实记录服务、模型版本和配置。哈希只绑定文件内容，不能证明模型身份或来源真实性。

## 历史输出检查与输入导出

```powershell
node scripts/regression.cjs --export ../model-inputs.json
node scripts/regression.cjs --grade ../saved-responses.json --out ../regrade-001
```

导出输入不执行模型，且不包含预期断言；仍应人工检查材料。历史记录格式为 `{ "source_hash": "输入包中的值", "cases": [{ "id": "样本ID", "fixture_hash": "对应输入包中的值", "output": "实际正文", "template_id": null }] }`。保留真实原始结果来源及模型信息，不手编理想答案。版本或样本改变时拒绝混用；缺少输出计失败。`--grade` 报告标记为 `recorded_responses`，不可冒充新一轮执行。

## 判定和隐私边界

输入发送前、输出落盘前调用本地 `privacy.cjs` 模块脱敏并再次扫描；只保存脱敏结果。模型错误输出不会回显到终端。规则局限见 `references/17-privacy.md`。不要为通过检查而把隐私值编码、拆分或藏入模板编号等元数据。

报告列出机器断言通过、错误/失败、待人工复核及覆盖数量。数值断言检查实际 JSON 计算结果，文本断言仅做必要信号筛查；19例仍需人工判断。待人工复核不是完整验收通过，机器通过不能替代对急症语境、证据真实性、逐轮等待、时间加总和目标对齐的判断。退出码0仅表示所选机器断言通过；1表示有失败或错误；2表示输入、路径或运行条件被拒绝。

此版本的执行样本直接测试库存复制块，并不自动接续生成阶段的输出。完整两阶段验收仍按 `references/15-evaluation.md`，把当次生成的最终提示词放入新对话执行。英文触发分类也不等同于真实客户端的技能发现与加载测试。

已知机器筛查边界：出现“急救”不能证明建议方向正确，否定句和引用坏例子可能误命中或误拒绝；这些样本均保留人工复核标志。微课同时检查声明总时长和实际活动时长之和，但活动与目标是否对齐仍由人工判断。不能将这些文本断言用于无人复核的专业决策发布。
