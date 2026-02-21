import { z } from "zod";

/**
 * Input schema for LumenlinkActionProviderAction's lumenlink-action-provider_action action.
 */
export const LumenlinkActionProviderActionSchema = z
  .object({
    payload: z.string().describe("The payload to send to the action provider"),
  })
  .strip()
  .describe("Instructions for lumenlink-action-provider_action");
