/** Browser-side helpers for the voice clone library. */

export interface VoiceSample {
  id: string
  file: string
  label: string
  bytes: number
  mimeType: string
  createdAt: string
}

export interface VoiceTake {
  id: string
  file: string
  text: string
  language: string
  createdAt: string
}

export interface VoiceProfile {
  id: string
  name: string
  language: string
  notes: string
  primarySampleId: string | null
  samples: VoiceSample[]
  takes: VoiceTake[]
  createdAt: string
  updatedAt: string
}

export interface VoicesResponse {
  profiles: VoiceProfile[]
  writable: boolean
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error || fallback
  } catch {
    return fallback
  }
}

export const voicesFetcher = async (url: string): Promise<VoicesResponse> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(await readError(response, "Could not load the voice library."))
  return (await response.json()) as VoicesResponse
}

export async function createVoice(input: { name: string; language: string; notes?: string }): Promise<void> {
  const response = await fetch("/api/voices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response, "Could not create the voice."))
}

export async function updateVoice(
  id: string,
  patch: { name?: string; language?: string; notes?: string; primarySampleId?: string },
): Promise<void> {
  const response = await fetch(`/api/voices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(await readError(response, "Could not update the voice."))
}

export async function deleteVoice(id: string): Promise<void> {
  const response = await fetch(`/api/voices/${id}`, { method: "DELETE" })
  if (!response.ok) throw new Error(await readError(response, "Could not delete the voice."))
}

export async function uploadSamples(id: string, files: File[]): Promise<void> {
  const form = new FormData()
  for (const file of files) {
    form.append("samples", file)
    form.append("labels", file.name)
  }
  const response = await fetch(`/api/voices/${id}/samples`, { method: "POST", body: form })
  if (!response.ok) throw new Error(await readError(response, "Could not upload the samples."))
}

export async function deleteSample(id: string, sampleId: string): Promise<void> {
  const response = await fetch(`/api/voices/${id}/samples/${sampleId}`, { method: "DELETE" })
  if (!response.ok) throw new Error(await readError(response, "Could not delete the sample."))
}

export interface GenerateInput {
  text: string
  language: string
  sampleId?: string
  exaggeration: number
  temperature: number
  cfgWeight: number
  seed: number
}

export async function generateSpeech(id: string, input: GenerateInput): Promise<Blob> {
  const response = await fetch(`/api/voices/${id}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response, "Voice generation failed."))
  return await response.blob()
}

export async function saveTake(
  id: string,
  input: { blob: Blob; text: string; language: string },
): Promise<void> {
  const form = new FormData()
  form.append("audio", input.blob, "take.wav")
  form.append("text", input.text)
  form.append("language", input.language)
  const response = await fetch(`/api/voices/${id}/takes`, { method: "POST", body: form })
  if (!response.ok) throw new Error(await readError(response, "Could not save the take."))
}

export async function deleteTake(id: string, takeId: string): Promise<void> {
  const response = await fetch(`/api/voices/${id}/takes/${takeId}`, { method: "DELETE" })
  if (!response.ok) throw new Error(await readError(response, "Could not delete the take."))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
