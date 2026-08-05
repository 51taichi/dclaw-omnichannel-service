import path from "node:path";

export function resolveRuntimePaths({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.DATABASE_PATH) {
    const databasePath = path.resolve(cwd, env.DATABASE_PATH);
    return { dataDir: path.dirname(databasePath), databasePath };
  }
  const dataDir = path.resolve(cwd, env.DATA_DIR || "data");
  return {
    dataDir,
    databasePath: path.join(dataDir, "dclaw-omnichannel-service.sqlite")
  };
}
