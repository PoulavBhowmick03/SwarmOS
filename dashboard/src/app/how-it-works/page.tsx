import { Navbar } from "@/components/Navbar";
import Link from "next/link";

const steps = [
  {
    title: "1. Deploy",
    body: "Connect your wallet, deposit $10+ USDe, and your AI agent starts managing your position on Aave V3 on Mantle mainnet.",
  },
  {
    title: "2. Learn",
    body: "Your agent reads the failure history of every agent before it. It starts with specific constraints: what strategies failed, why, and by how much.",
  },
  {
    title: "3. Evolve",
    body: "If your agent underperforms, it's terminated. Its failures become lessons for the next agent. Every failure is permanently stored on Mantle — readable by anyone.",
  },
];

const faq = [
  {
    question: "Is my money safe?",
    answer:
      "Your USDe is held by your own wallet address and deposited into Aave V3 — the same protocol used by institutional DeFi. You can withdraw at any time.",
  },
  {
    question: "What does my agent actually do?",
    answer:
      "It supplies USDe to Aave V3 on Mantle to earn yield. It reads live APY data and decides when to supply, withdraw, or rebalance using Venice AI.",
  },
  {
    question: "Can I see every decision my agent makes?",
    answer:
      "Yes. Every decision hash is recorded on Mantle. Every termination post-mortem is on IPFS. Nothing is hidden.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <Navbar />
      <main className="dashboard-shell">
        <section className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(52,211,153,0.16),rgba(8,17,31,0.95)_36%,rgba(5,10,19,0.98))] p-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-emerald-300/75">
            Retail Agent Launcher
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            How It Works
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-200/75">
            Spawn Protocol turns public failure memory into a shared advantage. Retail users get
            the same lineage constraints as the institutional swarm.
          </p>
        </section>

        <section className="grid gap-5 md:grid-cols-3">
          {steps.map((step) => (
            <article
              key={step.title}
              className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6"
            >
              <h2 className="text-2xl font-semibold text-white">{step.title}</h2>
              <p className="mt-4 text-sm leading-7 text-slate-300/78">{step.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[28px] border border-white/10 bg-black/20 p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-slate-400">
            FAQ
          </p>
          <div className="mt-5 grid gap-4">
            {faq.map((item) => (
              <article key={item.question} className="border-t border-white/10 pt-4">
                <h2 className="text-lg font-semibold text-white">{item.question}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-300/78">{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/community"
            className="rounded-xl bg-emerald-500 px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-black hover:bg-emerald-400"
          >
            Deploy Agent
          </Link>
          <Link
            href="/lineage"
            className="rounded-xl border border-white/10 px-5 py-3 font-mono text-xs uppercase tracking-[0.18em] text-slate-100 hover:bg-white/5"
          >
            View Lineage
          </Link>
        </div>
      </main>
    </>
  );
}
