const DEFAULT_WECOM_BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin";

export class WecomApiError extends Error {
  constructor(message, { errcode = undefined, errmsg = "", status = undefined, data = undefined } = {}) {
    super(message);
    this.name = "WecomApiError";
    this.errcode = errcode;
    this.errmsg = errmsg;
    this.status = status;
    this.data = data;
  }
}

function getWecomBaseUrl() {
  return (process.env.WECOM_BASE_URL || DEFAULT_WECOM_BASE_URL).replace(/\/$/, "");
}

export function buildWecomUrl(path, params = {}) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${getWecomBaseUrl()}${normalizedPath}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function requestWecomJson(path, params, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(buildWecomUrl(path, params));
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new WecomApiError(`WeCom request failed: HTTP ${response.status}`, {
      status: response.status,
      data
    });
  }

  if (data && typeof data.errcode === "number" && data.errcode !== 0) {
    throw new WecomApiError(`WeCom API error ${data.errcode}: ${data.errmsg || ""}`.trim(), {
      errcode: data.errcode,
      errmsg: data.errmsg || "",
      data
    });
  }

  return data;
}

export async function getWecomAccessToken({ corpId, secret, fetchImpl } = {}) {
  const normalizedCorpId = String(corpId || "").trim();
  const normalizedSecret = String(secret || "").trim();
  if (!normalizedCorpId) {
    throw new Error("corpId is required");
  }
  if (!normalizedSecret) {
    throw new Error("secret is required");
  }

  const data = await requestWecomJson(
    "/gettoken",
    {
      corpid: normalizedCorpId,
      corpsecret: normalizedSecret
    },
    { fetchImpl }
  );

  if (!data.access_token) {
    throw new WecomApiError("WeCom token response missing access_token", { data });
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in
  };
}

export async function listWecomExternalContacts({ accessToken, userId, fetchImpl } = {}) {
  const normalizedAccessToken = String(accessToken || "").trim();
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedAccessToken) {
    throw new Error("accessToken is required");
  }
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  return requestWecomJson(
    "/externalcontact/list",
    {
      access_token: normalizedAccessToken,
      userid: normalizedUserId
    },
    { fetchImpl }
  );
}

export async function getWecomExternalContact({ accessToken, externalUserId, fetchImpl } = {}) {
  const normalizedAccessToken = String(accessToken || "").trim();
  const normalizedExternalUserId = String(externalUserId || "").trim();
  if (!normalizedAccessToken) {
    throw new Error("accessToken is required");
  }
  if (!normalizedExternalUserId) {
    throw new Error("externalUserId is required");
  }

  return requestWecomJson(
    "/externalcontact/get",
    {
      access_token: normalizedAccessToken,
      external_userid: normalizedExternalUserId
    },
    { fetchImpl }
  );
}

export function summarizeExternalContactList(data = {}) {
  const externalUserIds = Array.isArray(data.external_userid) ? data.external_userid : [];
  return {
    total: externalUserIds.length,
    externalUserIds
  };
}

export function summarizeExternalContactDetail(data = {}, expectedUserId = "") {
  const contact = data.external_contact || {};
  const followUsers = Array.isArray(data.follow_user)
    ? data.follow_user.map((follow) => ({
        userid: follow.userid || "",
        remark: follow.remark || "",
        tagNames: Array.isArray(follow.tags)
          ? follow.tags.map((tag) => tag.tag_name || tag.name || "").filter(Boolean)
          : []
      }))
    : [];
  const normalizedExpectedUserId = String(expectedUserId || "").trim();

  return {
    externalUserId: contact.external_userid || "",
    name: contact.name || "",
    type: contact.type,
    expectedUserId: normalizedExpectedUserId,
    isFollowedByExpectedUser: normalizedExpectedUserId
      ? followUsers.some((follow) => follow.userid === normalizedExpectedUserId)
      : false,
    followUsers
  };
}

export function maskSensitiveValue(value, visible = 4) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= visible * 2) {
    return "*".repeat(text.length);
  }
  return `${text.slice(0, visible)}${"*".repeat(8)}${text.slice(-visible)}`;
}
