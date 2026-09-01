/**
 * Languages supported by Chatterbox Multilingual (open-source, MIT).
 * Hindi and English are listed first since they are the primary targets.
 */
export const VOICE_LANGUAGES: { code: string; label: string }[] = [
  { code: "hi", label: "Hindi (हिंदी)" },
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
  { code: "da", label: "Danish" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "es", label: "Spanish" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "he", label: "Hebrew" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "nl", label: "Dutch" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "sv", label: "Swedish" },
  { code: "sw", label: "Swahili" },
  { code: "tr", label: "Turkish" },
  { code: "zh", label: "Chinese" },
]

export const VOICE_LANGUAGE_CODES = VOICE_LANGUAGES.map((l) => l.code)

export function isSupportedLanguage(code: string): boolean {
  return VOICE_LANGUAGE_CODES.includes(code)
}

export function languageLabel(code: string): string {
  return VOICE_LANGUAGES.find((l) => l.code === code)?.label ?? code
}

/** Max samples allowed per voice profile. */
export const MAX_SAMPLES_PER_VOICE = 8
/** Max size of a single uploaded reference clip. */
export const MAX_SAMPLE_BYTES = 8 * 1024 * 1024
/** The engine truncates each request at 300 characters, so we chunk longer text. */
export const MAX_CHARS_PER_CHUNK = 300
/** Upper bound on the whole script we will synthesize in one go. */
export const MAX_TOTAL_CHARS = 3000

export const ACCEPTED_SAMPLE_TYPES = [
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/x-flac",
  "video/webm",
]
