# 🎬 Video Clip Extractor & Merger - START HERE

Welcome! This app extracts video clips from a movie using temporal grounding data and merges them into one video.

## 📚 Choose Your Path

### 🚀 I Want to Start NOW (5 minutes)
Go to: **QUICK_START.md**
- Fastest way to get running
- Copy-paste commands
- Minimal explanation

### 👋 I'm New - Guide Me (15 minutes)
Go to: **GETTING_STARTED.md**
- Step-by-step checklist
- Setup verification
- Common issues & fixes
- First-time recommendations

### 🛠️ I Need to Install (10 minutes)
Go to: **SETUP.md**
- OS-specific instructions
- Dependency setup
- FFmpeg installation
- Deployment options

### 📖 I Want Full Details (30 minutes)
Go to: **README.md**
- Complete documentation
- All features explained
- API reference
- Technical details

### ❓ How Do I Use This? (20 minutes)
Go to: **USAGE_GUIDE.md**
- Detailed workflow
- JSON format details
- Common scenarios
- Troubleshooting guide

### 📋 Complete Overview (10 minutes)
Go to: **PROJECT_SUMMARY.md**
- What you have
- How it works
- Architecture overview
- Customization ideas

## 🎯 Recommended Reading Order

### For First-Time Users
1. This file (you are here)
2. QUICK_START.md (5 min)
3. GETTING_STARTED.md (15 min)
4. Install and run
5. Reference USAGE_GUIDE.md as needed

### For Developers
1. README.md (technical overview)
2. SETUP.md (installation)
3. PROJECT_SUMMARY.md (architecture)
4. Source code review

### For Operators/DevOps
1. SETUP.md (installation)
2. SETUP.md deployment section
3. PROJECT_SUMMARY.md
4. README.md troubleshooting

## ⚡ Quick Start (TL;DR)

```bash
# 1. Install
pnpm install

# 2. Start
pnpm dev

# 3. Open browser
http://localhost:3000

# 4. Upload video + JSON metadata file
# 5. Extract & merge
# 6. Download result
```

**That's it! 🎉**

## 📁 What's in the Box

```
Project Files:
├── START_HERE.md              ← You are here
├── QUICK_START.md            ← Fastest start
├── GETTING_STARTED.md        ← Beginner guide
├── SETUP.md                  ← Installation guide
├── USAGE_GUIDE.md            ← How to use
├── README.md                 ← Full docs
├── PROJECT_SUMMARY.md        ← Architecture
│
Source Code:
├── app/page.tsx              Main UI
├── app/api/extract-clips/    Extract API
├── app/api/merge-clips/      Merge API
├── components/               UI components
│
Documentation:
├── EXAMPLE_METADATA.json     JSON format example
└── This directory structure
```

## ❓ What Does This App Do?

### Problem It Solves
You have:
- A long movie file
- A JSON file with timestamps of clips you want
- Need: One video with all clips merged

### Solution
This app:
1. Reads your timestamps
2. Extracts each clip from the movie
3. Merges all clips into one video
4. Downloads the result

### Example
```
Input:
- movie.mp4 (2 hours long)
- metadata.json (3 clips: 00:01-00:05, 00:10-00:15, 00:30-00:45)

Process:
- Extract clip 1 (4 sec)
- Extract clip 2 (5 sec)
- Extract clip 3 (15 sec)
- Merge into one video (24 sec)

Output:
- merged_video.mp4 (24 seconds)
```

## 🎯 Use Cases

- **Copyright Detection** - Extract flagged clips from movies
- **Video Highlights** - Create compilations from full videos
- **Content Moderation** - Extract problematic segments
- **Video Analysis** - Process temporal annotation results
- **Clip Compilation** - Combine scenes into new videos

## ✅ Prerequisites

