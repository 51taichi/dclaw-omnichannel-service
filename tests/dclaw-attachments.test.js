import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentReply } from "../src/dclaw.js";

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

test("parseAgentReply preserves only structured sources returned by the agent", () => {
  const parsed = parseAgentReply(JSON.stringify({
    reply: "有的，我把工厂视频发你",
    sources: [
      {
        type: "experience",
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
      type: "experience",
      name: "视频资料索取与实力背书回应",
      reason: "命中工厂视频 URL"
    }
  ]);
});
