const warned = new Set<string>();

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export async function getMoeLPAPY(): Promise<number> {
  warnOnce(
    "moe-apy",
    "[MerchantMoe] LP APY is running in safe read-only fallback mode and returns 0 until pool-specific Mantle wiring is enabled."
  );
  return 0;
}

export async function getMoeLPValue(_walletAddress?: string): Promise<number> {
  warnOnce(
    "moe-value",
    "[MerchantMoe] LP value is running in safe read-only fallback mode and returns 0 until position-specific Mantle wiring is enabled."
  );
  return 0;
}
