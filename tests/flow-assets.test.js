import test from "node:test";
import assert from "node:assert/strict";
import {
  filterConfiguredCollectedDataPatch,
  listConfiguredFlowCollectFields
} from "../src/flow-assets.js";

const flow = {
  machine: {
    nodes: [
      { id: "node_1", collectFields: [" 姓名 ", "手机", ""] },
      { id: "node_2", collectFields: ["手机", "地区"] },
      { id: "node_3", collectFields: ["预约时间"] }
    ]
  },
  session: {
    collectedData: {
      姓名: "张三",
      地区: ""
    }
  }
};

test("lists every configured asset field across task nodes in stable order", () => {
  assert.deepEqual(
    listConfiguredFlowCollectFields(flow),
    ["姓名", "手机", "地区", "预约时间"]
  );
});

test("filters Agent asset patches to configured nonempty values", () => {
  assert.deepEqual(
    filterConfiguredCollectedDataPatch({
      flow,
      patch: {
        姓名: "李四",
        手机: "18570860666",
        地区: "北京",
        预约时间: "明天下午",
        未配置字段: "不能写入",
        空值: "",
        手机备注: null
      }
    }),
    {
      姓名: "李四",
      手机: "18570860666",
      地区: "北京",
      预约时间: "明天下午"
    }
  );
});

test("legacy backfill fills missing assets without overwriting collected values", () => {
  assert.deepEqual(
    filterConfiguredCollectedDataPatch({
      flow,
      patch: {
        姓名: "李四",
        手机: "18570860666",
        地区: "北京"
      },
      fillOnlyMissing: true
    }),
    {
      手机: "18570860666",
      地区: "北京"
    }
  );
});
