"use client"

import type React from "react"
import { useRef, useState } from "react"
import { formatBytes } from "@/lib/merge-client"

interface DropZoneProps {
  label: string
  sublabel: string
  accent: "purple" | "blue"
  file: File | null
  disabled: boolean
  onFile: (file: File) => void
  onClear: () => void
}

function DropZone({ label, sublabel, accent, file, disabled, onFile, onClear }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accentClasses =
    accent === "purple"
      ? {
          border: dragging ? "border-purple-400" : file ? "border-purple-500/60" : "border-slate-700",
          bg: dragging ? "bg-purple-500/10" : file ? "bg-purple-500/5" : "bg-slate-900",
          badge: "bg-purple-500/15 text-purple-300",
          text: "text-purple-300",
        }
      : {
          border: dragging ? "border-blue-400" : file ? "border-blue-500/60" : "border-slate-700",
          bg: dragging ? "bg-blue-500/10" : file ? "bg-blue-500/5" : "bg-slate-900",
          badge: "bg-blue-500/15 text-blue-300",
          text: "text-blue-300",
        }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const dropped = e.dataTransfer.files?.[0]
    if (dropped && dropped.type.startsWith("video/")) onFile(dropped)
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${label} — ${file ? file.name : "click or drop a video file"}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition ${accentClasses.border} ${accentClasses.bg} ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-slate-500"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const selected = e.target.files?.[0]
          if (selected) onFile(selected)
        }}
      />

      <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${accentClasses.badge}`}>
        {label}
      </span>

      {file ? (
        <div className="flex flex-col items-center gap-1">
          <p className={`max-w-full truncate text-sm font-semibold ${accentClasses.text}`}>{file.name}</p>
          <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            disabled={disabled}
            className="mt-1 text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-medium text-slate-200">{sublabel}</p>
          <p className="text-xs text-slate-500">Click or drag &amp; drop a video file</p>
        </div>
      )}
    </div>
  )
}

interface MergeUploaderProps {
  shortFile: File | null
  movieFile: File | null
  disabled: boolean
  onShortFile: (file: File | null) => void
  onMovieFile: (file: File | null) => void
}

export function MergeUploader({ shortFile, movieFile, disabled, onShortFile, onMovieFile }: MergeUploaderProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DropZone
        label="Part A"
        sublabel="Short Video (plays first)"
        accent="purple"
        file={shortFile}
        disabled={disabled}
        onFile={(f) => onShortFile(f)}
        onClear={() => onShortFile(null)}
      />
      <DropZone
        label="Part B"
        sublabel="Full Movie (plays after)"
        accent="blue"
        file={movieFile}
        disabled={disabled}
        onFile={(f) => onMovieFile(f)}
        onClear={() => onMovieFile(null)}
      />
    </div>
  )
}
