# Cloned voice library

This folder is the storage for the Voice Clone Studio (`/voice-clone`). It is **intentionally
committed to git** so every cloned voice travels with the code on each push.

```
data/voices/
  index.json                      metadata for every voice profile
  <voice-id>/<sample-id>.<ext>    reference clips (the "voice model")
  <voice-id>/takes/<take-id>.wav  generated takes you chose to save
```

## Why plain audio files are enough

The engine (Chatterbox Multilingual, MIT licensed) does **zero-shot** cloning: there is no training
step and no model weights to store. The reference clip *is* the voice. Copying these files to
another machine reproduces the exact same voice.

## Notes

- Do not hand-edit `index.json` while the dev server is running; use the UI instead.
- Reference clips work best at 7–20 seconds, one speaker, no background music.
- Adding and deleting voices needs a writable filesystem, so do it in v0 or locally. A deployed
  Vercel instance has a read-only filesystem and will show the library in read-only mode.
