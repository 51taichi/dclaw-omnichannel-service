# DClaw 海外社交渠道服务改造计划

## 1. 文档用途

本文档用于接手和改造当前项目：

`/Users/moxi/Desktop/codex space/agent create/dclaw-omnichannel-service`

本文档是第一阶段改造目标和范围边界。开始编码前，应先检查当前代码、测试和未提交内容，再形成细化实施计划；禁止直接进行全局关键词替换。

## 2. 项目背景

当前项目由 `worktool-bot-service` 复制并持续更新，仍包含大量 WorkTool 和企业微信专属实现：

- WorkTool 消息、指令和回执回调；
- WorkTool 主动发送和历史消息接口；
- 企业微信新增好友、好友标签同步和联系人清理；
- WorkTool 群名称、群成员、动作编号和响应模型；
- 以 WorkTool/WeCom 命名的数据库列、配置、日志、UI 和测试。

该项目将成为独立的海外社交渠道服务，不继续支持微信，也不兼容原生产运行环境。

第一阶段只接入 **Whapi.Cloud / WhatsApp**，同时支持 WhatsApp 私聊和群聊。Telegram 仅保留 Adapter 扩展边界，本阶段不实现。

## 3. 核心目标

将项目改造成渠道中立的 DClaw 客服与销售服务：

```text
Whapi.Cloud Webhook
        |
        v
Whapi Channel Adapter
        |
        v
Channel-neutral Core
  - 会话与消息
  - DClaw 调用
  - Agent Response Gateway
  - 状态机与客户激活
  - 标签与资产
  - 人工接管
  - 主动与定时推送
  - 群管理与群任务
  - 日志、提醒和运营统计
        |
        v
Whapi Channel Adapter
        |
        v
WhatsApp 私聊与群聊
```

核心业务不得直接了解 Whapi Webhook 字段、API 路径或响应格式。所有 Whapi 差异必须收口在渠道适配器内。

## 4. 已确认的产品决策

### 4.1 渠道范围

- 第一阶段实现 Whapi.Cloud。
- 第一阶段同时实现 WhatsApp 私聊和群聊。
- 不实现微信、企业微信或 WorkTool 兼容层。
- Telegram 本阶段不实现，只验证未来可以新增独立 Adapter。
- WhatsApp Status、Channel 和 Community 不属于第一阶段业务范围。

### 4.2 账号模型

- 一个控制台 Bot 对应一个 Whapi Channel，即一个已连接的 WhatsApp 账号。
- 系统支持多个 Bot，以管理多个 WhatsApp 账号。
- 每个账号拥有独立 Token、外部 Channel ID、Webhook Secret、连接状态和 DClaw Agent 绑定。
- 不同账号之间不得共享会话、消息、标签、任务、群或 DClaw Session。

### 4.3 业务模型

- DClaw 仍是唯一 Agent 服务。
- 保留状态机、任务节点、标签、资产、人工接管、主动推送、定时任务、审计和 Gateway。
- Bot、工作区和全局管理员概念可以保留，但底层必须渠道中立。
- WhatsApp 没有企业微信式新增好友事件。某账号首次收到某客户的私聊消息时，视为首次发现客户并启动入口节点。
- 群聊不进入私聊状态机，不采集私聊资产；群聊继续使用群回复策略、角色、标签、人工接管和群定时任务。

## 5. Whapi 能力结论

依据 Whapi 官方文档，第一阶段可以实现：

- Webhook 接收私聊和群聊消息；
- 私聊和群聊文本发送；
- 图片、视频、音频、语音和文档等媒体收发；
- 消息发送、送达和已读状态；
- 群列表、群信息和群成员查询；
- 建群、群信息变化和群成员变化事件；
- 群消息中 mention 一个或多个成员；
- 每个 WhatsApp 账号使用独立 Whapi Channel 和 Token。

参考资料：

