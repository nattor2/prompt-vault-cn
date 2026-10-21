# 参考数据与资源（非模板）

这个文件提供模型选型的核查维度、带日期的参数快照和外部资源入口。资源是参考线索，不是效果或专业正确性的保证。

## 一、按任务核查模型

先确定目标产品入口、能否联网/读文件、材料长度、输出量、预算和隐私要求。聊天产品、API和本地部署的限制不能混用；上下文容量也不等于长材料任务的准确率。不同模型的表现用同一代表任务比较，不凭品牌、语言或窗口长度下普遍排名。

以下仅为2026-10-20核查的指定版本快照，不是最新模型推荐或所有产品入口的可用限额：

| 指定模型/版本 | 文档窗口 | 来源 | 核查日期 |
|---|---|---|---|
| `gpt-5` API模型页 | 400,000 tokens | [OpenAI官方模型页](https://developers.openai.com/api/docs/models/gpt-5) | 2026-10-20 |
| [moonshotai/Kimi-K2.5](https://github.com/moonshotai/Kimi-K2.5) 发布模型卡 | 256K | [发布者模型卡](https://huggingface.co/moonshotai/Kimi-K2.5) | 2026-10-20 |

其他模型或产品入口，推荐前查其官方页面并记录精确ID、入口、窗口/输出上限、工具能力、价格口径、日期与限制。没有联网时说明无法确认当前参数，不用旧表作现时建议。

长材料先检查提取/检索和证据定位；成本比较纳入输入、输出、工具调用和重试；中文与代码表现通过真实样例验证。不要为了换模型跳过缺材料或口径问题。

## 二、外部优质资源清单

用户想自己翻原仓库时，从这里进。

### 通用提示词库

| 仓库 | 说明 |
|---|---|
| [f/awesome-chatgpt-prompts](https://github.com/f/awesome-chatgpt-prompts) | 提示词合集，角色扮演类为主，灵感来源 |
| [dair-ai/Prompt-Engineering-Guide](https://github.com/dair-ai/Prompt-Engineering-Guide) | 提示词工程系统指南，含论文和教程，含理论与实践材料 |
| [langgptai/LangGPT](https://github.com/langgptai/LangGPT) | 中文结构化提示词框架（Role/Profile/Goal/Skills/Rules/Workflow），本 skill 模板结构的来源之一 |
| [xiongxianzhu/awesome-prompts](https://github.com/xiongxianzhu/awesome-prompts) | 中文提示词合集，分类清晰，含 PRD、项目生成模板 |
| [Grow-Online-Digital/awesome-aipromptlibrary-templates](https://github.com/Grow-Online-Digital/awesome-aipromptlibrary-templates) | 结构化模板库，XML 结构化写法（task/thinking/output_format） |

### 学术方向

| 仓库 | 说明 |
|---|---|
| [ahmetbersoz/chatgpt-prompts-for-academic-writing](https://github.com/ahmetbersoz/chatgpt-prompts-for-academic-writing) | 学术写作提示词清单，覆盖选题到结论全流程 |
| [binary-husky/chatgpt_academic](https://github.com/binary-husky/chatgpt_academic) | 学术增强工具，内置大量学术润色/翻译提示词 |
| [JYu-chen/academic_prompts](https://github.com/JYu-chen/academic_prompts) | 中英学术润色、翻译、语法检查提示词集 |
| [JackQuinn97/ielts_ai](https://github.com/JackQuinn97/ielts_ai) | 雅思写作 9 分改写 + 精读两份对话版提示词 |

### 专业垂直

| 仓库 | 说明 |
|---|---|
| [SenryLee/legal-prompts](https://github.com/SenryLee/legal-prompts) | 中文法律提示词库，诉讼/非诉分层，本 skill 法律模板的参考 |
| [Materialism-1/Contract-Review-Judgment-Summary-prompt](https://github.com/Materialism-1/Contract-Review-Judgment-Summary-prompt) | 合同审查 + 判决书摘要提示词 |
| [malnlda/china-lawyer-analyst](https://github.com/malnlda/china-lawyer-analyst) | 中国律师分析 skill，IRAC 框架 + 要件清单 |
| [hannanel100/awesome-prompt-files](https://github.com/hannanel100/awesome-prompt-files) | VS Code prompt files，代码审查/commit/测试等工程提示词 |
| [tangshaowan/ai-health-vault](https://github.com/tangshaowan/ai-health-vault) | 健康档案提示词集：体检报告提取、趋势分析、就医准备、复查日历 |
| [alivirgo/major-ai-skills](https://github.com/alivirgo/major-ai-skills) | 医疗 AI 安全边界规范，明确了"诊断类危险用法"和"信息翻译类安全用法" |
| [SimonsTang/teacher-assistant](https://github.com/SimonsTang/teacher-assistant) | 教师助手，备课/出题/学情/批改/家校 8 大模块 |
| [GarethManning/education-agent-skills](https://github.com/GarethManning/education-agent-skills) | 教育学技能合集，标注证据等级与来源文献 |

### 官方与框架

| 资源 | 说明 |
|---|---|
| OpenAI Cookbook | 官方提示词与 API 最佳实践 |
| [anthropics/prompt-eng-interactive-tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial) | Anthropic 交互式提示词教程 |
| 各平台内容规范 | 抖音/小红书/视频号违禁词规则（会变，以平台官方公告为准） |

### 提示词框架速查

| 框架 | 变量 | 一句话 |
|---|---|---|
| ICIO | 指令/背景/输入/输出 | 最简单，30 秒写完 |
| CO-STAR | 背景/目标/风格/语气/受众/输出 | 写作文案日常万能 |
| CRISPE | 能力角色/洞察/陈述/个性/实验 | 需要多方案对比时 |
| BROKE | 背景/角色/目标/关键结果/迭代 | 钉死目标、多轮打磨 |
| LangGPT | 角色/简介/目标/技能/规则/流程/初始化 | 长期复用的角色设定 |

> 各来源对 CRISPE 等缩写的展开略有差异，实质变量相同。详见 `08-techniques.md` 第一节。

## 三、维护说明

- 只维护有实际用途的模型快照；每次据此推荐前核实指定入口和版本，不使用固定年度更新周期代替核查。
- 资源清单里失效的仓库（改名、归档）及时删掉，避免误导。
- 平台与广告规则按平台、品类、地域和日期核查，词表只是保守表达辅助，不能保证合规。活动时限、库存、价格和功效证据均须真实。

## 四、方法与专业核查入口

- [Agent Skills规范](https://agentskills.io/specification)：元数据与按需资源组织。
- [Anthropic Skill编写实践](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)、[OpenAI评测实践](https://developers.openai.com/api/docs/guides/evaluation-best-practices)：围绕真实任务、边界和回归验证；不是套格式即可保证效果。
- [WHO医疗大模型指导说明](https://www.who.int/news/item/18-01-2024-who-releases-ai-ethics-and-governance-guidance-for-large-multi-modal-models)：健康信息准确性、偏差和过度信任风险。
- [广告绝对化用语执法指南](https://www.samr.gov.cn/ggjgs/tzgg/art/2023/art_183b5cb48d9e4f0dba67f9f912a913ba.html)、[广告引证内容执法指南](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2026/art_8962fc1e4eb44a87b93d265af43b6940.html)：结合语境和适用范围检查，不能将禁词表或AI生成的数字当作完整法律依据。
