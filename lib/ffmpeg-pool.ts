"use client"

// ---------------------------------------------------------------------------
// CPU worker pool for ffmpeg.wasm
//
// A single ffmpeg run that only stream-copies (`-c copy`) is inherently
// single-threaded — there is nothing to decode or encode, so `-threads 0`
// does not help at all. The ONLY way to use every CPU core for clip cutting
// is to run SEVERAL ffmpeg engines side by side, each cutting a different
// clip. This module owns that pool: one engine per core (bounded), lazily
// created, reused across tasks, and retired when a WASM crash kills it.
// ---------------------------------------------------------------------------

import { FFmpeg } from "@ffmpeg/ffmpeg"
import type { FFFSType } from "@ffmpeg/ffmpeg"
import { toBlobURL } from "@ffmpeg/util"

const CORE_JS = "/ffmpeg/ffmpeg-core.js"
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm"
const CORE_MT_JS = "/ffmpeg-mt/ffmpeg-core.js"
const CORE_MT_WASM = "/ffmpeg-mt/ffmpeg-core.wasm"
const CORE_MT_WORKER = "/ffmpeg-mt/ffmpeg-core.worker.js"

const WORKERFS = "WORKERFS" as FFFSType

/** True when the page is cross-origin isolated and SharedArrayBuffer exists. */
export function multiThreadAvailable(): boolean {
  try {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      typeof crossOriginIsolated !== "undefined" &&
      crossOriginIsolated === true
    )
  } catch {
    return false
  }
}

/** Logical CPU cores reported by the browser (falls back to 4). */
export function cpuCount(): number {
  if (typeof navigator === "undefined") return 4
  const n = navigator.hardwareConcurrency
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4
}

/**
 * Loads the multi-threaded core when the environment allows it, otherwise the
 * single-threaded core. Returns true when the MT core is active.
 */
export async function loadEngine(instance: FFmpeg): Promise<boolean> {
  if (multiThreadAvailable()) {
    try {
      await instance.load({
        coreURL: await toBlobURL(CORE_MT_JS, "text/javascript"),
        wasmURL: await toBlobURL(CORE_MT_WASM, "application/wasm"),
        workerURL: await toBlobURL(CORE_MT_WORKER, "text/javascript"),
      })
      return true
    } catch {
      // MT core failed to load — fall through to the single-threaded core.
    }
  }
  await instance.load({
    coreURL: await toBlobURL(CORE_JS, "text/javascript"),
    wasmURL: await toBlobURL(CORE_WASM, "application/wasm"),
  })
  return false
}

// ---------------------------------------------------------------------------
// Parallelism planning
// ---------------------------------------------------------------------------

export interface ParallelPlan {
  /** Number of ffmpeg engines that run at the same time. */
  workers: number
  /** `-threads` value handed to each engine (decoder + encoder). */
  threadsPerWorker: number
  /** Total logical cores the plan is based on. */
  cores: number
}

/**
 * Decides how many engines to run for `taskCount` independent clip jobs.
 *
 * - Stream copy (no re-encode): every job is single-threaded, so we run one
 *   engine per core — this is what finally saturates the CPU.
 * - Re-encode on the MT core: each engine already spreads x264 across cores,
 *   so a few engines with a share of the cores each keeps the CPU full
 *   without exhausting memory (4K decode buffers are large).
 * - Re-encode on the single-threaded core: one engine per core, since a
 *   single engine can never use more than one.
 */
