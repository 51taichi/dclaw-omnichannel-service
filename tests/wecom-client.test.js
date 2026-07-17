import assert from "node:assert/strict";
import test from "node:test";
import {
  WecomApiError,
  getWecomAccessToken,
  getWecomExternalContact,
  listWecomExternalContacts,
  maskSensitiveValue,
  summarizeExternalContactDetail
} from "../src/wecom.js";

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(data);
    }
  };
}

test("getWecomAccessToken requests token without exposing secret in result", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse({
      errcode: 0,
      errmsg: "ok",
      access_token: "token-123",
      expires_in: 7200
    });
  };

  const token = await getWecomAccessToken({
    corpId: "ww-demo",
    secret: "secret-value",
    fetchImpl
  });

  assert.equal(token.accessToken, "token-123");
  assert.equal(token.expiresIn, 7200);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /gettoken/);
  assert.match(requestedUrls[0], /corpid=ww-demo/);
  assert.match(requestedUrls[0], /corpsecret=secret-value/);
});

test("listWecomExternalContacts throws WecomApiError for trusted IP failures", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      errcode: 60020,
      errmsg: "not allow to access from your ip, hint: [demo]"
    });

  await assert.rejects(
    () =>
      listWecomExternalContacts({
        accessToken: "token-123",
        userId: "MoXi",
        fetchImpl
      }),
    (error) => {
      assert.ok(error instanceof WecomApiError);
      assert.equal(error.errcode, 60020);
      assert.match(error.message, /not allow to access from your ip/);
      return true;
    }
  );
});

test("getWecomExternalContact summarizes expected employee follow relationship", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      errcode: 0,
      errmsg: "ok",
      external_contact: {
        external_userid: "wm_external_123",
        name: "客户A",
        type: 1
      },
      follow_user: [
        {
          userid: "Other",
          remark: "旧备注",
          tags: [{ tag_name: "来源A" }]
        },
        {
          userid: "MoXi",
          remark: "客户A-18500000000",
          tags: [{ tag_name: "已留资" }]
        }
      ]
    });

  const detail = await getWecomExternalContact({
    accessToken: "token-123",
    externalUserId: "wm_external_123",
    fetchImpl
  });
  const summary = summarizeExternalContactDetail(detail, "MoXi");

  assert.equal(summary.externalUserId, "wm_external_123");
  assert.equal(summary.name, "客户A");
  assert.equal(summary.expectedUserId, "MoXi");
  assert.equal(summary.isFollowedByExpectedUser, true);
  assert.deepEqual(summary.followUsers, [
    {
      userid: "Other",
      remark: "旧备注",
      tagNames: ["来源A"]
    },
    {
      userid: "MoXi",
      remark: "客户A-18500000000",
      tagNames: ["已留资"]
    }
  ]);
});

test("maskSensitiveValue hides token-like values in logs", () => {
  assert.equal(maskSensitiveValue("abcdef1234567890"), "abcd********7890");
  assert.equal(maskSensitiveValue("short"), "*****");
  assert.equal(maskSensitiveValue(""), "");
});
