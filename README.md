# WorkTool Bot Service

这个项目用于把 WorkTool 机器人和 DClaw Agent 连接起来。它只做连接层，不写具体业务回复逻辑。

- 被动触发：企微里有人发消息，WorkTool 回调本服务。
- 主动触发：你的系统调用本服务，本服务再调用 WorkTool 主动发消息。
- 回调信息：WorkTool 把主动指令的执行结果回调给本服务。
- Agent 网关：根据 `botId -> DClaw agent` 配置，把消息转给对应 agent。

## 架构边界

```text
WorkTool / 企业微信
  -> worktool-bot-service
  -> DClaw Agent
  -> worktool-bot-service
  -> WorkTool / 企业微信
```

`worktool-bot-service` 负责：

```text
接收回调、识别 botId、维护会话、调用 Agent、发送回复、记录日志
```

DClaw Agent 负责：

```text
业务知识、回复逻辑、转人工规则、话术风格、工具调用
```

## 1. 准备环境

需要本机安装 Node.js 18 或更高版本。

```bash
cd "/Users/moxi/Desktop/codex space/agent create/worktool-bot-service"
npm install
cp .env.example .env
```

编辑 `.env`：

```bash
PORT=8765
HOST=0.0.0.0
ROBOT_ID=你的真实botid
WORKTOOL_BASE_URL=https://api.worktool.ymdyes.cn
PUBLIC_BASE_URL=https://你的公网域名
CALLBACK_SECRET=自己生成一串随机字符串
ADMIN_API_KEY=自己生成一串管理密钥
ADMIN_SESSION_TTL_HOURS=8
BOT_SESSION_TTL_HOURS=8
UPLOAD_MAX_MB=100
UPLOAD_ALLOWED_ORIGINS=https://你的外部应用域名
```

`PUBLIC_BASE_URL` 必须是 WorkTool 可以访问到的 HTTPS 地址。正式环境建议用服务器域名；本地联调用 ngrok、frp、Cloudflare Tunnel 都可以。
如果外部应用是在浏览器里直接调用上传接口，把它的页面 Origin 写入 `UPLOAD_ALLOWED_ORIGINS`；多个域名用英文逗号分隔。后端服务直连上传不需要配置跨域。

DClaw 调用默认 120 秒超时，超时或 DClaw 网关返回 `502/503/504` 会快速重试 1 次。Agent 回复格式不合规时，服务端会先尝试从返回文本中提取唯一 JSON；提取失败才发起一次短超时格式修复。如果最终仍失败，私聊会发送一条兜底提示，避免客户侧完全无响应：

```bash
DCLAW_AGENT_TIMEOUT_MS=120000
DCLAW_AGENT_FORMAT_RETRY_TIMEOUT_MS=30000
DCLAW_AGENT_MAX_ATTEMPTS=2
AGENT_FAILURE_FALLBACK_REPLY=刚刚这边有点卡，我稍后回复你哈
```

人工接手是服务端会话状态，不需要 WorkTool 做额外配置。控制台把某个私聊切到“人工接手”后，本服务仍会接收并保存 WorkTool 回调，也会把记录同步给 DClaw 作为历史，但不会再把 Agent 回复发送给客户；恢复 AI 后，新消息重新进入正常 Agent 回复链路。

节点激活用于私聊任务状态机：每个节点可以配置提醒话术，以及是否交给 Agent 美化。每条话术独立设置间隔和次数；话术按顺序推进；客户回复只取消当前倒计时；AI 回复重启当前未完成话术；节点变化会作废旧节点进度。无需选择触发时机：入口节点在新增好友后计时（这是首次计时）；后续计时以最后一条有效机器人消息的发送时间为准；所有启用激活且有话术的私聊节点在 AI 成功回复后计时。WorkTool 回调 `textType=22` 且 `type=105` 时，服务端会从 `friendName` 建立或重置到入口私聊会话；入口激活已配置时才会创建提醒任务。该路径不调用 Agent，也不会重复发送欢迎语。

企微系统欢迎语和 WorkTool `textType=22,type=105` 好友事件可能针对同一次添加先后到达。服务端会按 `botId + conversationKey` 在 30 秒内吸收第二个信号，只保留原始回调审计，不重复重置会话或创建入口激活任务；可通过 `FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS` 调整这个技术去重窗口。

超过信号去重窗口后，可选的业务重入冷却由 `FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES` 控制；代码默认不限制，`.env.example` 示例为 10 分钟。超过业务冷却后再次收到新增好友信号，会重新进入入口节点并重新启动首条激活话术。这个重入只重置状态机进度和 AI 接待状态，不会删除聊天记录或已收集的客户资产。

