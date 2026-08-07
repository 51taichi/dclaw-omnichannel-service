# AI 自动回复送达状态设计

## 目标

在控制台会话中，为 AI 自动回复显示 WhatsApp 送达状态，同时保留人工消息现有状态。页面不轮询；点击现有“刷新”后读取最新状态。

## 现有结构

AI 一次回复可能产生多条 Whapi 消息：多段文本和多个媒体附件分别获得外部消息 ID。控制台将它们合并为一个 AI 聊天气泡，并在 `conversation_messages.raw_payload_json.channelMessageIds` 保存全部外部消息 ID。每条实际发送记录分别保存在 `outgoing_messages`。

人工消息使用 `rawPayload.source = manual_reply` 和单个 `messageId` 关联状态。

## 状态汇总规则

AI 气泡以全部 `channelMessageIds` 对应的发送记录汇总状态：

1. 任一记录为 `failed`：显示“发送失败”。
2. 否则任一记录为 `pending` 或 `sent`：显示“✓ 已发送”。
3. 否则全部记录至少为 `delivered`：显示“✓✓ 已送达”。
4. 只有全部记录均为 `read` 或 `played`：显示蓝色“✓✓ 已读”。

若消息声明了多个 ID，但只找到部分发送记录，按保守原则显示“✓ 已发送”，不提前宣称已送达。找不到任何发送记录时不显示状态，避免旧历史消息误判。

单条 AI 回复使用相同规则，自然退化为该消息的原始状态映射。`played` 在气泡汇总中视为已读完成。

## 数据关联

`outgoing_messages` 继续作为唯一状态事实来源。读取会话时：

- 人工消息沿用 `messageId + provider + channelAccountId` 关联。
- AI 出站消息读取 `channelMessageIds`；如果旧记录只有 `channelMessageId`，将其作为单元素列表兼容。
- provider 和 channel account 从会话键取得，并与 Bot、conversation key 一起限定查询范围。
- 一次批量查询当前消息窗口所需的所有 ID，避免逐气泡查询。
- 同一完整身份存在多条发送记录时选择最新记录。

数据库向会话消息对象暴露现有字段：

```json
{
  "deliveryStatus": "delivered",
  "deliveryError": "",
  "deliveryUpdatedAt": "2026-08-07T16:55:00.000Z"
}
```

`deliveryUpdatedAt` 使用参与汇总记录中的最晚更新时间；失败时 `deliveryError` 使用第一条非空失败原因。

## 前端

状态渲染允许两类出站消息：

- `source = manual_reply` 的人工消息；
- 带有效 `channelMessageId/channelMessageIds` 且不是人工消息的 AI 出站消息。

显示规则保持一致：

| 汇总状态 | 界面显示 |
| --- | --- |
| `pending` / `sent` | ✓ 已发送 |
| `delivered` | ✓✓ 已送达 |
| `read` / `played` | 蓝色 ✓✓ 已读 |
| `failed` | 发送失败 |

客户入站消息、未知状态和没有可关联发送记录的历史 AI 消息不显示状态。

## 异常与兼容

- 不修改 Whapi Webhook 状态处理和单调推进规则。
- 不将汇总状态写回数据库。
- 不新增轮询、SSE 或 WebSocket。
- AI 发送被人工接手中断但已成功发送的部分，仍通过其已保存的 `channelMessageIds` 汇总状态。
- 现有人工消息行为和状态隔离必须保持不变。

## 测试

- 单条 AI 消息覆盖 `pending`、`delivered`、`read` 和 `failed`。
- 多段 AI 消息覆盖最慢状态、全部送达、全部已读和任一失败。
- 多段 ID只有部分发送记录时显示已发送；全部缺失时隐藏。
- 文本和附件 ID共同参与汇总。
- Bot、conversation、provider 和 channel account 隔离。
- 旧的单一 `channelMessageId` 兼容。
- 前端只允许人工消息和带通道消息 ID的 AI 出站消息显示状态。
- 人工消息、媒体气泡和无实时更新约束的既有测试继续通过。

## 验收标准

1. AI 自动回复发送成功后显示“✓ 已发送”。
2. 所有分段均送达后，点击刷新显示“✓✓ 已送达”。
3. 所有分段均已读后，点击刷新显示蓝色“✓✓ 已读”。
4. 任一分段失败时显示“发送失败”。
5. 不会因单个分段提前已读而将整个 AI 气泡标为已读。
6. 人工消息现有显示保持不变。
