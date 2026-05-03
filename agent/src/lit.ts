// Lit Protocol — SCOPED OUT for Mantle build
// This is a stub. Rationale encryption is disabled for this hackathon build.
// Reason: Prior implementation was Base Sepolia-specific (Synthesis hackathon carry-over).
// Post-launch: rewrite using evmContractConditions on Mantle mainnet (chainId 5000).

export async function encryptRationale(
  rationale: string,
  _opts: { chain: string; contractAddress: string; unlockAfterBlocks: number }
): Promise<string> {
  return `[UNENCRYPTED-LIT-SCOPED-OUT] ${rationale}`;
}

export async function decryptRationale(encryptedRationale: string): Promise<string> {
  return encryptedRationale.replace("[UNENCRYPTED-LIT-SCOPED-OUT] ", "");
}
