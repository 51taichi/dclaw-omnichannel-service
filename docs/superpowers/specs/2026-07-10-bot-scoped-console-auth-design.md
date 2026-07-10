# Bot 独立解锁控制台设计

## 背景

当前控制台使用统一 `ADMIN_API_KEY` 作为页面操作密钥。只要知道这个密钥，用户就能操作所有 Bot，并能修改 Bot 绑定、状态机、会话、推送等配置。

新的目标是让控制台进入页面后直接展示所有 Bot，但每个 Bot 默认灰色锁定。普通员工只拿到自己负责 Bot 的密钥，解锁后只能操作该 Bot 的业务能力；管理员仍可使用全局管理员密钥解锁任意 Bot，并额外拥有配置和密钥管理能力。

## 权限模型

保留全局管理员密钥：

```text
ADMIN_API_KEY
```

每个 Bot 增加一个独立管理密钥，后端只保存 hash：

```text
bot_agent_bindings.access_key_hash
bot_agent_bindings.access_key_updated_at
```

不新增单独密码表。当前需求是“一个 Bot 一个独立密钥”，密钥属于 Bot 绑定配置的一部分。以后如果需要多员工、多角色、审计，再升级为独立 `bot_users` 表。

权限分为三类：

```text
public:
  可查看 Bot 基础列表，不需要密钥

bot:
  通过当前 Bot 独立密钥解锁，只能操作该 Bot 的业务功能

admin:
  通过 ADMIN_API_KEY 解锁当前 Bot，可操作该 Bot 的所有功能，并可修改该 Bot 密钥
```

## 前端体验

页面打开后直接调用公开接口加载 Bot 列表。列表中的 Bot 默认显示为灰色锁定状态。

点击锁定 Bot 时弹出解锁框：

```text
输入 Bot 密钥或管理员密钥
```

管理员和普通员工使用同一个解锁入口、同一个输入框。前端不提供“管理员登录”和“员工登录”两个入口；后端只根据输入密钥的匹配结果判断当前身份。

解锁成功后：

- 如果是 Bot 密钥，进入该 Bot 的业务工作台。
- 如果是管理员密钥，进入该 Bot 的管理员工作台。

普通员工视角：

- 不显示“配置”Tab。
- 不显示 Bot 绑定表单。
- 不显示修改 Bot 密钥按钮。
- 可以使用任务状态机、会话、推送、日志、文件上传等当前 Bot 的业务功能。

管理员视角：

- 显示“配置”Tab。
- 可以修改 Bot 绑定。
- 可以修改当前 Bot 的独立密钥。
- 可以使用所有业务功能。

## API 设计

新增公开 Bot 列表接口：

```http
GET /api/public/bots
```

返回非敏感字段：

```json
{
  "ok": true,
  "bots": [
    {
      "botId": "xxx",
      "botName": "客服小左",
      "agentId": "xzj_business_manager",
      "agentName": "湘左记招商经理",
      "enabled": true,
      "hasAccessKey": true
    }
  ]
}
```

新增 Bot 解锁接口：

```http
POST /api/bots/:botId/unlock
Content-Type: application/json

{
  "key": "用户输入的密钥"
}
```

如果密钥匹配当前 Bot 的 `access_key_hash`，返回：

```json
{
  "ok": true,
  "role": "bot",
  "token": "短期会话 token",
  "bot": {}
}
```

如果密钥匹配 `ADMIN_API_KEY`，返回：

```json
{
  "ok": true,
  "role": "admin",
  "token": "短期会话 token",
  "bot": {}
}
```

判断顺序为先匹配 `ADMIN_API_KEY`，再匹配当前 Bot 的 `access_key_hash`。如果管理员密钥和某个 Bot 密钥意外相同，按管理员身份处理。

后续控制台请求优先使用：

```http
x-bot-session-token: token
```

管理员兼容请求仍可使用：

```http
x-api-key: ADMIN_API_KEY
```

新增管理员修改当前 Bot 密钥接口：

```http
PUT /api/bots/:botId/access-key
Content-Type: application/json
x-bot-session-token: admin token

{
  "accessKey": "新密钥"
}
```

该接口仅允许管理员角色调用。

## 后端授权规则

新增授权辅助函数：

```text
assertBotAccess(req, botId)
assertAdminOrBotAccess(req, botId)
assertAdminAccess(req)
```

规则：

- `GET /api/public/bots` 不需要密钥。
- `GET /api/bots` 继续要求管理员权限，因为它包含完整绑定配置。
- `PUT /api/bots/:botId` 要求管理员权限。
- `PUT /api/bots/:botId/access-key` 要求管理员权限。
- 业务接口要求当前 Bot 的 bot/admin session。
- 如果接口操作指定 `botId`，token 中的 `botId` 必须一致。
- 管理员 token 可以操作当前解锁 Bot 的所有接口。

## Token 存储

第一版使用服务端内存 session：

```text
token -> { botId, role, expiresAt }
```

默认有效期建议 8 小时。服务重启后 token 失效，需要重新解锁。这个行为可接受，且避免增加额外会话表。

Token 使用 `crypto.randomUUID()` 或等价随机值生成，不能由 botId 推导。

## 数据迁移

启动时给 `bot_agent_bindings` 自动补列：

```sql
ALTER TABLE bot_agent_bindings ADD COLUMN access_key_hash TEXT;
ALTER TABLE bot_agent_bindings ADD COLUMN access_key_updated_at TEXT;
```

已有 Bot 初始没有独立密钥：

- 列表显示 `hasAccessKey=false`。
- 只有管理员能解锁并设置该 Bot 密钥。
- 普通 Bot 密钥为空时不能通过空密码解锁。

## 安全边界

- 不在数据库保存明文 Bot 密钥。
- Bot 列表公开接口不返回 DClaw API Key、OpenAPI API Key、回调密钥等敏感字段。
- 前端不长期保存 Bot 明文密钥，只保存短期 token。
- 普通员工不可见配置 Tab，避免误改 `botId`、`OpenAPI Public ID`、`DClaw Base URL`、`Agent API Key`。

## 测试计划

后端测试：

- 公开 Bot 列表不需要管理员密钥，且不返回敏感字段。
- Bot 密钥可解锁对应 Bot，返回 `role=bot`。
- 管理员密钥可解锁任意 Bot，返回 `role=admin`。
- Bot token 不能访问其他 Bot。
- Bot token 不能修改 Bot 绑定或 Bot 密钥。
- Admin token 可以修改当前 Bot 密钥。

前端测试或边界检查：

- 未解锁 Bot 显示锁定态。
- Bot 角色不显示配置 Tab。
- Admin 角色显示配置 Tab 和修改密钥按钮。
- 请求头从 `x-api-key` 切换为 `x-bot-session-token`。

## 非目标

第一版不实现员工账号、多角色、操作审计、token 持久化、找回密钥。管理员可以重置 Bot 密钥，但不能查看旧密钥明文。
