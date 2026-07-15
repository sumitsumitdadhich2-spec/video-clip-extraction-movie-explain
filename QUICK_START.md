# Quick Start Guide - 5 Minutes to Merging Videos

## TL;DR - The Fastest Way

```bash
# 1. Install (one time)
pnpm install
brew install ffmpeg  # macOS (or install FFmpeg for your OS)

# 2. Run (every time)
pnpm dev

# 3. Open browser
http://localhost:3000

# 4. Use the app
- Upload video + JSON
- Click "Continue to Preview"
- Click "Extract All Clips"
- Click "Merge & Download"
- ✨ Done! Check your downloads folder
```

## Prerequisites Checklist

- [ ] Node.js installed (`node -v` shows v18+)
- [ ] FFmpeg installed (`ffmpeg -version` works)
- [ ] Video file ready (MP4, MKV, WebM, etc.)
- [ ] JSON metadata file ready

## Files You Need

### 1. Video File
Any video format:
- ✅ MP4 (most common)
- ✅ MKV
- ✅ WebM
- ✅ AVI
- ✅ MOV

Size: 50MB - 5GB (larger = longer processing)

### 2. JSON Metadata File

Minimum format:
```json
[
  {
    "short_video_clip": "Scene_01",
    "matched_in_movie": {
      "start_timestamp": "00:01:16",
      "end_timestamp": "00:03:03"
    }
  },
  {
    "short_video_clip": "Scene_02",
    "matched_in_movie": {
      "start_timestamp": "00:05:00",
      "end_timestamp": "00:07:30"
    }
  }
]
```

See `EXAMPLE_METADATA.json` for full format.

## 3-Step Process

### STEP 1: Upload (1 minute)
```
┌─────────────────────────────────┐
│ Click: Select Movie File        │ → Choose your video
│ Click: Select JSON File         │ → Choose your metadata
│ Click: Continue to Preview      │ → Go to next step
└─────────────────────────────────┘
```

### STEP 2: Extract (5-30 minutes depends on video size)
```
┌─────────────────────────────────┐
│ Review clips in preview         │ → Check everything looks right
│ Click: Extract All Clips        │ → Processing starts...
│ Wait for completion             │ → Takes time (grab coffee ☕)
│ Move to merge step              │ → Automatically when done
└─────────────────────────────────┘
```

### STEP 3: Merge & Download (1-5 minutes)
```
┌─────────────────────────────────┐
│ Click: Merge & Download         │ → Combines all clips
│ Download starts automatically   │ → merged_video.mp4
│ Done! ✨                        │ → Open in video player
└─────────────────────────────────┘
```

## Timestamps Format

Always use: **HH:MM:SS**

Examples:
- `00:00:00` ← Start of video
- `00:05:30` ← 5 minutes, 30 seconds
- `01:23:45` ← 1 hour, 23 minutes, 45 seconds

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| FFmpeg not found | Install FFmpeg (see SETUP.md) |
| JSON parse error | Check JSON syntax (use jsonlint.com) |
| Extract failed | Verify video format is supported |
| Merge failed | Ensure extraction completed |
| Port 3000 in use | Run `pnpm dev -p 3001` |
| Out of disk space | Free up 10GB+ before processing |

## What Happens Behind the Scenes

```
Your Video + JSON
       ↓
   Upload
       ↓
   Parse Timestamps
       ↓
   Extract Each Clip (1:1 to 1:N)
       ├─ Clip 1.mp4
       ├─ Clip 2.mp4
       ├─ Clip 3.mp4
       └─ Clip N.mp4
       ↓
   Merge All Clips
       ↓
  merged_video.mp4
       ↓
   Download
```

## Example Workflow

**Scenario:** Extract 3 clips from a 200MB movie

1. **Get your files ready:**
   ```
   movie.mp4 (200 MB)
   clips.json (contains 3 clips)
   ```

2. **Start the app:**
   ```bash
   pnpm dev
   ```

3. **Upload:**
   - Open http://localhost:3000
   - Upload movie.mp4
   - Upload clips.json
   - Click Continue

4. **Preview:**
   - See all 3 clips listed
   - Check timestamps
   - Click Extract

5. **Extract (≈10 minutes for 200MB):**
   - App processes each clip
   - Creates clip_1.mp4, clip_2.mp4, clip_3.mp4
   - Automatically moves to merge

6. **Merge (≈1 minute):**
   - Click Merge & Download
   - Browser downloads merged_video.mp4
   - Done! ✨

## Performance Timeline

| Video Size | # Clips | Time to Extract | Time to Merge | Total |
|-----------|---------|------------------|---------------|-------|
| 50 MB | 5 | 2 min | 1 min | 3 min |
| 100 MB | 10 | 4 min | 2 min | 6 min |
| 200 MB | 15 | 8 min | 2 min | 10 min |
| 500 MB | 20 | 20 min | 3 min | 23 min |
| 1 GB | 30 | 45 min | 5 min | 50 min |

## Pro Tips 💡

✅ **DO:**
- Test with small video first (< 100MB)
- Keep JSON file well-formatted
- Ensure timestamps match your video
- Monitor disk space during processing
- Use H.264 video codec for best results

❌ **DON'T:**
- Upload extremely large videos (> 2GB) as first test
- Manually stop the process mid-extraction
- Close the browser during merge
- Delete temp files while processing
- Extract too many clips at once

## Getting Output Files

### Downloaded File
- **Name:** `merged_video.mp4`
- **Location:** Your browser's Downloads folder
- **Size:** Total size of all extracted clips
- **Quality:** Same as source video

### Can You Access Intermediate Files?
- Individual clips stored in: `public/temp/`
- Files auto-cleaned after download
- Don't manually modify these files

## Need Help?

1. **Setup issues?** → Read SETUP.md
2. **Usage questions?** → Read USAGE_GUIDE.md
3. **Technical details?** → Read README.md
4. **JSON format?** → See EXAMPLE_METADATA.json

## One Last Thing

Your timestamps must match your source video!

❌ Wrong:
```json
{
  "start_timestamp": "00:01:16",
  "end_timestamp": "00:03:03"
}
// But your video is only 45 seconds long
```

✅ Right:
```json
{
  "start_timestamp": "00:00:05",
  "end_timestamp": "00:00:30"
}
// Matches your actual video duration
```

---

**You're ready! 🚀**

Open http://localhost:3000 and start extracting clips!
