# WorkTool Bot Service

这个项目用于跑通 WorkTool 机器人的两类能力：

- 被动触发：企微里有人发消息，WorkTool 回调本服务。
- 主动触发：你的系统调用本服务，本服务再调用 WorkTool 主动发消息。
- 回调信息：WorkTool 把主动指令的执行结果回调给本服务。

## 1. 准备环境

需要本机安装 Node.js 18 或更高版本。

```bash
cd "/Users/moxi/Desktop/codex space/agent create/worktool-bot-service"
npm install
cp .env.example .env
```

编辑 `.env`：

```bash
PORT=3000
ROBOT_ID=你的真实botid
WORKTOOL_BASE_URL=https://api.worktool.ymdyes.cn
PUBLIC_BASE_URL=https://你的公网域名
CALLBACK_SECRET=自己生成一串随机字符串
```

`PUBLIC_BASE_URL` 必须是 WorkTool 可以访问到的 HTTPS 地址。正式环境建议用服务器域名；本地联调用 ngrok、frp、Cloudflare Tunnel 都可以。

## 2. 启动服务

```bash
npm run dev
```

看到下面输出就说明本地服务已启动：

```text
WorkTool bot service listening on http://localhost:3000
```

本地健康检查：

```bash
curl http://localhost:3000/health
```

## 3. 本地暴露公网地址

如果你还没有服务器，可以临时用 ngrok：

```bash
ngrok http 3000
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

## 4. 配置 WorkTool 回调

启动服务后执行：

```bash
curl -X POST http://localhost:3000/api/config/message-callback
```

这个接口会把消息回调地址配置到 WorkTool：

```text
https://你的公网域名/worktool/message-callback?secret=你的密钥
```

再执行：

```bash
curl -X POST http://localhost:3000/api/config/command-callback
```

这个接口会把主动指令结果回调地址配置到 WorkTool：

```text
https://你的公网域名/worktool/command-callback?secret=你的密钥
```

查看机器人信息：

```bash
curl http://localhost:3000/api/robot
```

查看指令回调配置：

```bash
curl http://localhost:3000/api/callback-config
```

## 5. 测试被动触发

在企微里给机器人发一条消息，几秒后查看本地日志：

```bash
curl http://localhost:3000/api/logs/incoming-messages
```

也可以直接看文件：

```bash
tail -f data/incoming-messages.jsonl
```

## 6. 测试主动发送

把 `客户昵称或群名` 换成真实接收者名称：

```bash
curl -X POST http://localhost:3000/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "targets": ["客户昵称或群名"],
    "content": "这是一条来自 WorkTool bot service 的测试消息"
  }'
```

成功后查看主动发送记录：

```bash
curl http://localhost:3000/api/logs/outgoing-commands
```

查看 WorkTool 主动指令结果回调：

```bash
curl http://localhost:3000/api/logs/command-callbacks
```

## 7. 真实环境部署建议

### Docker 部署

服务器上进入项目目录后：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
PORT=3000
ROBOT_ID=你的真实botid
WORKTOOL_BASE_URL=https://api.worktool.ymdyes.cn
PUBLIC_BASE_URL=https://worktool.deepmega.cn
CALLBACK_SECRET=自己生成一串随机字符串
```

启动 Docker 服务：

```bash
docker compose up -d --build
```

检查服务：

```bash
docker ps
curl http://127.0.0.1:3010/health
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

## 8. 当前接口说明

本服务提供：

```text
GET  /health
POST /worktool/message-callback
POST /worktool/command-callback
POST /api/send
POST /api/config/message-callback
POST /api/config/command-callback
GET  /api/robot
GET  /api/callback-config
GET  /api/logs/incoming-messages
GET  /api/logs/outgoing-commands
GET  /api/logs/command-callbacks
```

其中 `/worktool/*` 是给 WorkTool 调用的公网回调接口，`/api/*` 是给你自己使用的管理和测试接口。