- **Node.js** 18+ (https://nodejs.org)
- **FFmpeg** installed (see SETUP.md)
- **Video file** (MP4, MKV, WebM, AVI, MOV)
- **JSON metadata** with timestamps
- **5-10 GB disk space** for processing

## 🚦 Choose Your Next Step

### Option 1: I'm Ready to Start! 🚀
→ Go to **QUICK_START.md**

### Option 2: I Need More Guidance 👋
→ Go to **GETTING_STARTED.md**

### Option 3: I Need Installation Help 🛠️
→ Go to **SETUP.md**

### Option 4: I Want All Details 📖
→ Go to **README.md**

### Option 5: I Want to Learn About Usage 📝
→ Go to **USAGE_GUIDE.md**

### Option 6: I Want the Big Picture 🎨
→ Go to **PROJECT_SUMMARY.md**

## 📊 Time Estimates

| Task | Time |
|------|------|
| Read this file | 2 min |
| Quick start | 5 min |
| Installation | 5-10 min |
| First run | 5-30 min |
| **Total first time** | **20-50 min** |

*After setup, each workflow takes 5-50 minutes depending on video size*

## 🎬 Example Workflow

### What You'll See

**Step 1: Upload**
- Drag video and JSON files
- Or click to browse

**Step 2: Preview**
- See all clips listed
- Check timestamps
- Review metadata

**Step 3: Extract**
- Click "Extract All Clips"
- Processing happens
- Wait for completion

**Step 4: Merge**
- Click "Merge & Download"
- Video downloads
- Done! ✨

## 💡 Pro Tips

✅ **DO:**
- Test with small video first
- Validate JSON before uploading
- Check timestamp format (HH:MM:SS)
- Ensure FFmpeg is installed

❌ **DON'T:**
- Upload huge videos as first test
- Modify temp files while processing
- Close browser during merge
- Skip reading the docs!

## 🔧 Common Commands

```bash
# Start development
pnpm dev

# Build for production
pnpm build

# Run production
pnpm start

# Check FFmpeg
ffmpeg -version

# Check Node.js
node -v

# Clean temp files
rm -rf public/temp/*
```

## 📞 Need Help?

### Quick Answers
1. Check QUICK_START.md
2. Check USAGE_GUIDE.md
3. Check README.md troubleshooting
4. Check browser console (F12)

### Setup Problems
1. Read SETUP.md for your OS
2. Verify FFmpeg installation
3. Check Node.js version

### Usage Problems
1. Validate JSON (jsonlint.com)
2. Check timestamp format
3. Verify video plays
4. Check disk space

## 🌟 Success!

You'll know it's working when:
- ✅ App loads at http://localhost:3000
- ✅ Can upload files
- ✅ Preview shows clips
- ✅ Extraction completes
- ✅ Video downloads
- ✅ Downloaded video plays

## 🎉 Ready?

### Next: Choose a Path Above ⬆️

**Recommended for first-timers:**
→ GETTING_STARTED.md

**Recommended for experienced users:**
→ QUICK_START.md

**Recommended for all:**
→ Start the app: `pnpm dev`

---

## 📖 All Documentation Files

| File | Purpose | Read Time |
|------|---------|-----------|
| START_HERE.md | This file - navigation | 3 min |
| QUICK_START.md | Fastest start | 5 min |
| GETTING_STARTED.md | Complete first-time guide | 15 min |
| SETUP.md | Installation & deployment | 15 min |
| USAGE_GUIDE.md | How to use the app | 20 min |
| README.md | Full documentation | 30 min |
| PROJECT_SUMMARY.md | Architecture & overview | 10 min |
| EXAMPLE_METADATA.json | JSON format example | 2 min |

---

## 🚀 Let's Go!

```bash
# Installation (one time)
pnpm install

# Start (every time)
pnpm dev

# Open in browser
http://localhost:3000
```

**Pick your starting point above and let's get started! 🎬**

---

Built with ❤️ using Next.js, React, FFmpeg, and Tailwind CSS
