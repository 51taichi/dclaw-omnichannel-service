# 人工接手会话设计

## 背景

AI 客服和客户沟通过程中，有些客户会表现出明确需求或较强成交意向。此时需要由员工在企业微信客户端中置顶客户并直接沟通，避免 AI 继续自动插话。同时，系统仍然需要完整记录客户与人工之间的来往，并同步给 DClaw agent 作为后续上下文。

## 目标

- 控制台会话界面更紧凑，任务、资产、时间等信息使用 icon + hover 展示。
- 每个私聊会话支持“人工接手”和“恢复 AI”。
- 人工接手期间，服务端不发送 AI 自动回复。
- 人工接手期间，WorkTool 回调仍完整入库。
- 人工接手期间，消息仍同步给 DClaw agent 作为历史记录，但 agent 不生成客户可见回复。
- 取消人工接手后，新消息恢复正常 agent 自动回复流程。

## 状态模型

第一版只针对私聊会话。状态存储在 `flow_sessions`，因为入口位于当前客户会话列表，且状态机已经与私聊会话绑定。

新增字段：

```text
handoff_status TEXT NOT NULL DEFAULT 'ai'
handoff_at TEXT
handoff_by TEXT
handoff_reason TEXT
```

状态含义：

```text
ai:
  当前由 AI 自动回复

human:
  当前由人工接手，AI 不自动回复
```

已有会话默认 `ai`。

## 回调处理链路

现有正常链路：

```text
WorkTool 回调
-> incoming_messages 入库
-> conversation_messages 入库
-> 调用 DClaw agent
-> 解析回复
-> 发送 WorkTool 回复
-> outgoing_messages 入库
```

人工接手链路：

```text
WorkTool 回调
-> incoming_messages 入库
-> conversation_messages 入库
-> 判断当前私聊 flow_session.handoff_status = human
-> 调用 DClaw agent 进行只记录同步
-> 不解析客户可见回复
-> 不调用 WorkTool 发送
-> message_processing 标记 human_handoff
```

该分支只跳过“生成并发送 AI 客户回复”，不跳过入库和 agent 历史同步。

## DClaw 同步事件

人工接手期间调用 DClaw 时使用专门事件：

```text
eventType = "handoff_transcript_message"
```

请求内容仍携带完整 `worktoolMessage`、`conversationId`、`flow`、`conversationReset` 等上下文。

额外 instructions：

```text
这是人工接手期间的聊天记录，只用于补全当前 conversationId 的历史。
不要生成客户可见回复。
不要推进状态机。
不要输出话术。
最终请输出空字符串。
```

如果 DClaw 调用失败，只记录失败日志，不影响 WorkTool 回调成功响应，也不向客户发送兜底消息。

## Console UI

会话列表和会话顶部改为紧凑信息表达：

- 任务节点：图标显示，hover 显示当前任务节点名称。
- 资产：briefcase 图标 + `已收集/总数`，hover 显示资产摘要。
- 时间：clock 图标，hover 显示完整更新时间。
- 人工状态：人工接手图标。

会话顶部新增主按钮：

```text
AI 状态:    [人工接手]
人工状态:  [恢复 AI]
```

人工状态下：

- 会话列表卡片显示人工标识。
- 当前会话顶部显示“人工接手中”。
- 按钮文案变为“恢复 AI”。

## API 设计

更新人工状态：

```http
PUT /api/flow-sessions/:conversationKey/handoff
x-bot-session-token: token
Content-Type: application/json

{
  "botId": "bot_xxx",
  "handoffStatus": "human",
  "reason": "客户意向明确"
}
```

恢复 AI：

```json
{
  "botId": "bot_xxx",
  "handoffStatus": "ai",
  "reason": "恢复 AI"
}
```

返回：

```json
{
  "ok": true,
  "session": {}
}
```

权限：

- 当前 Bot 的 bot/admin token 都可以操作。
- 只能操作当前 Bot 对应的 conversation。

## 数据展示

`listFlowSessions` 返回新增字段：

```json
{
  "handoffStatus": "human",
  "handoffAt": "2026-07-10T...",
  "handoffBy": "console",
  "handoffReason": "客户意向明确"
}
```

`GET /api/flow-sessions/:conversationKey` 同样返回当前 session 或 handoff 状态，便于会话顶部渲染。

## 非目标

第一版不做自动识别高意向客户，不做多人工账号分配，不做转人工通知，不做企业微信置顶自动化。员工自行在企业微信客户端置顶和沟通。

第一版也不要求 agent 根据人工记录自动总结；只保证人工期间记录能同步到 agent 的当前会话历史。

## 测试计划

后端：

- 新会话默认 `handoffStatus=ai`。
- 调用 handoff API 可切换到 `human`。
- human 状态下收到消息会入库，但不会发送 WorkTool 回复。
- human 状态下仍会产生 DClaw 同步调用，事件类型为 `handoff_transcript_message`。
- 恢复 `ai` 后新消息重新走正常 agent 回复。

前端：

- 会话列表包含人工状态字段和图标。
- 会话顶部显示人工接手/恢复 AI 按钮。
- 点击按钮调用 handoff API 并刷新当前会话。
- 任务、资产、时间使用 icon + hover 表达。
