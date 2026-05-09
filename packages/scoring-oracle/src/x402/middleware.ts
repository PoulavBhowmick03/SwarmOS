import { RequestHandler } from 'express'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { registerExactSvmScheme } from '@x402/svm/exact/server'
import { SOLANA_DEVNET_CAIP2 } from '@x402/svm'

export function createX402EvaluateMiddleware(): RequestHandler {
  const payTo = process.env.ORACLE_WALLET_ADDRESS?.trim()

  if (process.env.SKIP_X402_PAYMENT === 'true') {
    console.warn('SKIP_X402_PAYMENT=true. /evaluate will run without x402 payment enforcement.')
    return (_req, _res, next) => next()
  }

  if (!payTo) {
    console.warn(
      'ORACLE_WALLET_ADDRESS is not set. /evaluate will run without x402 payment enforcement for local development.'
    )
    return (_req, _res, next) => next()
  }

  const network = (process.env.SVM_NETWORK || SOLANA_DEVNET_CAIP2) as any
  const facilitatorClient = new HTTPFacilitatorClient({
    url: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'
  })
  const resourceServer = registerExactSvmScheme(new x402ResourceServer(facilitatorClient), {
    networks: [network]
  })

  return paymentMiddleware(
    {
      'POST /evaluate': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.01',
            network,
            payTo
          }
        ],
        description: 'Evaluate a SwarmOS child agent output against its task rubric',
        mimeType: 'application/json'
      }
    },
    resourceServer
  )
}
