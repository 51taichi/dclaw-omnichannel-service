# 任务动作 Chips：拉人入群设计

## 背景

控制台的任务状态机目前只负责把节点目标、完成条件、交流技巧和客户激活话术传给 Agent。现在需要支持在业务流程中执行“拉客户入群”这类确定性动作。WorkTool 提供了修改外部群信息接口，可通过 `sendRawMessage` 的 `type: 207` 指令把指定联系人拉入指定外部群。参考接口：https://worktool.apifox.cn/api-23520590

目标是让运营人员在任务节点和激活话术里配置动作，但不把动作命令混入话术文本，避免客户看到内部指令，也避免后续扩展时文本难以维护。

## 设计原则

- 话术仍然只是普通文本。
- 拉人入群是结构化动作，由控制台后台执行。
- UI 用动作 chip 展示，例如 `拉入：直播课学习群`。
- 保存到状态机 JSON 时使用明确的动作对象。
- 执行结果进入日志和发送记录，便于排查 WorkTool 指令回调。
- 默认幂等，同一会话、同一节点、同一动作不重复执行。
- 第一版只支持私聊会话中的“当前客户”作为拉群对象。

## 状态机数据结构

节点新增 `actionsOnComplete`：

```json
{
  "id": "node_1",
  "name": "邀约直播课",
  "actionsOnComplete": [
    {
      "id": "action_1",
      "type": "invite_to_group",
      "groupName": "直播课学习群",
      "target": "current_contact",
      "showMessageHistory": true,
      "runOnce": true
    }
  ]
}
```

激活话术新增 `actionsAfterSend`：

```json
{
  "content": "道友，今晚直播课快开始了，我把你拉到学习群里，方便接收提醒。",
  "intervalMinutes": 5,
  "maxTimes": 1,
  "actionsAfterSend": [
    {
      "id": "action_1",
      "type": "invite_to_group",
      "groupName": "直播课学习群",
      "target": "current_contact",
      "showMessageHistory": true,
      "runOnce": true
    }
  ]
}
```

动作字段含义：

- `id`：节点内唯一动作 ID，用于幂等和日志定位。
- `type`：第一版只支持 `invite_to_group`。
- `groupName`：WorkTool 外部群名称。
- `target`：第一版固定为 `current_contact`。
- `showMessageHistory`：是否让新成员看到群历史消息。
- `runOnce`：默认 `true`，同一动作对同一会话只执行一次。

## UI 交互

任务节点编辑器新增“节点动作”区域：

- 点击 `+` 添加动作 chip。
- chip 展示为 `拉入：群名`。
- 点击 chip 打开编辑浮层或小表单。
- 可编辑目标群、是否展示历史消息。
- 可删除动作。

激活话术块内同样支持动作 chip：

- 每条话术可以挂多个动作。
- chip 展示在话术块下方或右侧，不进入 textarea 内容。
- 保存时进入该话术的 `actionsAfterSend`。

## 执行时机

节点完成动作：

1. Agent 返回 `flowDecision.nodeCompleted=true` 且进入下一个节点。
2. 控制台后台完成节点流转。
3. 后台读取旧节点的 `actionsOnComplete`。
4. 对每个可执行动作进行幂等检查。
5. 调用 WorkTool 拉人入群。
6. 记录执行结果。

激活话术动作：

1. 激活任务到期。
2. 后台发送激活话术。
3. 话术发送成功后执行该话术的 `actionsAfterSend`。
4. 动作失败不回滚已经发送的话术，但会记录失败日志。

## WorkTool 指令

调用 `/wework/sendRawMessage`，指令使用：

```json
{
  "type": 207,
  "groupName": "直播课学习群",
  "selectList": ["客户名称"],
  "removeList": [],
  "showMessageHistory": true
}
```

客户名称来自当前私聊会话的 `receivedName` 或 `conversationKey` 中的私聊目标名。

## 幂等与日志

新增动作执行记录表，用于保存：

- `bot_id`
- `agent_id`
- `conversation_key`
- `node_id`
- `activation_task_id`
- `action_id`
- `action_type`
- `status`
- `worktool_message_id`
- `worktool_response_json`
- `error_message`
- `created_at`
- `updated_at`

唯一约束建议：

- 节点完成动作：`bot_id + agent_id + conversation_key + node_id + action_id`
- 激活话术动作：`bot_id + agent_id + conversation_key + activation_task_id + action_id`

这样可以避免节点重复完成、服务重启、Worker 重试导致重复拉群。

## 错误处理

- 未配置群名：跳过动作并记录 `missing_group_name`。
- 不是私聊会话：跳过动作并记录 `unsupported_conversation_type`。
- 找不到客户名：跳过动作并记录 `missing_contact_name`。
- WorkTool 返回失败：记录失败，不影响主回复或激活话术。
- 指令回调失败：通过已有 command callback 记录追踪。

## 测试范围

- 状态机 JSON 能保存节点动作和激活话术动作。
- 节点完成后执行一次拉群动作。
- 同一节点动作重复触发不会重复执行。
- 激活话术发送成功后执行拉群动作。
- 群聊会话不会执行拉群动作。
- WorkTool 指令 payload 正确包含 `type:207`、`groupName`、`selectList`、`showMessageHistory`。

## 第一版不做

- 富文本编辑器。
- 文本宏，例如 `{{拉群:xxx}}`。
- 从群成员列表中多选客户。
- 拉多个客户入群。
- 踢人出群。
- 自动创建群。
