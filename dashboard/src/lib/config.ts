export const SWARM_PROGRAM_ID =
  process.env.NEXT_PUBLIC_SWARM_PROGRAM_ID ??
  'D9moMaWzJw3LVxnZkiXS7xrTUHmF4n3hJeDWCvbB7B1a'

export const SWARM_ADDRESS =
  process.env.NEXT_PUBLIC_SWARM_ADDRESS ??
  '6zbt4nwzetSShWEQi6AnrVwjRqLxANF9acYpPu4hQWVF'

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  'https://api.devnet.solana.com'

export const ORACLE_URL =
  process.env.NEXT_PUBLIC_ORACLE_URL ??
  process.env.NEXT_PUBLIC_SCORING_ORACLE_URL ??
  'http://localhost:3001'

export const EXPLORER_BASE = 'https://explorer.solana.com'

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_BASE}/address/${address}?cluster=devnet`
}
