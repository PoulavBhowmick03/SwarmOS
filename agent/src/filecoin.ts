import lighthouse from "@lighthouse-web3/sdk";
import { ChildState } from "./types";

const LIGHTHOUSE_API_KEY = process.env.LIGHTHOUSE_API_KEY;

export interface SwarmSnapshot {
  cycleCount: number;
  timestamp: number;
  agents: ChildState[];
}

export async function snapshotToFilecoin(snapshot: SwarmSnapshot): Promise<string | null> {
  if (!LIGHTHOUSE_API_KEY) {
    console.warn("[Filecoin] LIGHTHOUSE_API_KEY not set — skipping snapshot");
    return null;
  }

  try {
    const json = JSON.stringify(snapshot, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );

    const buffer = Buffer.from(json, "utf-8");

    const response = await lighthouse.uploadBuffer(
      buffer,
      LIGHTHOUSE_API_KEY,
      undefined,
      undefined,
      { name: `spawn-snapshot-cycle-${snapshot.cycleCount}-${snapshot.timestamp}.json` }
    );

    const cid = response.data.Hash;
    console.log(`[Filecoin] Snapshot cycle ${snapshot.cycleCount} → CID: ${cid}`);
    return cid;
  } catch (err) {
    console.error("[Filecoin] Snapshot upload failed:", err);
    return null;
  }
}
