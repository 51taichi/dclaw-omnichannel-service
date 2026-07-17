#!/usr/bin/env node
import "dotenv/config";
import {
  WecomApiError,
  getWecomAccessToken,
  getWecomExternalContact,
  listWecomExternalContacts,
  maskSensitiveValue,
  summarizeExternalContactDetail,
  summarizeExternalContactList
} from "../src/wecom.js";

function readEnv(name, fallbackNames = []) {
  for (const key of [name, ...fallbackNames]) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function requireEnv(name, fallbackNames = []) {
  const value = readEnv(name, fallbackNames);
  if (!value) {
    const allNames = [name, ...fallbackNames].join(" / ");
    throw new Error(`${allNames} is required`);
  }
  return value;
}

function printJson(title, data) {
  console.log(`\n## ${title}`);
  console.log(JSON.stringify(data, null, 2));
}

function explainWecomError(error) {
  if (!(error instanceof WecomApiError)) {
    return;
  }
  if (error.errcode === 60020) {
    console.error(
      "\nAction: add this server's outbound IP to the WeCom self-built app trusted IP list, then run again."
    );
  }
  if ([84014, 48002, 40014].includes(error.errcode)) {
    console.error(
      "\nAction: check that the app secret is correct and the app has external contact API permission."
    );
  }
}

async function main() {
  const corpId = requireEnv("WECOM_CORP_ID");
  const secret = requireEnv("WECOM_APP_SECRET", ["WECOM_CONTACT_SECRET", "WECOM_SECRET"]);
  const userId = requireEnv("WECOM_USER_ID");
  const requestedExternalUserId = readEnv("WECOM_EXTERNAL_USER_ID");
  const sampleLimit = Number(readEnv("WECOM_SAMPLE_LIMIT") || 3);

  printJson("config", {
    corpId,
    userId,
    secret: maskSensitiveValue(secret),
    externalUserId: requestedExternalUserId || "(auto sample from list)",
    sampleLimit
  });

  const token = await getWecomAccessToken({ corpId, secret });
  printJson("token", {
    accessToken: maskSensitiveValue(token.accessToken),
    expiresIn: token.expiresIn
  });

  const list = await listWecomExternalContacts({
    accessToken: token.accessToken,
    userId
  });
  const listSummary = summarizeExternalContactList(list);
  printJson("externalcontact/list", {
    total: listSummary.total,
    sampleExternalUserIds: listSummary.externalUserIds.slice(0, sampleLimit)
  });

  const externalUserId = requestedExternalUserId || listSummary.externalUserIds[0] || "";
  if (!externalUserId) {
    console.log("\nNo external_userid found for this userid. Mapping verification stopped.");
    return;
  }

  const detail = await getWecomExternalContact({
    accessToken: token.accessToken,
    externalUserId
  });
  printJson("externalcontact/get", summarizeExternalContactDetail(detail, userId));
}

main().catch((error) => {
  console.error(`\nVerification failed: ${error.message}`);
  explainWecomError(error);
  process.exitCode = 1;
});
