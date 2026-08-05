import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server records readable inbound attachments with a visible placeholder", () => {
  assert.match(source, /import \{\s*inboundAttachmentPlaceholder\s*\} from "\.\/inbound-attachments\.js";/s);
  assert.match(
    source,
    /content:\s*message\.spoken\s*\|\|\s*message\.rawSpoken\s*\|\|\s*inboundAttachmentPlaceholder\(message\)\s*\|\|\s*""/
  );
  assert.match(source, /rawPayload:\s*message/);
});
