import { type NextRequest, NextResponse } from 'next/server'

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

interface VoiceRequestBody {
  text: string
  voiceId: string
  model_id?: string
  voice_settings?: {
    stability: number
    similarity_boost: number
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })
  }

  let body: VoiceRequestBody
  try {
    body = (await request.json()) as VoiceRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { text, voiceId, model_id = 'eleven_turbo_v2', voice_settings } = body
  if (!text || !voiceId) {
    return NextResponse.json({ error: 'text and voiceId are required' }, { status: 400 })
  }

  const elevenRes = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id,
      voice_settings: voice_settings ?? { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!elevenRes.ok) {
    const errText = await elevenRes.text().catch(() => '')
    return NextResponse.json(
      { error: `ElevenLabs error ${elevenRes.status}: ${errText}` },
      { status: elevenRes.status }
    )
  }

  const audioBuffer = await elevenRes.arrayBuffer()

  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  })
}
