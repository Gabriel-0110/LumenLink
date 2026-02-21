import { customActionProvider, WalletProvider } from "@coinbase/agentkit";
import { LumenlinkActionProviderActionSchema } from "./schemas";
import { z } from "zod";

/**
 * Creates a LumenlinkActionProviderActionProvider action provider.
 * To create multiple actions, pass in an array of actions to createActionProvider.
 */
export const lumenlinkActionProviderActionProvider = () =>
  customActionProvider<WalletProvider>({
    name: "lumenlink-action-provider_action",
    description: `This tool will perform a LumenlinkActionProviderActionProvider operation.`,
    schema: LumenlinkActionProviderActionSchema,
    invoke: async (wallet: WalletProvider, args: z.infer<typeof LumenlinkActionProviderActionSchema>) => {
      try {
        // Do work here
        return `Successfully performed lumenlink-action-provider_action and returned the response`;
      } catch (error) {
          return `Error performing lumenlink-action-provider_action: Error: ${error}`;
        }
      },
  });
