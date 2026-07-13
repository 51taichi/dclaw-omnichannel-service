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

  assert.equal(parsed.reply, first.reply);
  assert.deepEqual(parsed.sources, first.sources);
});
