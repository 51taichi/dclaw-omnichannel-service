# 人工消息送达状态设计

## 目标

在控制台私聊会话中，为人工发送的 WhatsApp 消息展示 Whapi 返回的最新送达状态。页面不轮询；用户点击现有“刷新”按钮后获取最新状态。

## Whapi 状态依据

- 发送文本接口返回消息 ID 和初始状态，通常为 `pending`。
- 后续状态由 Whapi `statuses` Webhook 推送，以消息 ID 标识原消息。
- 支持的本地状态为 `pending`、`sent`、`delivered`、`read`、`played` 和 `failed`。
- 同一状态可能重复到达，状态也可能乱序到达。除 `failed` 外，状态只允许按 `pending` → `sent` → `delivered` → `read` → `played` 前进。
- WhatsApp 可能因联系人关系或隐私条件不提供 `read` 回执；没有 `read` 不能解释为对方尚未阅读。

## 范围

本次只为 `source = manual_reply` 的私聊人工消息展示状态。AI 自动回复、群聊自动化消息、媒体消息、实时推送和轮询不在本次范围内。

## 数据设计

`outgoing_messages` 继续作为发送状态的唯一事实来源，不把回执重复写入 `conversation_messages`。

人工发送时：

1. Whapi 发送响应提供外部消息 ID 和初始状态。
2. `conversation_messages.raw_payload_json` 保存 `source = manual_reply` 和消息 ID。
3. `outgoing_messages` 保存相同消息 ID、provider、channel account 和初始状态。

收到 Whapi `statuses` Webhook 时，现有回执处理逻辑按 provider、channel account 和消息 ID 更新 `outgoing_messages.delivery_status`。

读取会话消息时，数据库查询以人工消息 raw payload 中的消息 ID 关联同一 Bot、会话和外部消息 ID 对应的最新 `outgoing_messages` 记录。返回给前端的消息对象增加：

```json
{
  "deliveryStatus": "delivered",
  "deliveryError": "",
  "deliveryUpdatedAt": "2026-08-07T13:15:00.000Z"
}
```

非人工消息或找不到对应发送记录时不返回可见状态。

## 界面设计

现有聊天气泡结构保持不变。在人工发送消息的气泡底部或时间旁显示紧凑状态：

| Whapi 状态 | 界面文案 | 视觉含义 |
| --- | --- | --- |
| `pending` | 发送中 | 中性等待状态 |
| `sent` | ✓ 已发送 | Whapi/WhatsApp 已接受发送 |
| `delivered` | ✓✓ 已送达 | 已送达接收方设备 |
| `read` | ✓✓ 已读 | 蓝色双勾 |
| `played` | 已播放 | 蓝色已完成状态 |
| `failed` | 发送失败 | 红色错误状态 |

未知或缺失状态不显示，避免把未识别的 provider 值解释成已送达。

现有“刷新”操作重新加载会话时，自然取得最新状态；不新增定时器、SSE 或 WebSocket。

## 错误处理

- Webhook 尚未到达时保留初始状态。
- 找不到对应消息 ID 时仅不显示状态，不影响会话加载。
- `failed` 显示失败状态，但不自动重试，避免重复发送人工消息。
- 前端只渲染固定白名单状态，任何异常值均隐藏并安全转义其他字段。

## 测试

- 数据库测试验证人工会话消息能关联到对应的最新发送状态。
- 数据库测试验证不同 Bot、会话、provider 或 channel account 的同名消息 ID 不会串联。
- 保留并扩展状态单调推进测试，覆盖重复及乱序回执。
- 前端静态或单元测试验证六种文案、`read` 蓝色样式、`failed` 错误样式和未知状态隐藏。
- 服务端接口测试或边界测试验证会话响应携带状态字段。

## 验收标准

1. 人工发送成功后，消息气泡显示 Whapi 初始状态。
2. Whapi 回调 `delivered` 或 `read` 后，点击现有“刷新”即可看到新状态。
3. 页面不产生后台轮询请求。
4. 乱序或重复回调不会让状态倒退。
5. 没有 `read` 回执时，页面不宣称对方未读。
6. 既有 AI 消息和历史消息显示不受影响。
