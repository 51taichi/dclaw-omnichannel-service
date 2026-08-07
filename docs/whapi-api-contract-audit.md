# Whapi.Cloud API 契约审计

审计日期：2026-08-07  
官方规范：Whapi.Cloud OpenAPI `1.8.7`  
规范地址：<https://panel.whapi.cloud/yaml/openapi.yaml>  
文档入口：<https://whapi.cloud/docs>

## 审计范围

本审计覆盖本项目当前实现、调用或订阅的全部 Whapi 能力。未被迁移计划使用的商品、订单、Newsletter、社区等 API 不属于当前适配器能力，不纳入实现范围。

## HTTP API 对照

| 能力 | 方法与路径 | 关键请求/响应契约 | 状态 |
| --- | --- | --- | --- |
| 健康检查 | `GET /health` | `status.text` 映射连接状态 | 已覆盖 |
| 获取设置 | `GET /settings` | 返回 Channel Settings | 已覆盖 |
| 更新设置 | `PATCH /settings` | Webhook、持久重试和媒体自动下载 | 已覆盖 |
| 发送文本 | `POST /messages/text` | `to`、`body`、可选 `mentions`、`quoted` | 已覆盖 |
| 发送图片 | `POST /messages/image` | `to`、`media`、可选 `caption`、`mentions` | 已覆盖 |
| 发送视频 | `POST /messages/video` | `to`、`media`、可选 `caption`、`mentions` | 已覆盖 |
| 发送音频 | `POST /messages/audio` | `to`、`media`，不发送无效 caption/mentions | 已覆盖 |
| 发送语音 | `POST /messages/voice` | `to`、`media`，不发送无效 caption/mentions | 已覆盖 |
| 发送文档 | `POST /messages/document` | `to`、`media`、可选 `caption`、`filename` | 已覆盖 |
| 获取聊天 | `GET /chats` | `count`、`offset`，返回 `chats` | 已覆盖 |
| 获取群列表 | `GET /groups` | `count`、`offset`，返回 `groups` | 已覆盖 |
| 获取群详情 | `GET /groups/{GroupID}` | 返回完整群资料和参与者 | 已覆盖 |
| 创建群 | `POST /groups` | `subject`、非空 `participants` | 已覆盖 |
| 添加群成员 | `POST /groups/{GroupID}/participants` | 非空 `participants` | 已覆盖 |

所有请求统一使用 `Authorization: Bearer <token>`，Token 不进入 URL、响应或普通日志。

## Webhook 模式

项目兼容官方三种模式中的两种实际输入形式：

- `body`：请求发送到基础 URL，正文包含 `event.type` 和官方字段 `event.method`；服务端兼容历史 `event.event`；
- `method`：事件类型附加到 URL，例如 `/messages`，HTTP 方法表达 `post/put/patch/delete`，正文不含 `event`。

当前 Channel 配置使用 `method`。服务端同时保留基础 URL，以兼容官方测试请求和以后切换到 `body` 模式。

## 已订阅事件与官方正文结构

| 事件 | 官方正文 | 系统行为 |
| --- | --- | --- |
| `messages.post` | `messages[]` | 新消息入库并进入私聊/群聊流程 |
| `messages.put` | `messages[]` | 消息更新按标准消息处理 |
| `messages.delete` | `messages_removed[]` 或 `messages_removed_all` | 可靠审计并安全完成；单条删除载荷没有 Chat ID，不伪造会话 |
| `statuses.post/put` | `statuses[]` | 更新发送、送达、已读、失败等状态 |
| `groups.post` | `groups[]` | 新群快照入库 |
| `groups.put` | `groups_participants[]` | 增加、移除、升为管理员、降级成员 |
| `groups.patch` | `groups_updates[].after_update` | 更新群资料和完整成员快照 |
| `users.post/delete` | `user` | 可靠接收，当前业务不生成会话事件 |
| `channel.post` | `health` | 更新 Channel 健康状态 |
| `channel.patch` | `qr` | 映射为需要重新授权 |

## 媒体

Channel 设置自动开启官方支持的 `media.auto_download`：

- `image`
- `audio`
- `voice`
- `video`
- `document`
- `sticker`

入站 Mapper 同时兼容 OpenAPI 中的 `gif`、`short` 和 `documentWithCaption` 消息类型。媒体链接仍是临时链接，需要由现有附件持久化流程及时转存。

## 可靠性约束

- Webhook 在返回成功前先持久化；
- 幂等键使用完整规范化回调载荷的 SHA-256；消息 ID、群 ID或更新后的群 ID仅作为可检索元数据；
- `callback_persist=true`，失败回调由 Whapi 重试；
- HTTP 401、429、5xx 分别映射认证失败、限流和临时供应商失败；
- 供应商错误正文和 Token 不写入业务错误对象。
