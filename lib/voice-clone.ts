/**
 * Voice cloning engine: Chatterbox Multilingual (Resemble AI, MIT licensed,
 * fully open source) running on its public Hugging Face Space.
 *
 * Zero-shot cloning: there is no training step. The reference clip IS the
 * voice model, which is exactly why the whole voice library can live in the
 * repo as plain audio files.
 *
 * No API key or credit card is required. Set HF_TOKEN (a free Hugging Face
 * token) only if you want higher priority in the Space queue.
 */
import "server-only"
import { Client, handle_file } from "@gradio/client"
import { chunkText } from "./voice-text"

const SPACE_ID = process.env.VOICE_CLONE_SPACE || "ResembleAI/Chatterbox-Multilingual-TTS"
const ENDPOINT = "/generate_tts_audio"

export interface SynthesisOptions {
  text: string
  language: string
  reference: Buffer
  referenceMimeType: string
  /** 0.25 - 2: how expressive/emotive the delivery is. */
  exaggeration?: number
  /** 0.05 - 5: randomness. Lower is steadier. */
  temperature?: number
  /** 0.2 - 1: pacing / classifier-free-guidance weight. */
  cfgWeight?: number
  /** 0 = random. */
  seed?: number
}

interface WavData {
  sampleRate: number
  channels: number
  bitsPerSample: number
  pcm: Buffer
}

/** Minimal RIFF/WAVE parser — enough for the mono PCM the engine returns. */
function parseWav(buffer: Buffer): WavData {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Engine returned audio in an unexpected format.")
  }
  let offset = 12
  let sampleRate = 24000
  let channels = 1
  let bitsPerSample = 16
  let pcm: Buffer | null = null

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bitsPerSample = buffer.readUInt16LE(body + 14)
    } else if (id === "data") {
      pcm = buffer.subarray(body, Math.min(body + size, buffer.length))
    }
    offset = body + size + (size % 2)
  }
  if (!pcm) throw new Error("Engine returned audio without a data chunk.")
  return { sampleRate, channels, bitsPerSample, pcm }
}

function encodeWav(data: { sampleRate: number; channels: number; bitsPerSample: number; pcm: Buffer }): Buffer {
  const { sampleRate, channels, bitsPerSample, pcm } = data
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** Joins chunk outputs into one WAV, inserting a short pause between them. */
function concatWavs(parts: Buffer[], pauseMs = 220): Buffer {
  const parsed = parts.map(parseWav)
  const first = parsed[0]
  const pauseBytes =
    Math.floor((first.sampleRate * pauseMs) / 1000) * first.channels * (first.bitsPerSample / 8)
  const silence = Buffer.alloc(pauseBytes - (pauseBytes % ((first.channels * first.bitsPerSample) / 8)))

  const pcmParts: Buffer[] = []
  parsed.forEach((p, i) => {
    if (i > 0) pcmParts.push(silence)
    pcmParts.push(p.pcm)
  })
  return encodeWav({
    sampleRate: first.sampleRate,
    channels: first.channels,
    bitsPerSample: first.bitsPerSample,
    pcm: Buffer.concat(pcmParts),
  })
}

let clientPromise: Promise<Client> | null = null

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Client.connect(SPACE_ID, {
      hf_token: (process.env.HF_TOKEN as `hf_${string}` | undefined) ?? undefined,
    }).catch((err) => {
      clientPromise = null
      throw err
    })
  }
  return clientPromise
}

function friendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  if (/quota|gpu|exceeded/i.test(raw)) {
    return new Error(
      "The free voice engine hit its GPU quota. Wait a minute and try again, or add a free HF_TOKEN for priority.",
    )
  }
  if (/sleep|starting|503|502|504/i.test(raw)) {
    return new Error("The voice engine is waking up. Please try again in about a minute.")
  }
  if (/fetch|network|ENOTFOUND|timeout/i.test(raw)) {
    return new Error("Could not reach the voice engine. Check the network connection and try again.")
  }
  return new Error(raw.slice(0, 300) || "Voice generation failed.")
}

/**
 * Clones the reference voice and speaks `text`. Returns a single WAV buffer.
 */
export async function synthesize(options: SynthesisOptions): Promise<{ wav: Buffer; chunks: number }> {
  const chunks = chunkText(options.text)
  if (chunks.length === 0) throw new Error("Enter some text to generate.")

  const app = await getClient().catch((err) => {
    throw friendlyError(err)
  })

  const referenceBlob = new Blob([new Uint8Array(options.reference)], {
    type: options.referenceMimeType || "audio/wav",
  })
  const referenceFile = await handle_file(referenceBlob)

  const outputs: Buffer[] = []
  for (const chunk of chunks) {
    let result: { data?: unknown }
    try {
      result = await app.predict(ENDPOINT, {
        text_input: chunk,
        language_id: options.language,
        audio_prompt_path_input: referenceFile,
        exaggeration_input: options.exaggeration ?? 0.5,
        temperature_input: options.temperature ?? 0.8,
        // Keep the seed fixed across chunks so the voice stays consistent.
        seed_num_input: options.seed ?? 0,
        cfgw_input: options.cfgWeight ?? 0.5,
      })
    } catch (err) {
      throw friendlyError(err)
    }

    const payload = Array.isArray(result?.data) ? (result.data[0] as { url?: string } | null) : null
    if (!payload?.url) throw new Error("Voice engine did not return any audio.")

    const audioResponse = await fetch(payload.url)
    if (!audioResponse.ok) throw new Error("Could not download the generated audio.")
    outputs.push(Buffer.from(await audioResponse.arrayBuffer()))
  }

  const wav = outputs.length === 1 ? outputs[0] : concatWavs(outputs)
  return { wav, chunks: chunks.length }
}
