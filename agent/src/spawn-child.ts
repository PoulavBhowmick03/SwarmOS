import { startChildFromEnv } from "./child.js";

startChildFromEnv().catch((error) => {
  console.error("[spawn-child] Fatal:", error);
  process.exitCode = 1;
});
