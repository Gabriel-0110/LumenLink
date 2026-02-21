import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getMcpTools } from "@coinbase/agentkit-model-context-protocol";
import { CdpClient } from "@coinbase/cdp-sdk";
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

async function resolveSmartAccountAddress(params: {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  ownerAddress?: `0x${string}`;
  explicitAddress?: `0x${string}`;
}): Promise<`0x${string}` | undefined> {
  if (params.explicitAddress) {
    return params.explicitAddress;
  }

  if (!params.ownerAddress) {
    return undefined;
  }

  const cdp = new CdpClient({
    apiKeyId: params.apiKeyId,
    apiKeySecret: params.apiKeySecret,
    walletSecret: params.walletSecret,
  });

  const owner = params.ownerAddress.toLowerCase();
  const matches: `0x${string}`[] = [];
  let pageToken: string | undefined;

  do {
    const page = await cdp.evm.listSmartAccounts({ pageToken });
    for (const account of page.accounts) {
      const hasOwner = account.owners.some(address => address.toLowerCase() === owner);
      if (hasOwner) {
        matches.push(account.address as `0x${string}`);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length > 1) {
    console.warn(
      `Found ${matches.length} smart wallets for owner ${params.ownerAddress}. Using ${matches[0]}. Set ADDRESS to override.`,
    );
  }

  return matches[0];
}

async function createAgentKit(): Promise<AgentKit> {
  const apiKeyId = getRequiredEnv("CDP_API_KEY_ID");
  const rawApiKeySecret = getRequiredEnv("CDP_API_KEY_SECRET");
  const normalizedApiKeySecret = rawApiKeySecret.includes("\\n")
    ? rawApiKeySecret.replace(/\\n/g, "\n")
    : rawApiKeySecret;
  const walletSecret = getRequiredEnv("CDP_WALLET_SECRET");
  const ownerAddress = process.env.OWNER_ADDRESS as `0x${string}` | undefined;
  const explicitAddress = process.env.ADDRESS as `0x${string}` | undefined;
  const smartWalletAddress = await resolveSmartAccountAddress({
    apiKeyId,
    apiKeySecret: normalizedApiKeySecret,
    walletSecret,
    ownerAddress,
    explicitAddress,
  });

  const walletProvider = await CdpSmartWalletProvider.configureWithWallet({
    apiKeyId,
    apiKeySecret: normalizedApiKeySecret,
    walletSecret,
    networkId: process.env.NETWORK_ID || "base-sepolia",
    address: smartWalletAddress,
    owner: ownerAddress,
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
