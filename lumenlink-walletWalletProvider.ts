import { EvmWalletProvider, Network } from "@coinbase/agentkit";
import {
  TransactionRequest,
  ReadContractParameters,
  ReadContractReturnType,
  Abi,
  ContractFunctionName,
  ContractFunctionArgs,
  Hex,
} from "viem";

/**
 * LumenlinkWalletWalletProvider wallet provider.
 */
export class LumenlinkWalletWalletProvider extends EvmWalletProvider {
  /**
   * Get the address of the wallet.
   */
  getAddress(): string {
    throw new Error("Method not implemented.");
  }

  /**
   * Get the current network.
   */
  getNetwork(): Network {
    throw new Error("Method not implemented.");
  }

  /**
   * Get the name of the wallet provider.
   */
  getName(): string {
    return "lumenlink-wallet";
  }

  /**
   * Get the balance of the native asset.
   */
  async getBalance(): Promise<bigint> {
    throw new Error("Method not implemented.");
  }

  /**
   * Transfer the native asset.
   */
  async nativeTransfer(to: string, value: string): Promise<string> {
    throw new Error("Method not implemented.");
  }

  /**
   * Sign a message.
   */
  async signMessage(message: string | Uint8Array): Promise<Hex> {
    throw new Error("Method not implemented.");
  }

  /**
   * Sign typed data.
   */
  async signTypedData(typedData: any): Promise<Hex> {
    throw new Error("Method not implemented.");
  }

  /**
   * Sign a transaction.
   */
  async signTransaction(transaction: TransactionRequest): Promise<Hex> {
    throw new Error("Method not implemented.");
  }

  /**
   * Send a transaction.
   */
  async sendTransaction(transaction: TransactionRequest): Promise<Hex> {
    throw new Error("Method not implemented.");
  }

  /**
   * Wait for a transaction receipt.
   */
  async waitForTransactionReceipt(txHash: Hex): Promise<any> {
    throw new Error("Method not implemented.");
  }

  /**
   * Read a contract.
   */
  async readContract<
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "pure" | "view">,
    const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(params: ReadContractParameters<abi, functionName, args>): Promise<ReadContractReturnType<abi, functionName, args>> {
    throw new Error("Method not implemented.");
  }
}
