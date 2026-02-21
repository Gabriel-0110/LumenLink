import "dotenv/config";
import { CdpClient } from "@coinbase/cdp-sdk";
import fs from "node:fs";

const ENV_FILES = [
  ".env",
  "agents/coinbase/lumenlink-agent/.env",
] as const;

function setOrAppendEnv(filePath: string, key: string, value: string): void {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const expression = new RegExp(`^${key}=.*$`, "m");
  const updated = expression.test(content)
    ? content.replace(expression, `${key}=${value}`)
    : `${content}${content.endsWith("\n") || content.length === 0 ? "" : "\n"}${key}=${value}\n`;
  fs.writeFileSync(filePath, updated, "utf8");
}

async function main() {
  const cdp = new CdpClient();
  const account = await cdp.evm.createAccount();

  for (const envFile of ENV_FILES) {
    setOrAppendEnv(envFile, "ADDRESS", account.address);
  }

  console.log(`Created EVM account: ${account.address}`);
  console.log("Updated ADDRESS in .env files.");
}

main().catch(error => {
  console.error("Failed to create EVM account:", error);
  process.exit(1);
});
