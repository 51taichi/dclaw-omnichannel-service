# 新增好友节点激活设计

## 目标

支持企业微信在新增好友后自行发送欢迎语或资料链接的场景。回调服务收到
WorkTool 的新增好友事件后，将客户放入私聊状态机的入口节点，并按该节点的
激活配置启动定时提醒；不重复发送欢迎语，也不调用 DClaw Agent。

## 已验证的输入

WorkTool 会向已绑定的消息回调地址发送以下事件：

```json
{
  "textType": 22,
  "type": 105,
  "friendName": "q.",
  "friendRemark": ""
}
```

该事件没有 `roomType`、`messageId` 或文本内容，因此现有逻辑将其记录后以
`non_text_or_empty_message` 跳过。

## 配置模型

每个状态机节点的 `activation` 新增 `trigger`：

- `after_ai_reply`：默认值，保持现有行为。AI 成功发送回复后创建激活任务。
- `friend_added`：仅入口节点可选。收到新增好友事件后创建激活任务。

原有状态机 JSON 未提供 `trigger` 时，规范化为 `after_ai_reply`，保证现有
Bot 的行为不变。

控制台在“启用客户激活”区域新增“触发时机”选项。非入口节点不能选择
`friend_added`；若导入 JSON 为非入口节点配置该值，服务端拒绝保存并给出
清晰错误。

## 事件流程

1. 回调入口收到 `textType=22` 且 `type=105` 的事件。
2. 读取并校验 `friendName`；为空时记录跳过日志，不创建会话或任务。
3. 对已启用且已绑定 Agent 的 Bot，以现有私聊键规则创建会话键：
   `botId:private:friendName`。
4. 若该 Bot 的 Agent 有启用的状态机，创建或读取该私聊的 flow session；它从
   状态机入口节点开始。
5. 仅当入口节点配置 `activation.enabled=true`、
   `activation.trigger=friend_added` 且至少有一条话术时，创建第 1 次激活任务。
   锚点为事件接收时间，`due_at` 按配置的间隔计算。
6. 不写客户可见聊天气泡、不调用 Agent、不通过 WorkTool 再发送欢迎语。

## 去重与取消

- 延用现有 `message_processing` 的合成事件键，重复到达的同一新增好友回调只
  处理一次。
- 客户后续发来任意私聊消息时，现有 `customer_replied` 逻辑取消未执行任务。
- 人工接手、清空会话、节点切换和新一轮 AI 回复仍沿用现有任务失效机制。
- `friend_added` 的节点不会在后续 AI 回复后再次创建激活任务；只有
  `after_ai_reply` 会走现有的回复后调度路径。

## 可观测性

新增结构化日志：

- `friend_added.received`：记录 Bot、好友名和事件类型。
- `friend_added.activation.scheduled`：记录任务 ID、节点、间隔与到期时间。
- `friend_added.skipped`：记录明确原因，例如 `missing_friend_name`、
  `no_enabled_binding`、`no_enabled_flow_machine`、`activation_not_configured`。

现有 `incoming.received` 与 `incoming.skipped` 保留，便于排查原始回调。

## 测试

- 激活配置向后兼容：缺失 `trigger` 时默认 `after_ai_reply`。
- 非入口节点配置 `friend_added` 被拒绝。
- `type=105` 且有 `friendName` 时，入口节点会创建私聊 flow session 和正确
  间隔的激活任务。
- 空好友名、无绑定、无状态机或未启用激活时不创建任务。
- `friend_added` 不触发 DClaw 调用或 WorkTool 欢迎语发送。
- 现有 `after_ai_reply` 激活调度保持不变。

## 非目标

- 不读取或替代企业微信的自动回复内容。
- 不为群聊创建新增好友激活任务。
- 不补发已在历史上错过的新增好友激活任务。
- 不修改 DClaw Agent 文件或 Agent 协议。
