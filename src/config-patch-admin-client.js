const NOT_CONFIGURED_MESSAGE = "Codex Token service is not configured";
const UNAVAILABLE_MESSAGE = "Codex Token service is unavailable";

export class ConfigPatchAdminError extends Error {
  constructor(message, { status = 503, code = "CONFIG_PATCH_ADMIN_UNAVAILABLE" } = {}) {
    super(message);
    this.name = "ConfigPatchAdminError";
    this.status = status;
    this.code = code;
  }
}

export class ConfigPatchAdminClient {
  constructor({
    baseUrl = "",
    adminSecret = "",
    fetchImpl = globalThis.fetch
  } = {}) {
    this.baseUrl = String(baseUrl || "").trim();
    this.adminSecret = String(adminSecret || "").trim();
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(env = process.env) {
    return new ConfigPatchAdminClient({
      baseUrl: env.CONFIG_PATCH_ADMIN_BASE_URL,
      adminSecret: env.CONFIG_PATCH_ADMIN_SECRET
    });
  }

  listTokens() {
    return this.#request("internal/admin/v1/staff-tokens");
  }

  createToken(input = {}) {
    return this.#request("internal/admin/v1/staff-tokens", {
      method: "POST",
      body: {
        employeeName: input.employeeName,
        tokenName: input.tokenName,
        expiresAt: input.expiresAt ?? null
      }
    });
  }

  revokeToken(tokenId) {
    return this.#request(
      `internal/admin/v1/staff-tokens/${encodeURIComponent(String(tokenId))}/revoke`,
      { method: "POST" }
    );
  }

  rotateToken(tokenId) {
    return this.#request(
      `internal/admin/v1/staff-tokens/${encodeURIComponent(String(tokenId))}/rotate`,
      { method: "POST" }
    );
  }

  async #request(relativePath, { method = "GET", body } = {}) {
    if (!this.baseUrl || !this.adminSecret || typeof this.fetchImpl !== "function") {
      throw new ConfigPatchAdminError(NOT_CONFIGURED_MESSAGE, {
        code: "CONFIG_PATCH_ADMIN_NOT_CONFIGURED"
      });
    }

    const root = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const headers = {
      "X-Config-Patch-Admin-Secret": this.adminSecret
    };
    const options = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchImpl(new URL(relativePath, root).toString(), options);
    } catch {
      throw new ConfigPatchAdminError(UNAVAILABLE_MESSAGE);
    }
    if (!response.ok) {
      throw new ConfigPatchAdminError(UNAVAILABLE_MESSAGE);
    }
    try {
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid response");
      return data;
    } catch {
      throw new ConfigPatchAdminError(UNAVAILABLE_MESSAGE);
    }
  }
}
