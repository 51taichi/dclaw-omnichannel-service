import assert from "node:assert/strict";
import test from "node:test";

test("validation options enable group confidentiality only when group context exists", async () => {
  const validationOptionsModule = await import(
    "../src/agent-response-validation-options.js"
  ).catch(() => null);

  assert.ok(
    validationOptionsModule?.buildAgentResponseValidationOptions,
    "validation option mapper must be available"
  );

  const groupOptions = validationOptionsModule.buildAgentResponseValidationOptions({
    metadata: {
      groupContext: { groupId: "g1" },
      requireReplyContent: true
    }
  });
  const privateOptions = validationOptionsModule.buildAgentResponseValidationOptions({
    metadata: { requireReplyContent: true }
  });

  assert.equal(groupOptions.forbidGroupContextDisclosure, true);
  assert.equal(privateOptions.forbidGroupContextDisclosure, false);
  assert.equal(groupOptions.requireReplyContent, true);
  assert.equal(privateOptions.requireReplyContent, true);
});
