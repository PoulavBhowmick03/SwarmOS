# SwarmOS — 40-Hour Build Plan

**Hackathon window**: May 8 (kickoff) → May 10, 8:00 AM UTC (1:30 PM IST)
**Submission deadline**: Sunday May 10, 8:00 AM UTC = 1:30 PM IST
**Hard stop for code**: Saturday May 10, 6:00 AM UTC = 11:30 AM IST (leave 2 hrs for README, video, submission)

---

## Parallel Workstreams

You're running 2x Claude + 1x Codex in parallel. Assign like this:

| Instance | Owns |
|---|---|
| **Claude A** | Anchor program (Rust) — all on-chain logic |
| **Claude B** | Dashboard + ElevenLabs + x402 client + LI.FI widget |
| **Codex** | Monorepo scaffold, agent-runtime orchestrator, scoring oracle server, deployment scripts |
| **You** | Integration, testing on devnet, README, demo video, submission |

---

## Hour-by-Hour Plan

### BLOCK 1 — Hours 0–2: Scaffold Everything
**You + Codex**

- [ ] Fire Codex with the monorepo prompt (see `codex-prompt.md`)
- [ ] While Codex works: create GitHub repo (`PoulavBhowmick03/SwarmOS`), set to public
- [ ] Claim Noah AI credits on Dev3Pack dashboard (5M credits)
- [ ] Claim RPC pack from dashboard (use for devnet RPC)
- [ ] Set up `.env` template: `ANCHOR_WALLET`, `RPC_URL`, `ELEVENLABS_API_KEY`, `LIFI_API_KEY`, `OPENAI_API_KEY` (or Anthropic), `X402_FACILITATOR_URL`

**Deliverable**: Monorepo structure exists, Anchor program compiles (even empty), Next.js boots.

---

### BLOCK 2 — Hours 2–10: Anchor Program Core
**Claude A** (with your oversight)

Priority order:
1. `Swarm` account + `initialize_swarm` instruction
2. `Agent` account + `spawn_agent` instruction  
3. `LineageMemory` account + write on terminate
4. `submit_score` instruction
5. `evaluate_and_prune` instruction (terminates below-threshold agents, writes lineage)
6. `respawn_successor` instruction (reads lineage PDAs, includes lineage_hash in new Agent)

**Testing**: After each instruction, write a basic Anchor test in TypeScript. Run `anchor test` on devnet.

**Checkpoint Hour 10**: `initialize_swarm` + `spawn_agent` + `terminate_agent` + `lineage_memory` write all working on devnet. This is the MVP core. Everything else is additive.

---

### BLOCK 3 — Hours 2–10 (parallel): Agent Runtime + Scoring Oracle
**Codex** (runs same time as Block 2)

- ParentAgent class: `spawnChildren(n)`, `runEvaluationCycle()`, `respawnSuccessors()`
- ChildAgent class: `executeTask(taskPrompt, lineageContext)`, `submitScore(result)`
- ChildAgent calls Claude API with task prompt + injected lineage failures
- ScoringOracle Express server: POST `/evaluate` endpoint with x402 middleware
- x402 middleware using `@coinbase/x402-express` on Solana devnet USDC
- ChildAgent x402 client: uses `@coinbase/x402-axios` to pay before each oracle call

**Checkpoint Hour 10**: One full cycle runs end-to-end in Node.js (even if not connected to Anchor yet). Agent executes task, pays x402, gets scored, result returned.

---

### BLOCK 4 — Hours 10–16: Wire Runtime to Anchor
**You + Claude A**

- Connect agent-runtime to the deployed Anchor program
- ParentAgent calls `spawn_agent` instruction when spawning a child
- ScoringOracle calls `submit_score` instruction after evaluation
- ParentAgent calls `evaluate_and_prune` after all scores submitted
- ParentAgent reads `LineageMemory` PDAs before calling `respawn_successor`
- Full cycle test on devnet: spawn 3 agents → score → terminate 1 → write lineage → respawn successor with lineage → verify lineage_hash on-chain

**Checkpoint Hour 16**: Full Darwinian cycle working on devnet. This is your demo core. **Protect this checkpoint.**

---

### BLOCK 5 — Hours 16–24: Dashboard
**Claude B** (runs parallel to Block 4 from Hour 10)

Next.js app with:
- `SwarmVisualizer`: D3.js or React-force-graph tree showing agents, green = survived, red = terminated, connecting lines show parent/child lineage
- `AgentCard`: shows agent_id, generation, score, status, task excerpt
- `LineagePanel`: shows failure memory entries read from chain
- Real-time updates: poll Anchor program every 5 seconds or use Solana websocket subscription on `Agent` account changes
- `VoiceNarrator`: ElevenLabs TTS triggered on each lifecycle event (spawn, score, terminate, respawn)
- `FundSwarm` button: opens LI.FI widget for cross-chain USDC deposit to Swarm treasury PDA

