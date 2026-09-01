/**
 * Server-side voice library stored INSIDE the repo (`data/voices/`).
 *
 * Why the filesystem and not a database/blob:
 * every cloned voice lives in the project files, so it is committed and
 * pushed to GitHub together with the code — the voices travel with the app.
 *
 * Layout:
 *   data/voices/index.json                     -> profile metadata
 *   data/voices/<profileId>/<sampleId>.<ext>   -> reference clips
 *   data/voices/<profileId>/takes/<takeId>.wav -> saved generated takes
 */
import "server-only"
import { promises as fs } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { MAX_SAMPLES_PER_VOICE } from "./voice-languages"

export const VOICES_DIR = path.join(process.cwd(), "data", "voices")
const INDEX_FILE = path.join(VOICES_DIR, "index.json")

export interface VoiceSample {
  id: string
  /** File name relative to the profile directory. */
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
  /** Sample used as the cloning reference by default. */
  primarySampleId: string | null
  samples: VoiceSample[]
  takes: VoiceTake[]
  createdAt: string
  updatedAt: string
}

interface VoiceIndex {
  version: 1
  profiles: VoiceProfile[]
}

const EMPTY_INDEX: VoiceIndex = { version: 1, profiles: [] }

/** Vercel's serverless filesystem is read-only — writes only work in local/v0 dev. */
export class ReadOnlyStoreError extends Error {
  constructor() {
    super(
      "Voice library is read-only in this deployment. Cloned voices are saved into the project files, so add or delete voices while running the app locally (or in v0), then push the changes.",
    )
    this.name = "ReadOnlyStoreError"
  }
}

function isReadOnlyFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === "EROFS" || code === "EACCES" || code === "EPERM"
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function readIndex(): Promise<VoiceIndex> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8")
    const parsed = JSON.parse(raw) as VoiceIndex
    if (!parsed || !Array.isArray(parsed.profiles)) return { ...EMPTY_INDEX }
    // Tolerate older records that predate `takes`.
    parsed.profiles = parsed.profiles.map((p) => ({ ...p, takes: p.takes ?? [], samples: p.samples ?? [] }))
    return parsed
  } catch {
    return { ...EMPTY_INDEX }
  }
}

async function writeIndex(index: VoiceIndex): Promise<void> {
  try {
    await ensureDir(VOICES_DIR)
    await fs.writeFile(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, "utf8")
  } catch (err) {
    if (isReadOnlyFsError(err)) throw new ReadOnlyStoreError()
    throw err
  }
}

