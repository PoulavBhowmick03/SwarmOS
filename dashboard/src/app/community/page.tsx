"use client";

import { Navbar } from "@/components/Navbar";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Address,
} from "viem";

type EthereumProvider = Parameters<typeof custom>[0];

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type LaunchStep = "idle" | "approving" | "spawning" | "success" | "error";

type CommunityCid = {
  cid: string;
  timestamp: string | null;
};

const COMMUNITY_LINEAGE_KEY = "community-swarm";
const SPAWN_FACTORY_ADDRESS = "0x94171e5D54792149E14fFa19197e3c17E263C740" as const;
const LINEAGE_REGISTRY_ADDRESS = "0x0466c58d7955cFdfa9E2070077D2f5E26561b59E" as const;
const USDE_ADDRESS = "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34" as const;
const USDE_DECIMALS = 18;
const IPFS_GATEWAY_BASE = "https://gateway.pinata.cloud/ipfs";

const mantle = defineChain({
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mantle.xyz"] },
  },
  blockExplorers: {
    default: { name: "Mantlescan", url: "https://mantlescan.xyz" },
  },
});

const publicClient = createPublicClient({
  chain: mantle,
  transport: http("https://rpc.mantle.xyz"),
});

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const spawnFactoryAbi = [
  {
    type: "function",
    name: "spawnChild",
    inputs: [
      { name: "lineageKey", type: "string" },
      { name: "generation", type: "uint256" },
      { name: "childWallet", type: "address" },
    ],
    outputs: [
      { name: "child", type: "address" },
      { name: "agentId", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ChildSpawned",
    inputs: [
      { indexed: true, name: "child", type: "address" },
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: false, name: "lineageKey", type: "string" },
      { indexed: false, name: "generation", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
] as const;

const lineageRegistryAbi = [
  {
    type: "function",
    name: "getLineage",
    inputs: [{ name: "lineageKey", type: "string" }],
    outputs: [{ name: "", type: "string[]" }],
    stateMutability: "view",
  },
] as const;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatAddress(address: string) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(value: string | number) {
  const date = typeof value === "number" && value < 10_000_000_000
    ? new Date(value * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function ipfsLink(cid: string) {
  if (!cid || cid.startsWith("local:")) return "";
  return `${IPFS_GATEWAY_BASE}/${cid}`;
}

async function readPostMortemTimestamp(cid: string): Promise<string | null> {
  const url = ipfsLink(cid);
  if (!url) return null;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const candidate =
      data?.terminatedAt ??
      data?.terminationTimestamp ??
      data?.timestamp ??
      data?.createdAt ??
      data?.completedAt ??
      data?.at;

    if (typeof candidate === "number" || typeof candidate === "string") {
      return formatTimestamp(candidate);
    }
  } catch {
    return null;
  }

  return null;
}

export default function CommunityPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState("10");
  const [step, setStep] = useState<LaunchStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [spawnedAgent, setSpawnedAgent] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [communityCids, setCommunityCids] = useState<CommunityCid[]>([]);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const [lineageLoading, setLineageLoading] = useState(true);

  const inFlight = step === "approving" || step === "spawning";
  const txUrl = txHash ? `https://mantlescan.xyz/tx/${txHash}` : "";
  const amountLabel = useMemo(() => {
    const parsed = Number(amount);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "10.00";
  }, [amount]);

  async function connectWallet() {
    setErrorMsg(null);

    if (!window.ethereum) {
      setErrorMsg("No wallet found. Install MetaMask or a Mantle-compatible wallet.");
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      }) as unknown;
      const [address] = Array.isArray(accounts) ? accounts : [];

      if (typeof address !== "string" || !isAddress(address)) {
        throw new Error("Wallet did not return a valid address.");
      }

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x1388" }],
        });
      } catch {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x1388",
            chainName: "Mantle",
            nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
            rpcUrls: ["https://rpc.mantle.xyz"],
            blockExplorerUrls: ["https://mantlescan.xyz"],
          }],
        });
      }

      setWalletAddress(address);
      setStep("idle");
    } catch (error) {
      setErrorMsg(getErrorMessage(error, "Wallet connection failed"));
      setStep("error");
    }
  }

  async function deployAgent() {
    if (!walletAddress || !window.ethereum || !isAddress(walletAddress)) return;

    setErrorMsg(null);
    setTxHash(null);
    setSpawnedAgent(null);

    const normalizedAmount = amount.trim();
    const amountParsed = Number(normalizedAmount);
    if (!Number.isFinite(amountParsed) || amountParsed < 10) {
      setErrorMsg("Minimum deposit is $10 USDe");
      setStep("error");
      return;
    }

    const account = walletAddress as Address;

    try {
      const depositAmount = parseUnits(normalizedAmount, USDE_DECIMALS);
      const balance = await publicClient.readContract({
        address: USDE_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      });

      if (balance < depositAmount) {
        setStep("error");
        setErrorMsg(`Wallet needs at least ${amountLabel} USDe on Mantle to deploy.`);
        return;
      }

      const walletClient = createWalletClient({
        account,
        chain: mantle,
        transport: custom(window.ethereum),
      });

      setStep("approving");
      const approveHash = await walletClient.writeContract({
        address: USDE_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [SPAWN_FACTORY_ADDRESS, depositAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setStep("spawning");
      const spawnHash = await walletClient.writeContract({
        address: SPAWN_FACTORY_ADDRESS,
        abi: spawnFactoryAbi,
        functionName: "spawnChild",
        args: [COMMUNITY_LINEAGE_KEY, BigInt(0), account],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: spawnHash });
      const spawnLogs = parseEventLogs({
        abi: spawnFactoryAbi,
        eventName: "ChildSpawned",
        logs: receipt.logs,
      });
      const child = spawnLogs[0]?.args.child;

      setSpawnedAgent(child ?? null);
      setTxHash(spawnHash);
      setStep("success");
    } catch (error) {
      setErrorMsg(getErrorMessage(error, "Transaction failed"));
      setStep("error");
    }
  }

  const loadCommunityLineage = useCallback(async () => {
    try {
      const cids = await publicClient.readContract({
        address: LINEAGE_REGISTRY_ADDRESS,
        abi: lineageRegistryAbi,
        functionName: "getLineage",
        args: [COMMUNITY_LINEAGE_KEY],
      });
      const resolved = await Promise.all(
        cids.map(async (cid) => ({
          cid,
          timestamp: await readPostMortemTimestamp(cid),
        }))
      );
      setCommunityCids(resolved);
      setLineageError(null);
    } catch (error) {
      setLineageError(getErrorMessage(error, "Failed to read community lineage"));
    } finally {
      setLineageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCommunityLineage();
    const interval = setInterval(() => void loadCommunityLineage(), 30_000);
    return () => clearInterval(interval);
  }, [loadCommunityLineage]);

  return (
    <>
      <Navbar />
      <main className="dashboard-shell">
        <section className="text-center py-16 px-4">
          <p className="text-xs font-mono text-green-400 uppercase tracking-widest mb-3">
            Community Swarm — Open to Everyone
          </p>
          <h1 className="text-4xl font-bold mb-4" style={{ fontFamily: "Syne, sans-serif" }}>
            Deploy Your AI Yield Agent
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
            Minimum $10 USDe. Your agent inherits failure constraints from every
            agent before it — including institutional swarm agents. Every decision,
            failure, and improvement is permanently recorded on Mantle.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  Retail Agent Launcher
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Launch with USDe</h2>
              </div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                Mantle Mainnet
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="grid gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  Deposit Amount
                </span>
                <div className="flex items-center rounded-2xl border border-white/10 bg-black/20 px-4">
                  <input
                    min="10"
                    step="0.01"
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="h-12 w-full bg-transparent text-lg font-semibold text-white outline-none"
                    disabled={inFlight}
                  />
                  <span className="font-mono text-xs text-slate-400">USDe</span>
                </div>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={inFlight}
                  className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 font-mono text-xs uppercase tracking-[0.18em] text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {walletAddress ? formatAddress(walletAddress) : "Connect Wallet"}
                </button>
                <button
                  type="button"
                  onClick={deployAgent}
                  disabled={!walletAddress || inFlight}
                  className="min-h-11 rounded-xl bg-emerald-500 px-4 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {step === "approving"
                    ? "Approving USDe"
                    : step === "spawning"
                    ? "Spawning Agent"
                    : "Deploy Agent"}
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-300/80">
              The user address becomes both parent and child wallet. The clone is enrolled under
              <span className="font-mono text-emerald-300"> community-swarm</span>, so its successors
              inherit the same public failure memory as the institutional swarm.
            </div>

            {step === "success" ? (
              <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-300">
                  Your agent is live!
                </p>
                <div className="mt-3 break-all text-sm text-white">
                  Clone address: <span className="font-mono text-emerald-200">{spawnedAgent ?? "Pending log decode"}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-200/78">
                  Your agent is now part of the Community Swarm. It will inherit failure
                  constraints from every terminated agent before it.
                </p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs">
                  {txUrl ? (
                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-white/10 px-3 py-2 font-mono text-blue-300 hover:bg-white/5"
                    >
                      Mantlescan spawn transaction
                    </a>
                  ) : null}
                  <Link
                    href="/lineage"
                    className="rounded-lg border border-white/10 px-3 py-2 font-mono text-emerald-300 hover:bg-white/5"
                  >
                    Track all community agents
                  </Link>
                </div>
              </div>
            ) : null}

            {errorMsg ? (
              <div className="mt-5 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
                {errorMsg}
              </div>
            ) : null}
          </div>

          <div className="rounded-[26px] border border-white/10 bg-black/20 p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-slate-400">
              BGA Ethos
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              Institutional strategy access, retail minimum.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300/78">
              Community agents use the same SpawnFactory, LineageRegistry, Venice reasoning path,
              and Aave V3 USDe strategy surface. The difference is the minimum entry point:
              a user can start with $10 USDe instead of operating a full parent swarm.
            </p>
            <div className="mt-6 grid gap-3">
              {[
                ["Open memory", "Every post-mortem is public IPFS evidence."],
                ["Open execution", "Every spawn and recall is visible on Mantle."],
                ["Open learning", "Retail agents inherit the same failure constraints."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300">
                    {title}
                  </div>
                  <div className="mt-2 text-sm text-slate-300/78">{body}</div>
                </div>
              ))}
            </div>
            <Link
              href="/how-it-works"
              className="mt-5 inline-flex rounded-xl border border-white/10 px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-slate-100 hover:bg-white/5"
            >
              How it works
            </Link>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-slate-400">
                Community Swarm Feed
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                Termination Memory
              </h2>
            </div>
            <div className="font-mono text-xs text-slate-500">
              Polls LineageRegistry every 30s
            </div>
          </div>

          {lineageError ? (
            <div className="mt-5 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
              {lineageError}
            </div>
          ) : null}

          {!lineageLoading && communityCids.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/15 bg-black/15 p-8 text-center text-sm text-slate-300/72">
              No community agents yet. Be the first to deploy.
            </div>
          ) : null}

          {communityCids.length > 0 ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {communityCids.map((entry, index) => (
                <article
                  key={`${entry.cid}-${index}`}
                  className="rounded-2xl border border-white/10 bg-black/20 p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">
                        Community Agent
                      </p>
                      <h3 className="mt-2 text-base font-semibold text-white">
                        Termination #{index + 1}
                      </h3>
                    </div>
                    <span className="rounded-full bg-rose-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-rose-300">
                      Post-mortem
                    </span>
                  </div>
                  <div className="mt-4 break-all font-mono text-xs text-slate-400">
                    {entry.cid}
                  </div>
                  <div className="mt-3 text-xs text-slate-500">
                    Timestamp of termination: {entry.timestamp ?? "Unavailable in post-mortem"}
                  </div>
                  {ipfsLink(entry.cid) ? (
                    <a
                      href={ipfsLink(entry.cid)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex rounded-lg border border-white/10 px-3 py-2 font-mono text-xs text-blue-300 hover:bg-white/5"
                    >
                      IPFS post-mortem
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}
