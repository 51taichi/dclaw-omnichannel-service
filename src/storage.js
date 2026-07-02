import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function appendJsonLine(fileName, payload) {
  await ensureDataDir();
  const record = {
    createdAt: new Date().toISOString(),
    ...payload
  };
  await fs.appendFile(
    path.join(dataDir, fileName),
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
  return record;
}

export async function readJsonLines(fileName, limit = 50) {
  try {
    const content = await fs.readFile(path.join(dataDir, fileName), "utf8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