export async function isWritable(): Promise<boolean> {
  try {
    await ensureDir(VOICES_DIR)
    const probe = path.join(VOICES_DIR, ".write-probe")
    await fs.writeFile(probe, "ok")
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

export async function listProfiles(): Promise<VoiceProfile[]> {
  const index = await readIndex()
  return index.profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getProfile(id: string): Promise<VoiceProfile | null> {
  const index = await readIndex()
  return index.profiles.find((p) => p.id === id) ?? null
}

function profileDir(profileId: string): string {
  return path.join(VOICES_DIR, profileId)
}

export function sampleAbsolutePath(profileId: string, sample: VoiceSample): string {
  return path.join(profileDir(profileId), sample.file)
}

export function takeAbsolutePath(profileId: string, take: VoiceTake): string {
  return path.join(profileDir(profileId), "takes", take.file)
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "voice"
  )
}

function extensionFor(fileName: string, mimeType: string): string {
  const fromName = path.extname(fileName).replace(".", "").toLowerCase()
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName
  const map: Record<string, string> = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
  }
  return map[mimeType] ?? "wav"
}

export async function createProfile(input: {
  name: string
  language: string
  notes?: string
}): Promise<VoiceProfile> {
  const index = await readIndex()
  const now = new Date().toISOString()
  const base = slugify(input.name)
  let id = base
  let n = 2
  while (index.profiles.some((p) => p.id === id)) {
    id = `${base}-${n++}`
  }
  const profile: VoiceProfile = {
    id,
    name: input.name.trim(),
    language: input.language,
    notes: input.notes?.trim() ?? "",
    primarySampleId: null,
    samples: [],
    takes: [],
    createdAt: now,
    updatedAt: now,
  }
  try {
    await ensureDir(profileDir(id))
  } catch (err) {
    if (isReadOnlyFsError(err)) throw new ReadOnlyStoreError()
    throw err
  }
  index.profiles.push(profile)
  await writeIndex(index)
  return profile
}

export async function updateProfile(
  id: string,
  patch: { name?: string; language?: string; notes?: string; primarySampleId?: string },
): Promise<VoiceProfile | null> {
  const index = await readIndex()
  const profile = index.profiles.find((p) => p.id === id)
  if (!profile) return null

  if (patch.name !== undefined) profile.name = patch.name.trim()
  if (patch.language !== undefined) profile.language = patch.language
  if (patch.notes !== undefined) profile.notes = patch.notes.trim()
  if (patch.primarySampleId !== undefined) {
    if (!profile.samples.some((s) => s.id === patch.primarySampleId)) return null
    profile.primarySampleId = patch.primarySampleId
  }
  profile.updatedAt = new Date().toISOString()
  await writeIndex(index)
  return profile
}

export async function deleteProfile(id: string): Promise<boolean> {
  const index = await readIndex()
  const exists = index.profiles.some((p) => p.id === id)
  if (!exists) return false
  index.profiles = index.profiles.filter((p) => p.id !== id)
  await writeIndex(index)
  try {
    await fs.rm(profileDir(id), { recursive: true, force: true })
  } catch (err) {
    if (isReadOnlyFsError(err)) throw new ReadOnlyStoreError()
    throw err
  }
  return true
}

export async function addSample(
  profileId: string,
  input: { fileName: string; mimeType: string; label?: string; data: Buffer },
): Promise<{ profile: VoiceProfile; sample: VoiceSample } | null> {
  const index = await readIndex()
  const profile = index.profiles.find((p) => p.id === profileId)
  if (!profile) return null
  if (profile.samples.length >= MAX_SAMPLES_PER_VOICE) {
    throw new Error(`This voice already has the maximum of ${MAX_SAMPLES_PER_VOICE} samples.`)
  }

  const sampleId = randomUUID().slice(0, 8)
  const ext = extensionFor(input.fileName, input.mimeType)
  const file = `${sampleId}.${ext}`
  const sample: VoiceSample = {
    id: sampleId,
    file,
    label: (input.label || input.fileName || `Sample ${profile.samples.length + 1}`).slice(0, 80),
    bytes: input.data.byteLength,
    mimeType: input.mimeType || "audio/wav",
    createdAt: new Date().toISOString(),
  }

  try {
    await ensureDir(profileDir(profileId))
    await fs.writeFile(path.join(profileDir(profileId), file), input.data)
  } catch (err) {
    if (isReadOnlyFsError(err)) throw new ReadOnlyStoreError()
    throw err
  }

  profile.samples.push(sample)
  if (!profile.primarySampleId) profile.primarySampleId = sample.id
  profile.updatedAt = new Date().toISOString()
  await writeIndex(index)
  return { profile, sample }
}

export async function deleteSample(profileId: string, sampleId: string): Promise<VoiceProfile | null> {
  const index = await readIndex()
  const profile = index.profiles.find((p) => p.id === profileId)
  if (!profile) return null
  const sample = profile.samples.find((s) => s.id === sampleId)
  if (!sample) return null

  profile.samples = profile.samples.filter((s) => s.id !== sampleId)
  if (profile.primarySampleId === sampleId) {
    profile.primarySampleId = profile.samples[0]?.id ?? null
  }
  profile.updatedAt = new Date().toISOString()
  await writeIndex(index)

  try {
    await fs.rm(path.join(profileDir(profileId), sample.file), { force: true })
  } catch (err) {
    if (isReadOnlyFsError(err)) throw new ReadOnlyStoreError()
    throw err
  }
  return profile
}

export async function addTake(
  profileId: string,
  input: { data: Buffer; text: string; language: string },
): Promise<{ profile: VoiceProfile; take: VoiceTake } | null> {
  const index = await readIndex()
  const profile = index.profiles.find((p) => p.id === profileId)
  if (!profile) return null

  const takeId = randomUUID().slice(0, 8)
  const take: VoiceTake = {
    id: takeId,
    file: `${takeId}.wav`,
    text: input.text.slice(0, 400),
    language: input.language,
    createdAt: new Date().toISOString(),
  }

  try {
    await ensureDir(path.join(profileDir(profileId), "takes"))
    await fs.writeFile(path.join(profileDir(profileId), "takes", take.file), input.data)
  } catch (err) {
    if (isReadOnlyFsError(err)) throw new ReadOnlyStoreError()
    throw err
  }

  profile.takes.push(take)
  profile.updatedAt = new Date().toISOString()
  await writeIndex(index)
  return { profile, take }
}

export async function deleteTake(profileId: string, takeId: string): Promise<VoiceProfile | null> {
  const index = await readIndex()
  const profile = index.profiles.find((p) => p.id === profileId)
  if (!profile) return null
  const take = profile.takes.find((t) => t.id === takeId)
  if (!take) return null

  profile.takes = profile.takes.filter((t) => t.id !== takeId)
  profile.updatedAt = new Date().toISOString()
  await writeIndex(index)

  try {
    await fs.rm(path.join(profileDir(profileId), "takes", take.file), { force: true })
  } catch (err) {
    if (isReadOnlyFsError(err)) throw new ReadOnlyStoreError()
    throw err
  }
  return profile
}

export async function readSampleFile(profileId: string, sampleId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const profile = await getProfile(profileId)
  const sample = profile?.samples.find((s) => s.id === sampleId)
  if (!profile || !sample) return null
  try {
    const data = await fs.readFile(sampleAbsolutePath(profile.id, sample))
    return { data, mimeType: sample.mimeType || "audio/wav" }
  } catch {
    return null
  }
}

export async function readTakeFile(profileId: string, takeId: string): Promise<Buffer | null> {
  const profile = await getProfile(profileId)
  const take = profile?.takes.find((t) => t.id === takeId)
  if (!profile || !take) return null
  try {
    return await fs.readFile(takeAbsolutePath(profile.id, take))
  } catch {
    return null
  }
}