export function planParallelism(taskCount: number, reencode: boolean): ParallelPlan {
  const cores = cpuCount()
  const jobs = Math.max(1, taskCount)
  if (!reencode) {
    return { workers: Math.min(jobs, cores, 16), threadsPerWorker: 1, cores }
  }
  if (multiThreadAvailable()) {
    const workers = Math.min(jobs, Math.max(1, Math.min(4, Math.floor(cores / 2))))
    return { workers, threadsPerWorker: Math.max(2, Math.ceil(cores / workers)), cores }
  }
  return { workers: Math.min(jobs, cores, 12), threadsPerWorker: 1, cores }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

export interface PoolWorker {
  id: number
  ff: FFmpeg
  isMT: boolean
  /** Bounded tail of this engine's log output (for error messages). */
  logs: string[]
  /** The File currently mounted at MOUNT_DIR inside this engine. */
  mountedFor: File | null
  mountedPath: string | null
}

const MOUNT_DIR = "/pool_in"

const idle: PoolWorker[] = []
const all = new Set<PoolWorker>()
let nextId = 1
// Serialises engine creation so parallel acquires never race the network.
let creating: Promise<PoolWorker> | null = null

async function createWorker(): Promise<PoolWorker> {
  const ff = new FFmpeg()
  const worker: PoolWorker = { id: nextId++, ff, isMT: false, logs: [], mountedFor: null, mountedPath: null }
  ff.on("log", ({ message }) => {
    worker.logs.push(message)
    if (worker.logs.length > 300) worker.logs.splice(0, worker.logs.length - 150)
  })
  worker.isMT = await loadEngine(ff)
  all.add(worker)
  return worker
}

async function acquire(): Promise<PoolWorker> {
  const w = idle.pop()
  if (w) return w
  // Create one at a time; concurrent callers queue behind the same promise.
  while (creating) {
    await creating.catch(() => {})
    const again = idle.pop()
    if (again) return again
  }
  creating = createWorker()
  try {
    return await creating
  } finally {
    creating = null
  }
}

function release(worker: PoolWorker) {
  if (all.has(worker)) idle.push(worker)
}

/** Permanently discards a worker (used after a WASM crash). */
export function killWorker(worker: PoolWorker) {
  try {
    worker.ff.terminate()
  } catch {
    // already dead
  }
  all.delete(worker)
  const i = idle.indexOf(worker)
  if (i >= 0) idle.splice(i, 1)
}

/** Terminates every engine in the pool and frees their memory. */
export function terminatePool() {
  for (const w of Array.from(all)) killWorker(w)
}

/** Number of engines currently alive (idle or busy). */
export function poolSize(): number {
  return all.size
}

/**
 * Mounts `file` into the worker's filesystem (zero-copy WORKERFS) and returns
 * its path. Re-mounting the same File is a no-op.
 */
export async function mountFile(worker: PoolWorker, file: File): Promise<string> {
  if (worker.mountedFor === file && worker.mountedPath) return worker.mountedPath
  const ff = worker.ff
  try {
    await ff.unmount(MOUNT_DIR)
  } catch {
    // not mounted
  }
  try {
    await ff.deleteDir(MOUNT_DIR)
  } catch {
    // no dir
  }
  const m = file.name.match(/\.(\w{2,5})$/)
  const ext = m ? m[1].toLowerCase() : "mp4"
  const name = `source.${ext}`
  await ff.createDir(MOUNT_DIR)
  await ff.mount(WORKERFS, { blobs: [{ name, data: file }] }, MOUNT_DIR)
  worker.mountedFor = file
  worker.mountedPath = `${MOUNT_DIR}/${name}`
  return worker.mountedPath
}

export function isCrashMessage(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes("memory access out of bounds") ||
    msg.includes("out of memory") ||
    msg.includes("cannot enlarge memory") ||
    msg.includes("oom") ||
    msg.includes("abort") ||
    msg.includes("unreachable") ||
    msg.includes("terminated") ||
    msg.includes("called ffmpeg.terminate")
  )
}

/**
 * Runs `fn` over `items` with up to `concurrency` engines working at once.
 * Stops scheduling new items after the first failure and rethrows it; the
 * worker whose task crashed the WASM heap is discarded so it can never
 * poison a later job. `shouldStop` lets the caller cancel early.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (worker: PoolWorker, item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  if (items.length === 0) return
  const n = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0
  let failure: unknown = null

  const runner = async () => {
    while (true) {
      if (failure !== null || shouldStop?.()) return
      const index = cursor++
      if (index >= items.length) return
      const worker = await acquire()
      try {
        await fn(worker, items[index], index)
        release(worker)
      } catch (err) {
        if (isCrashMessage(err)) killWorker(worker)
        else release(worker)
        if (failure === null) failure = err
        return
      }
    }
  }

  await Promise.all(Array.from({ length: n }, runner))
  if (failure !== null) throw failure
}
