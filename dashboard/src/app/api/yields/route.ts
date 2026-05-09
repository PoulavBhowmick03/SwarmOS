import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json([
    { protocol: 'Kamino SOL/USDC',  apy: 9.26, trend: 'up',     tvl: '$45.2M' },
    { protocol: 'JupiterLend USDC', apy: 4.40, trend: 'stable',  tvl: '$28.1M' },
    { protocol: 'Save Protocol',    apy: 5.12, trend: 'down',    tvl: '$62.4M' },
    { protocol: 'Drift USDC',       apy: 3.87, trend: 'stable',  tvl: '$19.8M' },
  ])
}
