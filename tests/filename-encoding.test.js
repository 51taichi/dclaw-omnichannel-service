import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUploadedFilename } from "../src/filenames.js";
import { buildRawMediaCommand } from "../src/worktool.js";

test("normalizeUploadedFilename restores UTF-8 names decoded as latin1", () => {
  const mojibake = Buffer.from("槟榔招商资料_PRD_v1.0.pdf", "utf8").toString("latin1");

  assert.equal(normalizeUploadedFilename(mojibake), "槟榔招商资料_PRD_v1.0.pdf");
});

test("normalizeUploadedFilename keeps normal ASCII and Chinese names", () => {
  assert.equal(normalizeUploadedFilename("report_v1.pdf"), "report_v1.pdf");
  assert.equal(normalizeUploadedFilename("湘左记加盟资料.pdf"), "湘左记加盟资料.pdf");
});

test("buildRawMediaCommand sends restored Chinese objectName", () => {
  const mojibake = Buffer.from("槟榔招商资料_PRD_v1.0.pdf", "utf8").toString("latin1");
  const command = buildRawMediaCommand({
    targets: ["魔兮"],
    fileUrl: "https://worktool.deepmega.cn/uploads/demo.pdf",
    objectName: mojibake,
    fileType: "file"
  });

  assert.equal(command.objectName, "槟榔招商资料_PRD_v1.0.pdf");
});
