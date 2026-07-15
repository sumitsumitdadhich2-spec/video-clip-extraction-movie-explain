# Setup Guide

## System Requirements

- **Node.js**: 18.x or higher
- **FFmpeg**: Latest stable version
- **Disk Space**: At least 5-10 GB for video processing
- **RAM**: 4GB minimum (8GB+ recommended for large videos)

## Installation Steps

### 1. Install FFmpeg

**macOS (Homebrew):**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Windows:**
1. Download from https://ffmpeg.org/download.html
2. Extract to a folder (e.g., `C:\ffmpeg`)
3. Add to PATH environment variable
4. Verify: `ffmpeg -version`

**Verify Installation:**
```bash
ffmpeg -version
# Should show version info
```

### 2. Install Project Dependencies

```bash
# Using pnpm (recommended)
pnpm install

# Or using npm
npm install

# Or using yarn
yarn install
```

### 3. Start Development Server

```bash
pnpm dev
```

Server will start on `http://localhost:3000`

### 4. Access the Application

Open your browser and navigate to:
```
http://localhost:3000
```

## Project Structure

```
.
├── app/
│   ├── page.tsx                 # Main UI
│   ├── layout.tsx               # App layout
│   ├── globals.css              # Global styles
│   └── api/
│       ├── extract-clips/       # Clip extraction endpoint
│       └── merge-clips/         # Clip merging endpoint
├── components/
│   ├── video-uploader.tsx       # File upload component
│   ├── clip-previewer.tsx       # Clip preview component
│   ├── video-merger.tsx         # Merge status component
│   └── ui/
│       └── button.tsx           # Button component
├── public/
│   └── temp/                    # Temporary video files (created at runtime)
├── README.md                    # Main documentation
├── USAGE_GUIDE.md              # Detailed usage guide
├── SETUP.md                     # This file
├── EXAMPLE_METADATA.json        # Example JSON format
└── package.json                 # Dependencies
```

## Configuration

### Environment Variables

Currently, no environment variables are required for basic operation.

For production deployment, you may want to configure:
```env
# Optional: Maximum file upload size (in MB)
MAX_FILE_SIZE=5000

# Optional: Output directory for merged videos
OUTPUT_DIR=/path/to/videos

# Optional: Temporary directory for processing
TEMP_DIR=/path/to/temp
```

## Troubleshooting Setup

### Issue: "FFmpeg command not found"

**Solution:**
1. Verify FFmpeg installation: `ffmpeg -version`
2. If not found, install following instructions above
3. Ensure it's in your system PATH
4. On Windows, restart terminal after adding to PATH

### Issue: "ENOENT: no such file or directory 'public/temp'"

**Solution:**
- Folder is created automatically on first use
- If error persists, create manually:
  ```bash
  mkdir -p public/temp
  chmod 755 public/temp
  ```

### Issue: "Module not found" errors

**Solution:**
1. Ensure all dependencies installed: `pnpm install`
2. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules pnpm-lock.yaml
   pnpm install
   ```

### Issue: Port 3000 already in use

**Solution:**
```bash
# Use different port
pnpm dev -- -p 3001

# Or kill process using port 3000
# On macOS/Linux:
lsof -ti:3000 | xargs kill -9

# On Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

## Development

### Run Development Server
```bash
pnpm dev
```

### Build for Production
```bash
pnpm build
```

### Start Production Server
```bash
pnpm start
```

### Run Linter
```bash
pnpm lint
```

## Testing

To test the application:

1. **Prepare Test Files:**
   - Download a small video (< 100MB)
   - Prepare a JSON metadata file (see EXAMPLE_METADATA.json)

2. **Upload and Test:**
   - Open http://localhost:3000
   - Upload video and JSON
   - Review clip previews
   - Extract clips
   - Merge and download

3. **Verify Output:**
   - Check downloaded merged_video.mp4
   - Play in video player
   - Verify all clips present

## Deployment

### Deploy to Vercel

```bash
# Push to GitHub first
git add .
git commit -m "Initial commit"
git push

# Then use Vercel CLI or web interface
vercel
```

### Key Deployment Notes

1. **FFmpeg Availability:**
   - Vercel doesn't have FFmpeg pre-installed
   - May need to use custom Docker deployment
   - Consider using AWS Lambda with FFmpeg layer

2. **File Storage:**
   - Public temp directory may not persist across builds
   - Implement cloud storage (Vercel Blob, S3) for production
   - Update temporary file paths accordingly

3. **Timeout Issues:**
   - Default serverless timeout: 10-30 seconds
   - Current config: 300 seconds (5 minutes)
   - May need optimization for larger videos

### Environment for Production

For production with cloud storage:

```javascript
// Update API routes to use cloud storage
import { put, get } from '@vercel/blob';

// Save temporary files to Blob storage instead of local disk
const blob = await put(filename, fileBuffer);
```

## Performance Optimization

### For Local Development
- Use smaller test videos initially
- Process during less resource-intensive times
- Monitor disk space for temp files

### For Production
- Implement job queue for video processing (Bull, RabbitMQ)
- Use CDN for downloaded videos
- Optimize FFmpeg parameters
- Implement progress websockets

### Memory Management
```javascript
// Limit concurrent processing
const MAX_CONCURRENT_JOBS = 2;

// Monitor and cleanup temp files
// Run daily cleanup of files older than 24 hours
```

## Maintenance

### Regular Tasks

**Daily:**
- Monitor disk space
- Check error logs

**Weekly:**
- Clean up temp files
  ```bash
  find public/temp -type f -mtime +7 -delete
  ```

**Monthly:**
- Review FFmpeg version updates
- Update Node dependencies
  ```bash
  pnpm update
  ```

## Support & Resources

- **FFmpeg Docs**: https://ffmpeg.org/documentation.html
- **Next.js Docs**: https://nextjs.org/docs
- **Node.js Docs**: https://nodejs.org/docs/
- **fluent-ffmpeg**: https://github.com/fluent-ffmpeg/node-fluent-ffmpeg

## Quick Commands Reference

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build

# Run linter
pnpm lint

# Clean temp files
rm -rf public/temp/*

# Check FFmpeg
ffmpeg -version

# View process using port 3000
lsof -i :3000
```

---

You're all set! 🚀 Start using the Video Clip Extractor & Merger!
