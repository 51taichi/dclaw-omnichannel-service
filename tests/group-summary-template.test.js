import assert from "node:assert/strict";
import test from "node:test";

import {
  isCumulativeSummaryVariable,
  parseGroupSummaryTemplate,
  renderGroupSummaryTemplate
} from "../src/group-summary-template.js";

test("classifies only explicitly cumulative white-language variables", () => {
  assert.equal(isCumulativeSummaryVariable({
    name: "累计上课次数",
    instruction: "从建群至今明确完成的课程"
  }), true);
  assert.equal(isCumulativeSummaryVariable({
    name: "本周上课次数",
    instruction: "本周明确完成的课程"
  }), false);
  assert.equal(isCumulativeSummaryVariable({
    name: "课程总数",
    instruction: "自建群以来明确完成的课程"
  }), true);
});

test("parses white-language variables and renders every token", () => {
  const parsed = parseGroupSummaryTemplate(
    "本周上课 {{本周上课次数（完成课程才计数；无记录填0；只输出数字）}} 次\n{{情况摘要}}"
  );

  assert.deepEqual(parsed.variables, [
    {
      name: "本周上课次数",
      instruction: "完成课程才计数；无记录填0；只输出数字"
    },
    { name: "情况摘要", instruction: "情况摘要" }
  ]);
  assert.equal(renderGroupSummaryTemplate(parsed, {
    本周上课次数: "3",
    情况摘要: "学习状态稳定"
  }), "本周上课 3 次\n学习状态稳定");
});

test("deduplicates identical variables but rejects malformed and conflicting ones", () => {
  assert.deepEqual(
    parseGroupSummaryTemplate("{{次数（只输出数字）}} / {{次数（只输出数字）}}")
      .variables,
    [{ name: "次数", instruction: "只输出数字" }]
  );
  assert.throws(() => parseGroupSummaryTemplate("{{}}"), /variable name/);
  assert.throws(() => parseGroupSummaryTemplate("{{次数（规则）}"), /unclosed/);
  assert.throws(() => parseGroupSummaryTemplate("{{次数（规则）额外）}}"), /nested|unbalanced/);
  assert.throws(() => parseGroupSummaryTemplate("{{次数（规则（额外））}}"), /nested|unbalanced/);
  assert.throws(
    () => parseGroupSummaryTemplate("{{次数（规则A）}} {{次数（规则B）}}"),
    /conflicting/
  );
});

test("never leaks unresolved template syntax", () => {
  const parsed = parseGroupSummaryTemplate("结果：{{次数（只输出数字）}}");
  assert.throws(() => renderGroupSummaryTemplate(parsed, {}), /missing variable value/);
  assert.throws(
    () => renderGroupSummaryTemplate(parsed, { 次数: "{{错误值}}" }),
    /unresolved template syntax/
  );
});

test("requires a useful template and bounded scalar values", () => {
  assert.throws(() => parseGroupSummaryTemplate("  "), /required/);
  assert.throws(
    () => renderGroupSummaryTemplate(
      parseGroupSummaryTemplate("{{摘要}}"),
      { 摘要: { text: "对象不允许" } }
    ),
    /scalar string/
  );
  assert.throws(
    () => renderGroupSummaryTemplate(
      parseGroupSummaryTemplate("{{摘要}}"),
      { 摘要: "x".repeat(4001) }
    ),
    /too long/
  );
});
