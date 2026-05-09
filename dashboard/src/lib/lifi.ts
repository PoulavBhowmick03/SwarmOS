export const SOLANA_CHAIN_ID = 'SOL'
export const USDC_ON_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const LIFI_INTEGRATOR = process.env.NEXT_PUBLIC_LIFI_INTEGRATOR ?? 'SwarmOS'

export interface LiFiToken {
  address: string
  symbol: string
  decimals: number
  chainId: number | string
  name: string
  logoURI?: string
}

export interface LiFiRoute {
  id: string
  fromChainId: number
  toChainId: number | string
  fromToken: LiFiToken
  toToken: LiFiToken
  fromAmount: string
  toAmount: string
  toAmountMin: string
  toAmountUSD?: string
  steps: Array<{
    type: string
    tool: string
    toolDetails: { name: string; logoURI: string }
  }>
  gasCostUSD?: string
  insurance?: { state: string }
  tags?: string[]
}

export interface LiFiQuoteResult {
  routes: LiFiRoute[]
  recommendedRoute?: LiFiRoute
}

const LIFI_API_BASE = 'https://li.quest/v1'

export async function getSwarmFundingQuote(
  fromChainId: number,
  fromTokenAddress: string,
  amountUSD: number,
  treasuryAddress: string
): Promise<LiFiQuoteResult> {
  const amountWei = BigInt(Math.floor(amountUSD * 1e6)).toString()

  const params = new URLSearchParams({
    fromChain: fromChainId.toString(),
    toChain: SOLANA_CHAIN_ID,
    fromToken: fromTokenAddress,
    toToken: USDC_ON_SOLANA,
    fromAmount: amountWei,
    toAddress: treasuryAddress,
    integrator: LIFI_INTEGRATOR,
    allowBridges: 'meson,celer,across,symbiosis',
    allowExchanges: 'uniswap,1inch',
  })

  const res = await fetch(`${LIFI_API_BASE}/routes?${params}`, {
    headers: { 'x-lifi-integrator': LIFI_INTEGRATOR },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LI.FI API ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { routes: LiFiRoute[] }

  return {
    routes: data.routes ?? [],
    recommendedRoute: data.routes?.[0],
  }
}

export function buildJumperUrl(treasuryAddress: string): string {
  const params = new URLSearchParams({
    toChain: SOLANA_CHAIN_ID,
    toToken: USDC_ON_SOLANA,
    toWalletAddress: treasuryAddress,
  })
  return `https://jumper.exchange/?${params}`
}
