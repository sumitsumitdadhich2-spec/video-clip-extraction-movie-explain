# Getting Started Checklist

## Before You Start

- [ ] You have a video file (MP4, MKV, WebM, AVI, MOV)
- [ ] You have a JSON metadata file with timestamps
- [ ] You have Node.js 18+ installed
- [ ] You have FFmpeg installed
- [ ] You have 5-10 GB free disk space
- [ ] You're ready to process your video!

## Installation (10 minutes)

### Step 1: Check Prerequisites
```bash
# Check Node.js
node -v
# Should show v18.0.0 or higher

# Check FFmpeg
ffmpeg -version
# Should show FFmpeg version info
```

If either is missing:
- Install Node.js from https://nodejs.org/
- Install FFmpeg following SETUP.md

### Step 2: Clone/Download Project
```bash
# Navigate to project directory
cd video-clip-extractor

# Or download and extract the ZIP file
```

### Step 3: Install Dependencies
```bash
# Using pnpm (recommended)
pnpm install

# Or using npm
npm install

# Or using yarn
yarn install
```

This takes 2-5 minutes depending on internet speed.

### Step 4: Prepare Your Files

Create a folder with your files:
```
my_project/
├── movie.mp4              (your video file)
├── metadata.json          (your timestamps)
└── ...
```

**Video File:**
- Format: MP4, MKV, WebM, AVI, MOV
- Size: 50MB - 5GB
- Quality: Any quality works

**JSON File:**
- Must contain clip timestamps
- See EXAMPLE_METADATA.json for format
- Must be valid JSON

### Step 5: Start the App
```bash
pnpm dev
```

You'll see:
```
▲ Next.js 16.2.6
  - Local:        http://localhost:3000
  - Environment:  development
```

### Step 6: Open in Browser
- Click the link or go to: http://localhost:3000
- You should see the Video Clip Extractor interface

✅ **Installation Complete!**

---

## Using the App (Quick Run)

### 1. Upload (1 minute)
```
1. Click "Click to select video" button
2. Choose your video file
3. Click "Click to select JSON" button
4. Choose your metadata JSON
5. Click "Continue to Preview"
```

### 2. Preview (2 minutes)
```
1. Scroll through and review all clips
2. Check timestamps match your video
3. Verify clip count is correct
4. Click "Extract All Clips"
```

### 3. Extract (5-30 minutes)
```
Button shows "Extracting Clips..."
Wait for processing to complete
```
☕ *Grab a coffee - this takes time based on video size*

### 4. Merge & Download (1-5 minutes)
```
1. Click "Merge & Download"
2. Browser downloads merged_video.mp4
3. Check your Downloads folder
4. Open and play the video
```

✅ **Done!** 🎉

---

## First Time Setup

### Quick Reference

| Step | Action | Time |
|------|--------|------|
| 1 | Check prerequisites | 2 min |
| 2 | Install dependencies | 3 min |
| 3 | Start server | 1 min |
| 4 | Upload files | 1 min |
| 5 | Preview clips | 2 min |
| 6 | Extract | 5-30 min |
| 7 | Merge & download | 2 min |
| **Total** | **First run** | **15-45 min** |

### Test Your Setup

**Without real video:**
1. Download EXAMPLE_METADATA.json
2. Create a test video (or use any MP4 < 50MB)
3. Follow the workflow above
4. Verify output works

This confirms everything is working!

---

## Common First-Time Issues

### Issue: "command not found: pnpm"
```bash
# Solution: Use npm instead
npm install
npm run dev

# Or install pnpm
npm install -g pnpm
```

### Issue: "FFmpeg not found"
```bash
# Solution: Install FFmpeg

# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows - Download from https://ffmpeg.org/download.html
```

### Issue: "Port 3000 already in use"
```bash
# Solution: Use different port
pnpm dev -p 3001
# Then open: http://localhost:3001
```

