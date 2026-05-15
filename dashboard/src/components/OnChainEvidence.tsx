"use client";

const EXPLORER = process.env.NEXT_PUBLIC_MANTLE_EXPLORER ?? "https://mantlescan.xyz";

const CONTRACTS = [
  { name: "SpawnFactory", address: "0x94171e5D54792149E14fFa19197e3c17E263C740" },
  { name: "LineageRegistry", address: "0x0466c58d7955cFdfa9E2070077D2f5E26561b59E" },
  { name: "ChildAgent (impl)", address: "0xD2d79F4A19E0D77267aBe80d85c33630d0923F72" },
];

export function OnChainEvidence() {
  return (
    <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 mb-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-slate-400 mb-3">
        Verified On-Chain · Mantle Mainnet
      </p>
      {CONTRACTS.map((c) => (
        <div
          key={c.name}
          className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
        >
          <span className="text-sm font-mono text-slate-200">{c.name}</span>
          <a
            href={`${EXPLORER}/address/${c.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
          >
            {c.address.slice(0, 6)}…{c.address.slice(-4)} ↗
          </a>
        </div>
      ))}
    </div>
  );
}
