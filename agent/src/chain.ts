import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const mantle = {
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mantle.xyz"] } },
  blockExplorers: { default: { name: "Mantlescan", url: "https://mantlescan.xyz" } },
} as const;

export const publicClient = createPublicClient({
  chain: mantle,
  transport: http(process.env.MANTLE_RPC ?? "https://rpc.mantle.xyz"),
});

export function getWalletClient(privateKey: `0x${string}`) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: mantle,
    transport: http(process.env.MANTLE_RPC ?? "https://rpc.mantle.xyz"),
  });
}
