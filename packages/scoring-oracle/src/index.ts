import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { createEvaluateRouter, PaymentRecord } from './routes/evaluate'
import { createX402EvaluateMiddleware } from './x402/middleware'

const repoRoot = findRepoRoot(__dirname)
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || path.join(repoRoot, '.env') })

const app = express()
const payments: PaymentRecord[] = []
const port = Number(process.env.PORT || 3001)

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/payments', (_req, res) => {
  res.json({ payments })
})

app.use(createX402EvaluateMiddleware())
app.use('/evaluate', createEvaluateRouter(payments))

app.listen(port, () => {
  console.log(`Oracle running on :${port}`)
})

function findRepoRoot(startDir: string): string {
  let current = startDir

  for (;;) {
    if (fs.existsSync(path.join(current, 'Anchor.toml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return process.cwd()
    current = parent
  }
}