后台 worker 默认每 10 秒扫描一次到期任务；如果客户回复、人工接手、清空会话或节点变化，旧激活任务会自动失效。这个能力不需要重新上传 Agent，只要服务端和控制台更新即可。

```bash
ACTIVATION_WORKER_ENABLED=true
ACTIVATION_WORKER_INTERVAL_MS=10000
ACTIVATION_WORKER_BATCH_SIZE=20
ACTIVATION_WORKER_STALE_PROCESSING_MS=300000
ACTIVATION_SEND_DELAY_MS=500
ACTIVATION_MAX_CONCURRENT_AGENT_CALLS=2
```

## 2. 启动服务

```bash
npm run dev
```

看到下面输出就说明本地服务已启动：

```text
WorkTool bot service listening on http://0.0.0.0:8765
```

本地健康检查：

```bash
curl http://localhost:8765/health
```

## 3. 多 Bot / Agent 配置

第一版支持一个 `botId` 绑定一个 DClaw Agent。复制配置模板：

```bash
mkdir -p config
cp config/bots.example.json config/bots.json
```

编辑 `config/bots.json`：

```json
{
  "bots": [
    {
      "botId": "你的WorkTool botId",
      "botName": "A部门机器人",
      "agentId": "xzj_business_manager",
      "agentName": "A部门客服",
      "dclawBaseUrl": "https://你的dclaw域名",
      "dclawPublicId": "openapi_public_id",
      "agentApiKey": "qp_live_xxx",
      "enabled": true
    }
  ]
}
```

也可以用管理 API 写入：

```bash
curl -X PUT http://127.0.0.1:8765/api/bots/你的botId \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: 你的ADMIN_API_KEY' \
  -d '{
    "botName": "A部门机器人",
    "agentId": "xzj_business_manager",
    "agentName": "A部门客服",
    "dclawBaseUrl": "https://你的dclaw域名",
    "dclawPublicId": "openapi_public_id",
    "agentApiKey": "qp_live_xxx",
    "enabled": true
  }'
```

## 4. 本地暴露公网地址

如果你还没有服务器，可以临时用 ngrok：

```bash
ngrok http 8765
```

拿到类似这样的地址：

```text
https://xxxx.ngrok-free.app
```

把它写入 `.env`：

```bash
PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
```

然后重启服务。

## 5. 配置 WorkTool 回调

启动服务后执行：

```bash
curl -X POST http://localhost:8765/api/config/你的botId/message-callback
```

这个接口会把消息回调地址配置到 WorkTool：

```text
https://你的公网域名/worktool/你的botId/message-callback?secret=你的密钥
```

再执行：

```bash
curl -X POST http://localhost:8765/api/config/你的botId/command-callback
```

这个接口会把主动指令结果回调地址配置到 WorkTool：

```text
https://你的公网域名/worktool/你的botId/command-callback?secret=你的密钥
```

查看机器人信息：

```bash
curl http://localhost:8765/api/robot/你的botId
```

查看指令回调配置：

```bash
curl http://localhost:8765/api/callback-config/你的botId
```

## 6. 测试被动触发

在企微里给机器人发一条消息，几秒后查看本地日志：

```bash
curl http://localhost:8765/api/logs/incoming-messages
```

也可以直接看文件：

```bash
tail -f data/incoming-messages.jsonl
```

## 7. 测试主动发送

把 `客户昵称或群名` 换成真实接收者名称：

```bash
curl -X POST http://localhost:8765/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "botId": "你的botId",
    "targets": ["客户昵称或群名"],
    "content": "这是一条来自 WorkTool bot service 的测试消息"
  }'
```

成功后查看主动发送记录：

```bash
curl http://localhost:8765/api/logs/outgoing-commands
```

查看 WorkTool 主动指令结果回调：

```bash
curl http://localhost:8765/api/logs/command-callbacks
```

## 8. 真实环境部署建议

### Docker 部署

