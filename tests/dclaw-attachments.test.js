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
