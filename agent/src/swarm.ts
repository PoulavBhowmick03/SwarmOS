import { runParentLoop } from "./parent.js";

console.log("[Swarm] Legacy governance swarm replaced by the Mantle parent loop. Delegating to parent.ts.");

runParentLoop().catch((error) => {
  console.error("[Swarm] Fatal:", error);
  process.exitCode = 1;
});
