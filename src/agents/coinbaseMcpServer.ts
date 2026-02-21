import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getMcpTools } from "@coinbase/agentkit-model-context-protocol";
import {
  AgentKit,
  CdpSmartWalletProvider,
  cdpApiActionProvider,
  cdpSmartWalletActionProvider,
  erc20ActionProvider,
  walletActionProvider,
  wethActionProvider,
} from "@coinbase/agentkit";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function createAgentKit(): Promise<AgentKit> {
  const rawApiKeySecret = getRequiredEnv("CDP_API_KEY_SECRET");
  const normalizedApiKeySecret = rawApiKeySecret.includes("\\n")
    ? rawApiKeySecret.replace(/\\n/g, "\n")
    : rawApiKeySecret;

  const walletProvider = await CdpSmartWalletProvider.configureWithWallet({
    apiKeyId: getRequiredEnv("CDP_API_KEY_ID"),
    apiKeySecret: normalizedApiKeySecret,
    walletSecret: getRequiredEnv("CDP_WALLET_SECRET"),
    networkId: process.env.NETWORK_ID || "base-sepolia",
    address: process.env.ADDRESS as `0x${string}` | undefined,
    owner: process.env.OWNER_ADDRESS as `0x${string}` | undefined,
    rpcUrl: process.env.RPC_URL,
    paymasterUrl: process.env.PAYMASTER_URL,
    idempotencyKey: process.env.IDEMPOTENCY_KEY,
  });

  return AgentKit.from({
    walletProvider,
    actionProviders: [
      walletActionProvider(),
      erc20ActionProvider(),
      wethActionProvider(),
      cdpApiActionProvider(),
      cdpSmartWalletActionProvider(),
    ],
  });
}

async function main() {
  const agentKit = await createAgentKit();
  const { tools, toolHandler } = await getMcpTools(agentKit);

  const server = new Server(
    { name: "lumenlink-agentkit", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      return await toolHandler(request.params.name, request.params.arguments);
    } catch (error) {
      throw new Error(`Tool ${request.params.name} failed: ${String(error)}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(error => {
  console.error("Failed to start Coinbase MCP server:", error);
  process.exit(1);
});
