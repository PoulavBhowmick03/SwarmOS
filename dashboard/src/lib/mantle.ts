import type { ChildState, GenerationStat, SwarmEvent } from "@/types";
export type SwarmChildState = ChildState;
export type GenerationStats = GenerationStat;
export type { ChildState, GenerationStat, SwarmEvent };

export const MANTLE_EXPLORER_BASE = "https://mantlescan.xyz";
export const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787").replace(/\/$/, "");

export const CONTRACT_LINKS = {
  spawnFactory: process.env.NEXT_PUBLIC_SPAWN_FACTORY_ADDRESS || "",
  lineageRegistry: process.env.NEXT_PUBLIC_LINEAGE_REGISTRY_ADDRESS || "",
  erc8004Registry:
    process.env.NEXT_PUBLIC_ERC8004_IDENTITY_REGISTRY ||
    "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

export function explorerTx(hash?: string | null) {
  if (!hash) return "";
  return `${MANTLE_EXPLORER_BASE}/tx/${hash}`;
}

export function explorerAddress(address?: string | null) {
  if (!address) return "";
  return `${MANTLE_EXPLORER_BASE}/address/${address}`;
}

export function ipfsUrl(cid?: string | null) {
  if (!cid) return "";
  if (cid.startsWith("local:")) return "";
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}

export function formatAddress(value?: string | null) {
  if (!value) return "Unavailable";
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}

export function formatTime(value: string | number) {
  return new Date(value).toLocaleString();
}

export function childLabel(child: SwarmChildState) {
  return `${child.lineageKey}-v${child.generation}`;
}