- [Whapi API Documentation](https://whapi.cloud/docs)
- [Whapi Webhooks](https://support.whapi.cloud/help-desk/receiving/webhooks)
- [Whapi Group Messages](https://support.whapi.cloud/help-desk/groups/send-group-message)
- [Whapi Incoming Message Formats](https://support.whapi.cloud/help-desk/receiving/webhooks/incoming-webhooks-format/incoming-message)

必须考虑：

1. Whapi 不永久保存消息，系统必须自行可靠入库。
2. Webhook 会重试，消息和状态事件可能重复，处理必须幂等。
3. WhatsApp 没有原生 `@所有人`，只能取得群成员后逐个 mention。
4. Whapi 使用 linked-device session，可能掉线或要求重新扫码。
5. Whapi 不主动限制付费计划请求量，但 WhatsApp 存在风控，主动推送必须限速。
6. Whapi 不提供企业微信新增好友事件，不能复制 `textType=22/type=105` 逻辑。
7. Whapi Channel 原始状态包括 `AUTH`、`QR`、`INIT` 和 `LAUNCH`，需要映射为系统健康状态。
8. 媒体云端保存期限有限，需要长期展示的文件必须及时转存。

## 6. 非目标与禁止事项

### 6.1 本阶段非目标

- Telegram 实际接入；
- Meta 官方 WhatsApp Business Cloud API；
- 微信生产数据库历史迁移；
- WorkTool 回调或 API 兼容；
- 企业微信好友标签同步和联系人清理；
- 用 WhatsApp 标签替代系统内部标签；
- WhatsApp Status、Channel、Community 运营能力；
- 大规模重做控制台视觉设计。

### 6.2 明确禁止

- 核心业务模块直接调用 `gate.whapi.cloud`。
- 核心业务模块读取 Whapi 原始 Webhook 字段。
- 使用联系人姓名、群名或手机号作为会话唯一主键。
- 全局机械替换 `worktool` 为 `whapi`。
- 与原 WorkTool 服务共用数据库、数据目录、容器名、端口或环境文件。
- 将 Whapi Token 返回浏览器、提交 Git 或写入普通日志。
- 绕过现有 Agent Response Gateway。
- 让标签、资产、提醒或统计失败阻断客户可见回复。

## 7. 目标模块边界

建议结构如下，实际文件名可依据当前代码调整，但依赖方向必须保持：

```text
src/
  channels/
    contract.js
    registry.js
    whapi/
      adapter.js
      client.js
      webhook.js
      mapper.js
      capabilities.js
      errors.js
  core/
    conversations/
    messages/
    delivery/
    agents/
    flows/
    tags/
    assets/
    handoff/
    proactive/
    groups/
  server.js
```

不要求一次移动全部旧文件。新实现必须遵循该边界，旧模块在替代路径稳定后删除。

## 8. 渠道适配器契约

### 8.1 Adapter 基础接口

```js
{
  provider,
  capabilities,
  normalizeWebhook(input),
  sendText(command),
  sendMedia(command),
  getAccountHealth(account),
  configureWebhook(account),
  listChats(account, options),
  listGroups(account, options),
  getGroup(account, externalGroupId),
  listGroupParticipants(account, externalGroupId)
}
```

`normalizeWebhook` 可以返回多个标准事件，因为一个 Whapi Webhook 载荷可能包含事件数组。

### 8.2 能力声明

```js
{
  privateChats: true,
  groupChats: true,
  text: true,
  media: true,
  deliveryReceipts: true,
  readReceipts: true,
  groupParticipants: true,
  groupMentions: true,
  nativeMentionAll: false,
  contactLabels: false,
  friendAddedEvent: false
}
```

核心依据 capability 工作，不允许增加大量 `if (provider === ...)`。

### 8.3 标准入站事件

```js
{
  provider: "whapi",
  channelAccountId,
  eventId,
  eventType,
  occurredAt,
  chat: { externalId, type, displayName },
  sender: { externalId, displayName },
  message: {
    externalId,
    type,
    text,
    attachments,
    quotedMessageId,
    mentions
  },
  rawPayload
}
```

`rawPayload` 只用于审计和排错，不得向业务模块扩散。

### 8.4 标准发送命令与结果

```js
{
  channelAccountId,
  externalChatId,
  messageType,
  text,
  attachments,
  mentions,
  replyToExternalMessageId,
  idempotencyKey,
  metadata
}
```

Adapter 返回：

```js
{
  accepted,
  externalMessageId,
  status,
  providerResponse
}
```

核心只依赖统一结果，原始响应仅持久化用于审计。

## 9. 身份和会话隔离

### 9.1 稳定身份

```text
账号：internalBotId -> whapiChannelId
私聊：whapiChannelId + externalUserId
群聊：whapiChannelId + externalGroupId
消息：whapiChannelId + externalMessageId
```

联系人姓名、群名称和手机号只作为可变显示字段。

### 9.2 会话键

```text
whapi:<channelAccountId>:private:<externalUserId>
whapi:<channelAccountId>:group:<externalGroupId>
```

DClaw Session ID 必须包含 provider、账号和稳定会话 ID，防止跨账号或跨渠道串话。

### 9.3 幂等键

消息事件至少按以下组合去重：

```text
provider + channelAccountId + eventType + externalMessageId
```

状态事件允许重复到达，不能重复回复、打标、激活任务或推送。

## 10. 数据与运行环境隔离

第一项实施任务必须隔离项目运行身份：

- package 名称改为 `dclaw-omnichannel-service`；
- 使用独立数据库，例如 `dclaw-omnichannel-service.sqlite`；
- 使用独立 Docker Compose project、镜像和容器名；
- 使用独立数据目录、上传目录、端口、域名和管理员 Cookie 名；
- 使用独立 `.env`、Webhook Secret 和配置前缀；
- README 删除原 WorkTool 部署命令；
- 启动新项目不得读取或写入微信项目数据。

Git `origin` 必须指向独立仓库 `https://github.com/51taichi/dclaw-omnichannel-service.git`。禁止向原 WorkTool 仓库 push。

## 11. 功能需求

### 11.1 Whapi 账号配置

- 新建、编辑和禁用 Whapi Bot；
- 配置显示名称、Channel ID、API Token、Webhook Secret 和 DClaw Agent；
- Token 只允许写入和替换，读取时始终脱敏；
- 查看连接状态、最近成功 Webhook 时间和最近错误；
- 生成账号独立 Webhook 地址；
- 主动测试 Whapi API 健康状态；
- 禁用账号后停止 Agent 回复和后台发送，但保留历史数据。

### 11.2 Webhook 接收

1. 根据公开账号标识定位内部 Bot；
2. 校验账号专属 Secret 或等价的安全凭据；
3. 先持久化原始事件和幂等键；
4. 快速返回成功，避免同步等待 DClaw；
5. 将标准事件交给后台处理链路；
6. 重复事件返回成功但不重复处理；
7. 未知事件落审计且不阻塞其他事件。

### 11.3 私聊入站链路

1. 标准化并可靠入库；
2. 创建或更新客户和会话；
3. 首次发现客户时创建日期标签并进入入口节点；
4. 判断人工接管；
5. 需要 AI 回复时进入消息合并窗口；
6. 构建状态机、标签、资产和最近消息上下文；
7. 调用 DClaw；
8. 通过 Agent Response Gateway 校验；
9. 应用标签、资产和状态机决策；
10. 优先发送客户可见回复；
11. 异步处理状态、提醒、统计和后续激活。

任何非核心后台失败不得阻止正常回复发送。

### 11.4 私聊出站链路

支持 Agent 文本和媒体、人工回复、节点/标签激活、主动与定时推送、发送审计，以及 pending/sent/delivered/read/failed 状态更新。实时回复优先级高于批量任务。

### 11.5 群聊入站链路

- 通过稳定群 ID 创建和识别群会话；
- 保存所有群消息，即使不触发 Agent；
- 保存发送人稳定 ID 和显示名称；
- 同步群名称与成员变化，群名不作为主键；
- 支持仅被 @ 时回复、始终回复等策略；
- 将群背景、群角色和当前发言人传给 DClaw；
- 人工接管后继续入库但停止 AI 对外回复；
- 群手工标签只显示该群允许的标签组；
- 群标签激活沿用现有逻辑；
- 群聊不展示或采集私聊状态机资产。

### 11.6 群聊出站链路

支持群文本、媒体、成员 mentions、人工回复、标签激活、群定时任务、群总结任务、发送回执和失败审计。`@所有人` 通过群成员列表生成 mentions，不伪装为原生能力。

### 11.7 内部标签

- 保留 Agent 自动打标、手工打标、互斥组、单向变更和标签激活；
- 标签属于本系统，不同步到 WhatsApp；
- Agent 只能使用当前 Bot 和当前群/私聊允许的标签；
- 重复决策不得重复触发激活任务。

### 11.8 资产与状态机

- 私聊资产字段跟随任务节点动态变化；
- Gateway 只接受当前节点允许的资产字段；
- 群聊不运行私聊状态机和资产收集；
- 首次私聊代替新增好友事件启动入口节点；
- 客户回复、节点变化、人工接管和删除会话继续使旧激活任务失效。

### 11.9 人工接管

- 私聊和群聊都支持 AI/人工切换；
- 人工状态继续保存入站消息，但不发送 Agent 回复；
- 人工回复通过 Adapter 发送并写入本地会话；
- 恢复 AI 后下一条客户消息重新进入正常链路。

### 11.10 主动推送

- 支持按私聊、群聊、内部标签和添加日期筛选；
- 多条件取交集；
- 支持立即和一次性定时发送；
- 目标保存稳定 Chat ID；
- 批量发送可限速、取消和审计；
- 单目标失败不终止整个任务；
- 优先级低于实时和人工回复。

### 11.11 媒体文件

- 入站媒体记录类型、文件名、MIME、大小和外部消息 ID；
- 临时链接不能作为永久地址，需要长期展示的媒体及时下载；
- 下载失败不得导致文本消息丢失；
- 出站媒体格式由 Adapter 处理；
- 不得把 Token 拼入持久化媒体 URL。

### 11.12 连接健康与错误处理

- 将 Whapi 状态映射为 connected、disconnected、auth-required 和 degraded；
- 非 `AUTH` 状态暂停无意义发送，并提示重新授权；
- 超时、5xx、401 短暂重连和限流按类型有限重试；
- 明确业务拒绝不得无限重试；
- 错误包含 provider、账号、会话、请求类型和可读原因，但不包含 Token；
- DClaw 失败保留现有客户兜底回复策略。

## 12. 需要删除或替换的 WorkTool 能力

最终运行路径不得保留：

- `src/worktool.js` 直接调用；
- WorkTool 历史接口和缓存；
- callback-config 路由和 command callback；
- `textType=22/type=105` 好友事件与企微欢迎语识别；
- `src/wecom.js` 和企微联系人映射；
- 企业微信标签同步、好友删除与清理；
- WorkTool 群备注、成员备注、动作编号和响应码；
- 控制台微信图标、WorkTool 文案和企微配置项；
- README、环境变量、容器名、Cookie 名和数据库中的运行级 WorkTool 命名。

历史设计文档可作为业务参考，但新运行代码和文档不得宣称支持 WorkTool。

## 13. 分阶段实施计划

### 阶段 0：仓库和运行环境隔离

- 确认独立 Git remote；
- 重命名 package、容器、数据库、Cookie 和配置；
- 确认不会连接旧数据库；
- 建立全量测试基线；
- 形成 WorkTool/WeCom 耦合清单。

完成标准：项目可独立启动和测试，不要求连接 Whapi。

### 阶段 1：渠道契约

- 定义标准入站事件、发送命令、结果和 capabilities；
- 建立 Adapter registry；
- 为核心调用点增加窄接口；
- 使用 Fake Adapter 建立契约测试。

完成标准：核心测试可使用 Fake Adapter，不直接依赖 Whapi。

### 阶段 2：Whapi 账号与 Client

- 实现 Whapi HTTP Client；
- 实现账号配置、Token 脱敏和健康检查；
- 实现 Webhook 配置和账号专属回调地址；
- 建立 Whapi API 错误分类。

完成标准：测试账号可检查状态并发送一条测试消息。

### 阶段 3：私聊收发闭环

- Webhook 标准化和幂等入库；
- 首次客户消息入口逻辑；
- 接通 DClaw、Gateway、标签、资产和状态机；
- 文本、媒体、人工回复和状态回执。

完成标准：私聊可多轮对话，刷新不丢消息，不重复回复。

### 阶段 4：群聊闭环

- 群列表、群信息和群成员同步；
- 群消息标准化；
- 接通回复策略、背景、角色、标签和人工接管；
- 群文本、媒体、mentions 和群定时任务。

完成标准：群内可按策略触发 Agent，也可人工接管、打标和运行群任务。

### 阶段 5：主动推送与可靠性

- 稳定 Chat ID 目标选择；
- 立即和定时推送；
- 限速、取消、部分失败和审计；
- 验证实时回复不被批量任务阻塞；
- 完成掉线、超时、重复和重启恢复测试。

### 阶段 6：清除旧渠道实现

- 删除被替代的 WorkTool/WeCom 模块、路由、配置和 UI；
- 删除无意义表和字段；
- 更新 README、部署和运维文档；
- 字符串审计，残留只允许出现在历史文档或迁移说明。

### 阶段 7：完整验收

- 运行全量自动化测试；
- 使用 Whapi 测试账号执行端到端测试；
- 至少两个 Channel 验证账号隔离；
- 验证私聊、群聊、媒体、人工、标签、资产、状态机、推送和定时任务；
- 输出部署、回滚、监控和故障排查文档。

## 14. TDD 与测试要求

所有行为改造遵循 TDD：先写失败测试，再写最小实现，最后运行相关和全量测试。

### Adapter 单元测试

- 文本、图片、语音、视频和文档映射；
- 私聊和群聊 ID；
- 群发送人、引用和 mentions；
- 错误与状态映射；
- 出站文本与媒体请求；
- Token 不进入日志。

### Webhook 集成测试

- 事件先入库再异步处理；
- 重复投递只处理一次；
- 单载荷多个事件；
- 未知事件安全落审计；
- 错误 Secret 被拒绝；
- 不同账号完全隔离。

### 核心回归测试

- 私聊 Agent 回复和 Gateway 修复；
- 标签决策、动态资产、节点变化与激活失效；
- 人工接管；
- 主动与定时推送；
- 群回复策略和群任务；
- 客户回复优先级不受后台任务影响。

### 端到端测试

- 两个测试账号私聊；
- 群普通消息、@Bot 和 Bot 回复；
- 图片、语音、视频和文档；
- Channel 断开和恢复；
- pending 到 sent/delivered/read；
- 多账号并发无串话。

真实 Token 不得写入 fixture 或 Git。

## 15. 第一阶段验收标准

1. 无需安装或配置 WorkTool 即可独立运行。
2. 一个或多个 Whapi Channel 可配置并绑定不同 DClaw Agent。
3. 私聊和群聊消息可靠入库。
4. 重复 Webhook 不重复回复或触发任务。
5. 私聊完成 DClaw、标签、资产、状态机和节点激活。
6. 私聊和群聊都支持人工接管和回复。
7. 群聊按策略调用 DClaw，并使用群背景和角色。
8. 群聊可打允许的标签并运行标签激活。
9. 文本、图片、语音、视频和文档正确收发展示。
10. 主动推送支持私聊、群聊、标签、日期、立即和定时发送。
11. 实时回复不被后台任务长期阻塞。
12. 出站消息关联外部消息 ID 和状态。
13. 两个账号不存在会话、Session、标签或任务串线。
14. 掉线、超时和失败可审计且不无限重试。
15. 新运行路径不存在 WorkTool API、企微好友事件或企微标签同步。
16. 全量自动化测试通过并完成 Whapi 端到端验证。

## 16. 开始工作的顺序

1. 阅读本文档。
2. 确认 Git remote 指向独立仓库。
3. 检查未提交和未推送内容，不覆盖用户修改。
4. 运行全量测试并记录基线。
5. 使用 `rg` 形成 WorkTool/WeCom 耦合清单。
6. 对照当前核心模块划定 Adapter 接入点。
7. 为阶段 0 和阶段 1重新编写适配当前代码的设计与实施计划。
8. 按 TDD 实现，不使用全局替换。
9. 每个阶段独立验证和提交。
10. 私聊闭环稳定后继续群聊。

## 17. 最终架构原则

```text
渠道负责：收、发、身份、媒体、群和回执。
核心负责：会话、Agent、任务、标签、资产、人工、推送和审计。
```

未来接入 Telegram 时，只新增 Telegram Adapter、账号配置和少量 capability 驱动 UI，不复制 DClaw、状态机、标签、推送或会话核心。
