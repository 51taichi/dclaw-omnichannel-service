import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDclawAttachmentSourceRetryRequest,
  degradeAgentReply,
  getAgentReplySendabilityIssue,
  parseAgentReply
} from "../src/dclaw.js";

test("parseAgentReply preserves structured attachments from agent JSON", () => {
  const parsed = parseAgentReply(JSON.stringify({
    reply: "我发你一份资料哈",
    attachments: [
      {
        type: "video",
        url: "https://cdn.example.com/xzj/video.mp4",
        name: "招商介绍.mp4"
      },
      {
        type: "link",
        url: "https://pan.example.com/s/demo",
        title: "招商资料网盘"
      }
    ]
  }));

  assert.equal(parsed.reply, "我发你一份资料哈");
  assert.deepEqual(parsed.attachments, [
    {
      type: "video",
      url: "https://cdn.example.com/xzj/video.mp4",
      name: "招商介绍.mp4"
    },
    {
      type: "link",
      url: "https://pan.example.com/s/demo",
      title: "招商资料网盘"
    }
  ]);
});

test("getAgentReplySendabilityIssue rejects media attachments without a trusted source", () => {
  const parsed = parseAgentReply(JSON.stringify({
    reply: "我把客服二维码发给您",
    attachments: [
      {
        type: "image",
        url: "https://static.shenting666.com/customer_service_qrcode.jpg",
        name: "客服微信二维码"
      }
    ],
    sources: []
  }));

  const issue = getAgentReplySendabilityIssue(parsed);

  assert.equal(issue?.code, "untrusted_attachment_source");
  assert.deepEqual(issue.attachmentUrls, [
    "https://static.shenting666.com/customer_service_qrcode.jpg"
  ]);
});

test("getAgentReplySendabilityIssue accepts attachments backed by trusted sources", () => {
  const parsed = parseAgentReply(JSON.stringify({
    reply: "我把资料发您",
    attachments: [
      {
        type: "video",
        url: "https://static.shenting666.com/factory.mp4",
        name: "工厂视频.mp4"
      }
    ],
    sources: [
      {
        type: "enterprise_knowledge",
        name: "工厂视频资料",
        reason: "命中可发送视频 URL"
      }
    ]
  }));

  assert.equal(getAgentReplySendabilityIssue(parsed), null);
});

test("buildDclawAttachmentSourceRetryRequest asks agent to regenerate a self-contained reply", () => {
  const original = {
    message: "客户说：可以发客服微信吗？",
    metadata: { source: "worktool" }
  };

  const retry = buildDclawAttachmentSourceRetryRequest(original, {
    code: "untrusted_attachment_source",
    attachmentUrls: ["https://static.shenting666.com/customer_service_qrcode.jpg"]
  });

  assert.match(retry.message, /附件没有可信来源/);
  assert.match(retry.message, /整条回复必须重新生成/);
  assert.match(retry.message, /不要继续说“我发给您”/);
  assert.equal(retry.metadata.attachmentSourceRetry, true);
  assert.deepEqual(retry.metadata.invalidAttachmentUrls, [
    "https://static.shenting666.com/customer_service_qrcode.jpg"
  ]);
});

test("parseAgentReply accepts an isolated JSON markdown fence", () => {
  const parsed = parseAgentReply(`\`\`\`json
{
  "reply": "您好呀，欢迎咨询湘左记招商 😄",
  "attachments": []
}
\`\`\``);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.reply, "您好呀，欢迎咨询湘左记招商 😄");
});

test("parseAgentReply preserves only structured sources returned by the agent", () => {
  const parsed = parseAgentReply(JSON.stringify({
    reply: "有的，我把工厂视频发你",
    sources: [
      {
        type: "enterprise_knowledge",
        name: "视频资料索取与实力背书回应",
        reason: "命中工厂视频 URL"
      },
      {
        type: "",
        name: "空来源",
        reason: "应被过滤"
      }
    ]
  }));

  assert.deepEqual(parsed.sources, [
    {
      type: "enterprise_knowledge",
      name: "视频资料索取与实力背书回应",
      reason: "命中工厂视频 URL"
    }
  ]);
});

