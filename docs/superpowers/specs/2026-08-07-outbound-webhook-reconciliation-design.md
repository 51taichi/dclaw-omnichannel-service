# Whapi 出站 Webhook 会话补录设计

## 目标

修复 Whapi `messages.post` 中 `from_me = true` 的正常出站消息被统一过滤、未进入后台会话的问题，并恢复已经确认的三条历史漏记消息。

## 已确认根因

当前通道桥接只允许非 `from_me` 消息进入核心入站路径。这个限制能够避免本服务发送后的 Webhook 回显重复生成气泡，但也会丢弃由其他 API 路径通过同一 Whapi 账号发送的正常消息。

生产审计确认三个 Webhook 消息已成功处理，但其消息 ID既不存在于 `outgoing_messages`，也没有关联到 `conversation_messages`：

- `Psq87jVFbilb.xs-wNID1VW9yQ`
- `PsqlbmrN6JN3Z0M-wFwD1VW9yQ`
- `PspJAVWgozw4Nyg-wOAD1VW9yQ`

## 方案

### 实时对账

Webhook Worker 正常完成 Whapi 映射后，对标准化的出站消息执行独立对账，不把它们送入客户入站、Agent 调用或业务自动化路径。

对每条 `fromMe = true` 的消息：

1. 使用 `botId + provider + channelAccountId + external message ID` 查询现有发送记录。
2. 已存在时视为本服务发送回显，不新增会话气泡。
3. 不存在时，以通道会话键定位会话并补录一条 outbound `conversation_messages`。
4. 同时补录对应 `outgoing_messages`，初始状态使用 Webhook 消息携带的合法状态；没有合法状态时使用 `sent`。
5. 重复 Webhook 或重复执行对账不得产生重复数据。

### 内容规范化

Whapi 映射需保留客户可见正文：

- 普通文本：`text.body`
- 链接预览：`link_preview.body`
- 图片、视频、文档：caption；没有 caption 时使用现有可读附件占位规则

链接预览正文必须作为普通可见文本保存，原始 Webhook 数据保留在 `rawPayload` 中用于审计。

### 历史回填

提供显式、幂等的回填命令，从已完成的 `channel_webhook_events` 中扫描 `messages.post` 出站消息，并复用实时对账函数。

本次执行只允许回填已经确认的三个消息 ID。命令输出每条消息的处理结果和汇总；第二次执行应报告新增零条。

历史记录使用 Whapi 消息时间作为 `conversation_messages.created_at` 和发送记录时间，使消息恢复到原始会话位置。若对应会话不存在、身份无效或正文不可读，跳过并报告原因，不猜测归属。

## 数据与幂等边界

- 对账身份严格包含 Bot、provider、channel account 和消息 ID。
- 会话身份由标准通道事件的 provider、account、chat type、chat ID生成。
- 不以正文相同作为主要幂等条件。
- 已有 `outgoing_messages` 或已有会话 raw payload 关联该消息 ID时均不得新增气泡。
- 状态回调仍由现有 Whapi 状态推进逻辑处理。

## 不在范围内

- 不把出站 Webhook 当作客户消息调用 Agent。
- 不新增轮询、SSE 或 WebSocket。
- 不改变本服务标准发送 API的返回与落库语义。
- 不回填未经用户确认的其他历史消息。
- 不修改当前工作区内正在开发的人工回复附件行为。

## 测试

- Whapi mapper 能规范化 `from_me` 的 text 与 link preview 正文。
- 已存在发送记录的出站回显不重复插入。
- 未存在的出站消息同时补入会话和发送记录。
- Bot、provider、account、conversation 和消息 ID隔离。
- 重复实时回调和重复历史回填均幂等。
- 三个确认 ID的回填夹具恢复原始内容与时间。
- 现有客户入站、发送状态和会话测试保持通过。
