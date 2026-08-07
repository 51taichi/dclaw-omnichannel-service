# DClaw Omnichannel Service

面向 WhatsApp 的 DClaw 客服与销售服务。当前渠道由 Whapi.Cloud 提供，支持多 Bot、多 WhatsApp 账号、私聊、群聊、媒体、消息状态、主动触达、状态机、人工接管和群自动化。

本仓库是独立海外渠道服务，不提供 WorkTool、微信或企业微信兼容接口，也不能与旧服务共用数据库和数据目录。完整的架构边界与迁移记录见 [迁移计划](docs/whapi-cloud-channel-adapter-migration-plan.md)。

## 运行要求

- Node.js 22 或更高版本
- 可被 Whapi.Cloud 访问的 HTTPS 域名
- 每个 Bot 一个已连接的 Whapi Channel、Channel ID 和 API Token
- 可用的 DClaw Agent

## 本地启动

```bash
npm install
cp .env.example .env
openssl rand -hex 32
```

把生成值写入 `.env` 的 `CHANNEL_TOKEN_ENCRYPTION_KEY`，再至少配置：

```dotenv
PUBLIC_BASE_URL=https://whatsapp.example.com
CHANNEL_TOKEN_ENCRYPTION_KEY=生成的密钥
ADMIN_API_KEY=管理员初始密码
```

启动：

```bash
npm start
```

默认监听 `0.0.0.0:8765`。管理后台为 `/admin/`，员工工作区入口为 `/console/<workspace-slug>`。

## 配置 Whapi Bot

1. 登录 `/admin/`。
2. 先创建或确认 DClaw Agent。
3. 在 Bots 页面填写 Bot ID、名称、Agent、Whapi Channel ID 和 API Token。
4. Webhook Secret 可以留空，由系统生成；首次保存后只显示一次，应立即妥善保存。
5. 保存时系统自动把 Webhook 配置到 Whapi；随后点击“检查 Whapi 连接”。

系统为每个账号生成独立地址：

```text
POST /webhooks/whapi/:channelAccountId
```

Webhook 至少订阅消息新增、更新、删除，消息状态，以及群与 Channel 状态事件。Webhook Secret 只保存哈希，Whapi API Token 使用 `CHANNEL_TOKEN_ENCRYPTION_KEY` 加密后写入 SQLite，不会返回浏览器或写入普通日志。

## 主要接口

- `POST /webhooks/whapi/:channelAccountId`：Whapi Webhook
- `GET /health`：进程健康检查
- `GET /api/bots`：管理员读取 Bot 与渠道账号状态
- `PUT /api/bots/:botId`：保存 Bot、Whapi 账号并自动配置 Webhook
- `POST /api/bots/:botId/channel/health-check`：主动检查 Whapi 连接

业务接口需要管理员会话、工作区会话或 Bot 会话；不得将管理接口直接暴露为无认证公网 API。

## 数据与隔离

- SQLite 默认位于 `DATA_DIR`；也可用 `DATABASE_PATH` 指定完整路径。
- 一个控制台 Bot 对应一个 Whapi Channel。
- Token、Webhook Secret、会话、消息、标签、任务、群和 DClaw Session 均按 Bot/渠道账号隔离。
- Whapi Webhook 可能重试，接收链路按外部事件和消息 ID 幂等入库。
- Whapi 媒体保存期有限，需要长期展示的媒体由本服务及时转存。

## 私聊节点激活

WhatsApp 没有新增好友事件。系统在账号第一次收到某位客户的私聊消息时发现客户并进入入口节点；入口节点配置了激活话术时，从首次发现开始计时。之后每次 AI 成功回复都会重新锚定当前节点尚未完成的话术。每条话术可独立配置间隔和次数，客户回复会取消当前倒计时，节点变化会让旧节点任务失效。

## 测试

```bash
npm test
```

上线前还应使用真实 Whapi 测试账号完成私聊、群聊、媒体、引用、mention、消息状态、断线恢复和 Webhook 重试验收。

## 部署检查

- 使用全新数据库与数据目录，不挂载旧服务数据。
- `PUBLIC_BASE_URL` 是公网 HTTPS origin，且反向代理允许 Whapi POST。
- `CHANNEL_TOKEN_ENCRYPTION_KEY` 已持久化并备份；丢失后无法解密已保存 Token。
- 管理后台成功保存 Bot，并显示 Whapi Webhook 配置成功。
- 健康检查为 connected；收发消息和状态回执均已验证。
- 日志和监控中没有 API Token、Webhook Secret 或客户敏感媒体内容。

## 已确认出站消息回填

2026-08-07 确认有三条由其他 API 路径发出的 Whapi 出站消息已收到 Webhook、但未写入会话。部署包含出站 Webhook 对账的版本后，在服务容器内执行一次限定回填：

```bash
npm run backfill:outbound-webhooks -- \
  --bot-id whatsapp-sales-01 \
  --message-id 'Psq87jVFbilb.xs-wNID1VW9yQ' \
  --message-id 'PsqlbmrN6JN3Z0M-wFwD1VW9yQ' \
  --message-id 'PspJAVWgozw4Nyg-wOAD1VW9yQ'
```

首次成功执行应输出 `{"inserted":3,"existing":0,"ignored":0}`；再次执行应输出 `{"inserted":0,"existing":3,"ignored":0}`，不会产生重复气泡。随后在管理后台会话中点击“刷新”，三条内容应按 Whapi 原始发送时间出现。

## 回滚

部署前备份本服务 SQLite 和上传目录。应用回滚时保持原 `CHANNEL_TOKEN_ENCRYPTION_KEY`，回退应用版本并恢复匹配的数据库备份。不要把流量切回旧微信服务或复用旧服务数据库。