test("parseAgentReply handles adjacent JSON objects from duplicated agent output", () => {
  const first = {
    reply: "魔兮姐，我们暂时还没有整理好现成的宣传视频资料哦",
    attachments: [],
    sources: [
      {
        type: "enterprise_knowledge",
        name: "湘左记品牌加盟招商方案.pptx",
        reason: "提供门店参观建议"
      }
    ]
  };
  const duplicated = `${JSON.stringify(first)}${JSON.stringify({
    reply: "第二段不应该被原样发出",
    attachments: []
  })}`;

  const parsed = parseAgentReply(duplicated);

  assert.equal(parsed.valid, false);
  assert.equal(parsed.reply, "");
  assert.deepEqual(parsed.sources, []);
});

test("parseAgentReply rejects JSON with raw newlines inside string fields", () => {
  const raw = `{"reply":"不好意思呀，我们这边目前确实没有视频方面的资料😅

现在主要是文字和图片资料，比如招商方案、产品介绍这些。要不你先看看文字资料，有什么具体想了解的也可以问我～","attachments":[],"sources":[{"type":"enterprise_knowledge","name":"湘左记品牌加盟招商方案.pptx","reason":"确认是否有视频资源可用"}]}`;

  const parsed = parseAgentReply(raw);

  assert.equal(parsed.valid, false);
  assert.equal(parsed.reply, "");
  assert.deepEqual(parsed.sources, []);
});

test("parseAgentReply strips context compaction runtime artifacts", () => {
  const raw = JSON.stringify({
    reply: "🔄 Context compaction started... Context Status: 📝 107.0k / 131.1k (82%) 💬 77 msgs -> compact(69) + keep(8)🔄 Context compaction started... Context Status: 📝 107.0k / 131.1k (82%) 💬 77 msgs -> compact(69) + keep(8)✅ Context compaction completed! Context Status: 📝 19.7k / 131.1k (15%) 💬 8 msgs✅ Context compaction completed! Context Status: 📝 19.7k / 131.1k (15%) 💬 8 msgs老杨，确定不来吗？相信我，真的很精彩～😁"
  });

  const parsed = parseAgentReply(raw);

  assert.equal(parsed.reply, "老杨，确定不来吗？相信我，真的很精彩～😁");
});

test("parseAgentReply rejects unstructured internal execution text", () => {
  const parsed = parseAgentReply("收到，这是私聊首次添加好友的场景，我来处理。先检查会话记录和客户档案。");

  assert.equal(parsed.valid, false);
  assert.equal(parsed.reply, "");
});

test("parseAgentReply extracts a single valid JSON reply wrapped by prose", () => {
  const parsed = parseAgentReply('先检查客户档案。{"reply":"你好呀，很高兴认识你"}');

  assert.equal(parsed.valid, true);
  assert.equal(parsed.reply, "你好呀，很高兴认识你");
});

test("degradeAgentReply accepts plain customer-facing text as a last-resort reply", () => {
  const parsed = degradeAgentReply("您好呀，湘左记这边可以帮您了解加盟流程。");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.reply, "您好呀，湘左记这边可以帮您了解加盟流程。");
});

test("degradeAgentReply rejects internal execution text and malformed JSON-looking text", () => {
  const internal = degradeAgentReply("收到，这是私聊首次添加好友的场景，我来处理。先检查会话记录和客户档案。");
  const malformedJson = degradeAgentReply('{"reply":"你好呀"');

  assert.equal(internal.valid, false);
  assert.equal(internal.reply, "");
  assert.equal(malformedJson.valid, false);
  assert.equal(malformedJson.reply, "");
});
