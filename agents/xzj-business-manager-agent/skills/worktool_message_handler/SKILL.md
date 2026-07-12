---
name: worktool_message_handler
description: 解析 WorkTool 回调服务器传入的标准消息，判断私聊/群聊、是否需要回复，并定位 conversationId 对应的会话记录。
---

# WorkTool 消息处理器

## 适用场景

当输入中包含以下字段时使用本技能：

- `channel: "wecom-worktool"`
- 或外层对象包含 `worktoolMessage.channel: "wecom-worktool"`
- `botId`
- `conversationId`
- `eventType`
- `message`
- `roomType`
- `metadata`

## 标准输入

新版本回调服务器可能把 WorkTool 消息和状态机上下文包在外层：

```json
{
  "worktoolMessage": {
    "channel": "wecom-worktool",
    "eventType": "inbound_message",
    "conversationId": "botId:private:客户名",
    "message": "用户消息",
    "roomType": 2
  },
  "conversationReset": false,
  "flow": {
    "session": {
      "currentNodeId": "collect_basic_info"
    },
    "currentNode": {}
  }
}
```

处理时先读取 `worktoolMessage` 作为标准消息；如果没有外层，则兼容读取顶层字段。

旧版标准输入：

```json
{
  "channel": "wecom-worktool",
  "eventType": "inbound_message",
  "botId": "WorkTool机器人ID",
  "agentId": "DClaw Agent ID",
  "conversationId": "botId:private:客户名 或 botId:group:群名",
  "sessionId": "不要依赖它区分外部会话",
  "messageId": "WorkTool消息ID",
  "message": "用户消息",
  "rawMessage": "原始消息",
  "roomType": 2,
  "groupName": "",
  "userId": "客户名",
  "metadata": {
    "receivedName": "客户名",
    "atMe": "false",
    "textType": 1,
    "payload": {}
  }
}
```

## 判断步骤

1. 先判断输入是否包含 `worktoolMessage`。如果有，把 `worktoolMessage` 当作标准消息；同时保留外层 `flow` 给 `flow_state_machine` 使用。
2. 确认标准消息的 `channel` 是否为 `wecom-worktool`。如果不是，按普通 DClaw 对话处理。
3. 读取 `conversationId`。如果缺失，使用 `botId + roomType + userId/groupName` 临时构造，但需要在回复或日志中标记输入不完整。
4. 如果外层 `conversationReset=true`，先清空或重建当前 `conversationId` 对应的短期会话记录文件；本轮不要参考旧短期对话，但可以保留并参考长期客户档案。
5. 判断消息类型：
   - `eventType = "outbound_proactive_message"`：这是机器人已经主动发送给客户或群的消息，只用于补全当前 `conversationId` 的会话记录。记录后输出空字符串，不进入客服回复流程，不调用企业智库，不生成客户可见回复。
   - `eventType` 缺失时，按历史兼容视为 `inbound_message`。
   - `roomType = 2/4`：私聊，默认需要回复；不要因为 `metadata.atMe = "false"` 或 `groupName` 有值就误判为群聊。
   - `roomType = 1/3`：群聊，只有 `metadata.atMe = "true"` 或 `rawMessage` 明显包含 @机器人 时回复。
   - 只要 `roomType = 2/4`，就按私聊处理，不执行群聊 @ 判断。
6. 普通客服消息进入 `customer_reply_flow`；如果外层存在 `flow`，同时进入 `flow_state_machine`，最终输出 `reply + attachments + flowDecision` JSON。

## 主动推送事件

当 `eventType = "outbound_proactive_message"` 时，表示回调服务器已经通过 WorkTool 主动向客户或群发送了一条消息。该事件不是客户提问，也不需要回复。

处理要求：

- 使用传入的 `conversationId` 定位同一个会话记录文件。
- 将事件记入会话记录，角色标记为 `assistant` 或 `bot`，并标明来源为“主动推送”。
- 记录关键信息：发送对象、消息类型、消息内容、附件/文件摘要、WorkTool messageId。
- 不调用 `customer_reply_flow`，不调用 DClaw 企业智库。
- 最终输出空字符串；即使内部完成记录，也不要输出“已记录”等文本。

## 会话重置规则

- `conversationReset=true` 只作用于当前 `conversationId`。
- 清空或重建短期会话记录文件后，再处理本轮消息。
- 不删除 `客户档案/` 中的长期客户画像，除非客户明确要求删除长期记忆。
- 如果无法实际删除文件，也必须在本轮判断中忽略旧短期会话内容，并用本轮消息重新开始记录。

## 输出边界

- 本技能只做内部判断，不要把判断步骤、规则解释或“让我分析一下”输出给客户。
- 最终如需回复，默认只输出客户可见文本。
- 如果本轮回复需要发送图片、文件、视频、音频或链接资源，最终输出必须按 `worktool_attachment_response` 返回 JSON：`{"reply":"...","attachments":[...]}`。
- 如果外层存在 `flow`，最终输出必须按 `flow_state_machine` 返回 JSON：`{"reply":"...","attachments":[],"flowDecision":{...}}`，有资源时填入 `attachments`。
- 如无需回复，输出空字符串。

## 会话记录定位

会话记录存放在：

```text
会话记录/conversations/
```

文件名优先使用：

```text
sha256(conversationId).md
```

如果无法计算 hash，使用安全 slug：

```text
conversationId 中的冒号、斜杠、空格等替换成下划线
```

文件头必须保留原始 `conversationId`。

## 清空当前会话

如果用户明确表达：

```text
清空会话
重新开始
忘记前面
```

只清空当前 `conversationId` 对应的短期会话记录，不删除客户档案。