### Issue: "Cannot find module 'next'"
```bash
# Solution: Install dependencies
pnpm install

# Or reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

---

## File Preparation Guide

### Prepare Your Video

**Good Format:**
- MP4 with H.264 video, AAC audio
- 30 fps frame rate
- Bit rate: 5-20 Mbps

**Find Video Info:**
```bash
# Use FFmpeg to check
ffprobe movie.mp4
```

### Prepare Your JSON

**Minimum Required:**
```json
[
  {
    "short_video_clip": "Scene_1",
    "matched_in_movie": {
      "start_timestamp": "00:00:05",
      "end_timestamp": "00:00:30"
    }
  }
]
```

**Full Example:**
See `EXAMPLE_METADATA.json` in project root

**Validate JSON:**
1. Use https://jsonlint.com
2. Paste your JSON
3. Click "Validate"
4. Fix any errors

---

## Step-by-Step Workflow

### Phase 1: Preparation (5 minutes)

- [ ] Video file ready and tested
- [ ] JSON file created and validated
- [ ] Timestamps verified to match video
- [ ] Enough disk space checked
- [ ] All files in accessible location

### Phase 2: Installation (5 minutes)

- [ ] Node.js installed
- [ ] FFmpeg installed
- [ ] Project dependencies installed
- [ ] Dev server running on http://localhost:3000

### Phase 3: Upload (2 minutes)

- [ ] Video file uploaded
- [ ] JSON file uploaded
- [ ] Files shown with green checkmarks
- [ ] "Continue to Preview" button enabled

### Phase 4: Preview (3 minutes)

- [ ] All clips visible in preview
- [ ] Timestamps look correct
- [ ] Clip count matches your expectations
- [ ] Ready to extract

### Phase 5: Extract (5-30 minutes)

- [ ] Click "Extract All Clips"
- [ ] Watch for "Extracting Clips..." message
- [ ] Wait for completion
- [ ] No errors shown

### Phase 6: Merge (2 minutes)

- [ ] Click "Merge & Download"
- [ ] Browser downloads file
- [ ] File saved to Downloads folder

### Phase 7: Verify (5 minutes)

- [ ] Open merged_video.mp4
- [ ] Play video completely
- [ ] All clips present in order
- [ ] Audio synchronized
- [ ] Quality acceptable

✅ **All Done!**

---

## Post-Processing

### Next Steps After Download

1. **Test the video:**
   - Play in your video player
   - Verify all clips present
   - Check audio sync

2. **Use the video:**
   - Upload to platform
   - Edit further if needed
   - Share with team

3. **Clean up:**
   - Delete temp files: `rm -rf public/temp/*`
   - Archive original files

### Process More Videos

Just repeat the workflow:
1. Open http://localhost:3000
2. Upload new video + JSON
3. Extract and merge
4. Download

---

## Performance Tips

### Faster Processing

- [ ] Use smaller video files first
- [ ] Extract fewer clips at a time
- [ ] Use SSD instead of HDD
- [ ] Close other applications
- [ ] Monitor CPU usage

### Better Quality

- [ ] Use H.264 codec MP4 files
- [ ] Ensure consistent frame rate
- [ ] Verify timestamps are accurate
- [ ] Check source video quality

### Troubleshooting Slow Processing

- Check system resources (CPU, RAM)
- Ensure disk isn't full
- Try smaller test video first
- Check FFmpeg is working: `ffmpeg -i movie.mp4`

---

## Need Help?

### Quick Questions
1. Check QUICK_START.md (5 minutes)
2. Check USAGE_GUIDE.md (detailed steps)
3. Check README.md (technical details)

### Setup Issues
- See SETUP.md for OS-specific instructions
- Verify FFmpeg installation
- Check Node.js version

### Technical Issues
- Check browser console (F12)
- Review server terminal output
- Validate JSON on jsonlint.com
- Check timestamp format (HH:MM:SS)

---

## Success Criteria

You'll know it's working when:

✅ App loads at http://localhost:3000
✅ Can upload video and JSON files
✅ Preview shows all clips
✅ Extraction starts without errors
✅ Merge completes successfully
✅ Downloaded video plays correctly
✅ All clips present in correct order

---

## You're Ready! 🚀

Everything is set up. Now:

1. Prepare your video file
2. Prepare your JSON metadata
3. Run: `pnpm dev`
4. Open: http://localhost:3000
5. Upload and process!

### Questions?

- **Setup issues?** → Read SETUP.md
- **How to use?** → Read USAGE_GUIDE.md
- **Technical?** → Read README.md
- **Quick reference?** → Read QUICK_START.md

### One More Thing

If this is your first time:
- Start with a small test video (< 50MB)
- Use 2-3 test clips first
- Verify it works end-to-end
- Then process your real videos

---

**Let's get started! 🎬**

```bash
pnpm dev
# Open http://localhost:3000
```

Have fun extracting and merging video clips! 🎉
