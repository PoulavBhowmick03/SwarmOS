export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const oracleUrl = process.env.NEXT_PUBLIC_ORACLE_URL ||
                      process.env.NEXT_PUBLIC_SCORING_ORACLE_URL ||
                      'http://localhost:3001'
    const res = await fetch(`${oracleUrl}/yields`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) throw new Error('Oracle unavailable')
    const data = await res.json()
    return Response.json(data)
  } catch {
    return Response.json([
      { protocol: 'Kamino', vault: 'SOL/USDC', token: 'USDC',
        apy: 0.0926, tvl: 45000000, riskScore: 3 },
      { protocol: 'JupiterLend', vault: 'USDC', token: 'USDC',
        apy: 0.044, tvl: 430000000, riskScore: 2 },
      { protocol: 'Save', vault: 'USDC', token: 'USDC',
        apy: 0.0207, tvl: 10900000, riskScore: 1 },
      { protocol: 'Kamino', vault: 'USDC Lending', token: 'USDC',
        apy: 0.0341, tvl: 8100000, riskScore: 2 },
    ])
  }
}
