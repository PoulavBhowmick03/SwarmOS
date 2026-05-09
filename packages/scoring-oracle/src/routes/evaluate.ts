import { Router } from 'express'
import { AccuracyDetails, scoreOutput } from '../scoring/rubric'

type TaskType = 'YieldOptimizer' | 'CodeReviewer' | 'DataSynthesizer'

interface EvaluateRequest {
  agentId: number
  taskType: TaskType
  output: string
  lineageMemoryCount?: number
}

interface EvaluateResponse {
  agentId: number
  score: number
  breakdown: {
    relevance: number
    accuracy: number
    efficiency: number
  }
  accuracyDetails?: AccuracyDetails
  feedback: string
  timestamp: number
}

export interface PaymentRecord {
  agentId: number
  taskType: TaskType
  amount: string
  asset: string
  network: string
  timestamp: number
  paymentHeaderPresent: boolean
}

const TASK_TYPES = new Set<TaskType>(['YieldOptimizer', 'CodeReviewer', 'DataSynthesizer'])

export function createEvaluateRouter(payments: PaymentRecord[]): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    const receivedAt = Date.now()

    try {
      const body = req.body as Partial<EvaluateRequest>
      if (!isValidRequest(body)) {
        res.status(400).json({
          error:
            'Invalid request body. Expected { agentId: number, taskType: YieldOptimizer | CodeReviewer | DataSynthesizer, output: string }.'
        })
        return
      }

      const responseTimeMs = parseResponseTime(req.header('x-agent-response-time-ms')) ??
        Date.now() - receivedAt
      const score = await scoreOutput(
        body.taskType,
        body.output,
        responseTimeMs,
        body.agentId,
        body.lineageMemoryCount
      )
      const timestamp = Math.floor(Date.now() / 1000)

      payments.push({
        agentId: body.agentId,
        taskType: body.taskType,
        amount: '0.01',
        asset: 'USDC',
        network: process.env.SVM_NETWORK || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        timestamp,
        paymentHeaderPresent: Boolean(req.header('payment-signature') || req.header('x-payment'))
      })

      const response: EvaluateResponse = {
        agentId: body.agentId,
        score: score.total,
        breakdown: {
          relevance: score.relevance,
          accuracy: score.accuracy,
          efficiency: score.efficiency
        },
        ...(score.accuracyDetails ? { accuracyDetails: score.accuracyDetails } : {}),
        feedback: score.feedback,
        timestamp
      }

      res.json(response)
    } catch (error) {
      next(error)
    }
  })

  return router
}

function isValidRequest(body: Partial<EvaluateRequest>): body is EvaluateRequest {
  return (
    typeof body.agentId === 'number' &&
    Number.isInteger(body.agentId) &&
    typeof body.output === 'string' &&
    typeof body.taskType === 'string' &&
    TASK_TYPES.has(body.taskType)
  )
}

function parseResponseTime(header: string | undefined): number | null {
  if (!header) return null
  const parsed = Number(header)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export default createEvaluateRouter
