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
```

`PUBLIC_BASE_URL` 必须是 WorkTool 可以访问到的 HTTPS 地址。正式环境建议用服务器域名；本地联调用 ngrok、frp、Cloudflare Tunnel 都可以。

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
      "agentId": "dclaw_agent_a",
      "agentName": "A部门客服",
      "agentApiUrl": "https://你的dclaw域名/api/agents/dclaw_agent_a/invoke",
      "agentApiKey": "",
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
    "agentId": "dclaw_agent_a",
    "agentName": "A部门客服",
    "agentApiUrl": "https://你的dclaw域名/api/agents/dclaw_agent_a/invoke",
    "agentApiKey": "",
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

## 9. 当前接口说明

本服务提供：

```text
GET  /health
POST /worktool/:botId/message-callback
POST /worktool/:botId/command-callback
POST /api/send
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
