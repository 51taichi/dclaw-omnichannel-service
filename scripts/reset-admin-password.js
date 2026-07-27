import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { initializeOrChangeAdminPassword } from "../src/admin-auth.js";

const terminal = readline.createInterface({ input, output });

try {
  const password = await terminal.question("请输入新的管理员密码：");
  const confirmation = await terminal.question("请再次输入管理员密码：");
  if (!password) throw new Error("管理员密码不能为空");
  if (password !== confirmation) throw new Error("两次输入的密码不一致");
  initializeOrChangeAdminPassword(password);
  output.write("管理员密码已更新。\n");
} catch (error) {
  output.write(`管理员密码更新失败：${error.message}\n`);
  process.exitCode = 1;
} finally {
  terminal.close();
}