服务器上进入项目目录后：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
PORT=8765
HOST=0.0.0.0
ROBOT_ID=你的真实botid
WORKTOOL_BASE_URL=https://api.worktool.ymdyes.cn
PUBLIC_BASE_URL=https://worktool.deepmega.cn
CALLBACK_SECRET=自己生成一串随机字符串
ADMIN_API_KEY=自己生成一串管理密钥
BOTS_CONFIG_PATH=./config/bots.json
```

启动 Docker 服务：

```bash
docker compose up -d --build
```

检查服务：

```bash
docker ps
curl http://127.0.0.1:18765/health
```

### 非 Docker 部署

第一阶段也可以这样跑：

```bash
npm install --omit=dev
npm start
```

生产环境建议再加：

- 使用 PM2 或 systemd 守护进程。
- 使用 Nginx 反向代理 HTTPS 到本服务的 `3000` 端口。
- 把 `data/*.jsonl` 换成 MySQL、Postgres 或 MongoDB。
- 对 `/api/send` 增加你自己系统的鉴权，避免任何人都能调用你的机器人发消息。
- 主动发送加队列和限流，WorkTool 文档里接口频率限制约为 QPM 60。

Nginx 应代理到：

```text
http://127.0.0.1:18765
```

## 9. 管理后台与独立入口

后台页面和回调服务共用同一个容器和端口：

```text
全局管理员：https://worktool.deepmega.cn/admin/
员工入口：https://worktool.deepmega.cn/console/管理员设置的尾巴
```

首次升级启动时，服务会用 `.env` 的 `ADMIN_API_KEY` 初始化数据库中的唯一管理员密码。初始化完成后，管理员密码以数据库为准；后续修改 `.env` 不会覆盖它。管理员可以在 `/admin/` 的系统设置中修改密码，也可以在服务器执行：

```bash
npm run admin:reset-password
```

全局管理员页面负责：

```text
创建、停用和删除独立入口
设置 URL 尾巴和上下句口令
分配、移除或转移 Bot（一个 Bot 只能属于一个入口）
维护全部 Bot 和 Agent
修改唯一管理员密码
```

员工首次打开独立入口时，需要根据上半句输入下半句口令。验证成功会倒计时 3 秒进入，浏览器会保存 30 天入口会话。进入后只显示分配给该入口的 Bot，不会显示其他入口的数据。

每个 Bot 仍保持原有的独立密码和权限逻辑。Bot 默认是灰色锁定状态，点击 Bot 后输入“当前 Bot 独立密钥”或管理员密码：

- 输入 Bot 独立密钥：只解锁当前 Bot，不显示配置 Tab。
- 输入当前管理员密码：以管理员身份解锁当前 Bot，显示配置 Tab，并可以修改当前 Bot 独立密钥。
- 点击“上锁”会清除当前 Bot 的本地 token，恢复锁定态。

员工页面保持原有的会话、任务、标签、推送和日志能力。Agent 属于全局资源，因此 Agent 的新增、编辑和删除统一放在 `/admin/`，Bot 配置仍可选择已经维护好的 Agent。

### 现有环境升级步骤

1. 更新代码并重新构建容器，原有 Bot、会话、任务、标签和推送数据不会迁移或重建。
2. 打开 `/admin/`，使用升级前 `.env` 中的 `ADMIN_API_KEY` 登录。
3. 创建所需入口，设置自定义 URL 尾巴与上下句口令。
4. 将现有 Bot 分配到对应入口。分配只改变可见范围，不改 Bot 配置、密码或业务数据。
5. 把 `/console/自定义尾巴` 发给负责人或员工。

`/console` 和 `/console/` 会跳转到 `/admin/`，不再作为员工兼容入口。

员工页面支持：

```text
查看 bot 绑定
一键绑定 WorkTool 消息回调和指令回调
配置调试自动回复的开关、触发词和回复内容
查看最近消息、会话、Agent 调用、指令回调
```

## 10. 当前接口说明

本服务提供：

```text
GET  /health
POST /worktool/:botId/message-callback
POST /worktool/:botId/command-callback
POST /api/send
POST /api/uploads
GET  /api/bots
PUT  /api/bots/:botId
POST /api/config/:botId/message-callback
POST /api/config/:botId/command-callback
GET  /api/robot/:botId
GET  /api/callback-config/:botId
GET  /api/logs/incoming-messages
GET  /api/logs/outgoing-commands
GET  /api/logs/command-callbacks
GET  /api/logs/agent-invocations
GET  /api/logs/conversations
```

其中 `/worktool/*` 是给 WorkTool 调用的公网回调接口，`/api/*` 是给你自己使用的管理和测试接口。

### 上传接口给外部应用调用

`POST /api/uploads?botId=你的botId` 使用 `multipart/form-data`，文件字段名必须是 `file`，请求头带当前 Bot 的 `x-bot-session-token` 或管理员 `x-api-key: 你的ADMIN_API_KEY`。`botId` 必填，上传文件会保存到该 Bot 的独立缓存目录。默认最大上传 `100MB`，返回的 `file.url` 是公网可访问地址，可直接作为媒体消息的 `fileUrl`。

浏览器端示例：

```js
const form = new FormData();
form.append("file", file);

const botId = "你的botId";
const response = await fetch(`https://你的公网域名/api/uploads?botId=${encodeURIComponent(botId)}`, {
  method: "POST",
  headers: {
    "x-api-key": "你的ADMIN_API_KEY"
  },
  body: form
});

const data = await response.json();
if (!response.ok || data.ok === false) {
  throw new Error(data.message || `HTTP ${response.status}`);
}

console.log(data.file.url);
```