**Checkpoint Hour 24**: Dashboard renders agents in real-time from devnet. Voice narration fires on events. LI.FI widget opens and shows routes.

---

### BLOCK 6 — Hours 24–28: x402 Polish + LI.FI Integration
**You + Claude B**

- x402: confirm payment flow works end-to-end on Solana devnet USDC. Add a `/payments` log endpoint on ScoringOracle so you can show payment history in dashboard.
- LI.FI: test actual cross-chain quote from ETH → Solana USDC using LI.FI SDK. Display estimated arrival time + fees in dashboard.
- Stress test: run a 5-agent swarm, 2 generations, confirm lineage is written and read correctly.

---

### BLOCK 7 — Hours 28–34: ElevenLabs + Demo Prep
**You + Claude B**

- Fine-tune ElevenLabs voice lines. Pick a voice ID (recommend "Adam" or "Daniel" — authoritative narrator tone).
- Add audio queue so voice lines don't overlap.
- Deploy ScoringOracle to Railway or Render (needs to be live for demo).
- Deploy Next.js dashboard to Vercel.
- Deploy Anchor program to devnet (get program ID).
- Update README with contract addresses.
- Run full demo flow once end-to-end.

---

### BLOCK 8 — Hours 34–38: README + Demo Video
**You**

README checklist:
- [ ] Project name + tagline
- [ ] What problem it solves (1 paragraph)
- [ ] Architecture diagram (simple ASCII or image)
- [ ] How Darwinian memory works (the key differentiator)
- [ ] x402 integration section
- [ ] LI.FI integration section
- [ ] ElevenLabs integration section
- [ ] Contract deployment addresses (devnet)
- [ ] Setup instructions (`npm install`, `anchor build`, `anchor deploy`, env vars)
- [ ] Demo video link
- [ ] Live demo link

Demo video (<3 min) script:
1. 0:00–0:20: What is SwarmOS (voiceover + dashboard)
2. 0:20–0:50: Spawn 5 agents, show them on the visualizer
3. 0:50–1:20: Agents execute tasks, pay x402, get scored — show oracle payment log
4. 1:20–1:50: 2 agents terminated — voice narration fires, LineageMemory written on-chain
5. 1:50–2:20: Respawn successors — show lineage context injected into prompt
6. 2:20–2:50: LI.FI cross-chain fund flow (show from ETH side)
7. 2:50–3:00: "Darwin on Solana. Every death makes the swarm smarter."

---

### BLOCK 9 — Hours 38–40: Submit
- [ ] Submit on Dev3Pack dashboard
- [ ] GitHub repo public + README complete
- [ ] Vercel live link working
- [ ] Demo video uploaded (YouTube unlisted is fine)
- [ ] Contract addresses in README
- [ ] Colosseum Frontier submission (same repo, same deadline May 11 — submit next morning)

---

## Fallback Priority (if time runs short)

If you're falling behind, cut in this order:

1. **Cut LI.FI** — mention in README as "coming soon", lose $500 track but save 4 hours
2. **Cut ElevenLabs** — lose the credits but save 2 hours
3. **Simplify x402** — show the 402 response in logs even if payment isn't fully settling, keep the narrative
4. **NEVER cut**: Anchor program core, lineage memory, demo video, working devnet deployment

---

## Environment Variables Needed

```bash
# Solana
ANCHOR_WALLET=~/.config/solana/id.json
RPC_URL=https://api.devnet.solana.com  # or from your RPC pack

# Anthropic (for ChildAgent task execution)
ANTHROPIC_API_KEY=

# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# x402
X402_FACILITATOR_URL=https://x402.org/facilitator
USDC_MINT_DEVNET=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

# LI.FI
LIFI_API_KEY=  # optional for widget

# Oracle
SCORING_ORACLE_URL=https://your-oracle.railway.app

# Program IDs (fill after deploy)
SWARM_PROGRAM_ID=
```

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Anchor build fails | Medium | Use Anchor 0.30.x, confirmed stable. If stuck, Noah AI can scaffold. |
| x402 devnet USDC unavailable | Low | Use devnet faucet USDC. Fallback: mock x402 payment but show 402 response in logs. |
| LI.FI quote fails (Solana devnet) | Medium | Use mainnet route for demo, label clearly as "mainnet simulation". |
| ElevenLabs rate limit | Low | Cache audio files for repeated events. |
| Demo too slow on devnet | Medium | Pre-run a full cycle before recording. Cache screenshots if live is unstable. |
| AI judging misses the concept | Low | README must have an explicit "What makes this different" section in bullet points. |