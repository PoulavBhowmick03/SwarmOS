import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { createEvaluateRouter, PaymentRecord } from './routes/evaluate'
import { fetchLiveYields } from './data/yields'
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

app.get('/yields', async (_req, res) => {
  try {
    const yields = await fetchLiveYields()
    res.json(yields)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.use(createX402EvaluateMiddleware())
app.use('/evaluate', createEvaluateRouter(payments))

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Oracle running on :${port}`)
  })
}

export default app
module.exports = app

function findRepoRoot(startDir: string): string {
  let current = startDir

  for (;;) {
    if (fs.existsSync(path.join(current, 'Anchor.toml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return startDir
    current = parent
  }
}
