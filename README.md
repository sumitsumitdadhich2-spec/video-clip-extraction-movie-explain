# Video Clip Extractor & Merger

A powerful Next.js application that extracts video clips from a movie file using temporal grounding metadata and merges them into a single video file. Perfect for processing copyright detection results or any temporal annotation data.

## Features

✨ **Key Features:**
- **Upload Video & Metadata**: Upload a movie file and JSON temporal grounding data
- **Clip Preview**: View all clips to be extracted with confidence scores and timestamps
- **Automated Extraction**: Extract clips from the movie using precise timestamps from FFmpeg
- **Smart Merging**: Combine all extracted clips into a single seamless video
- **One-Click Download**: Download the merged video directly to your computer
- **Progress Tracking**: Visual step-by-step progress through the extraction and merging process

## How It Works

### Step 1: Upload Files
Upload two files:
1. **Movie File** (MP4, MKV, WebM, etc.) - The source video from which clips will be extracted
2. **Metadata JSON** - Temporal grounding data containing clip timestamps and metadata

### Step 2: Preview Clips
Review all the clips that will be extracted:
- See clip names and scene information
- View timestamps in the source movie
- Check match confidence scores
- Verify frame count and FPS

### Step 3: Extract Clips
Click "Extract All Clips" to:
- Parse the JSON metadata
- Extract each clip from the source video using FFmpeg
- Preserve video quality and audio
- Process all clips in order

### Step 4: Merge & Download
Merge all extracted clips into one video:
- Combines clips in the order specified in the metadata
- Maintains consistent codec and quality
- Ready for download or further processing

## JSON Metadata Format

The metadata JSON should follow this format:

```json
[
  {
    "short_video_clip": "Scene_01",
    "short_duration": {
      "start": "00:00:00",
      "end": "00:01:07",
      "duration_seconds": 67.33
    },
    "matched_in_movie": {
      "movie_name": "video.mp4",
      "start_timestamp": "00:01:16",
      "end_timestamp": "00:03:03",
      "confidence": "87.9%",
      "fps_match": 24,
      "total_matching_frames": 33,
      "metadata_validation": "Verified sequence pattern match at 24fps"
    }
  },
  {
    "short_video_clip": "Scene_02",
    "short_duration": {
      "start": "00:01:07",
      "end": "00:01:08",
      "duration_seconds": 0.33
    },
    "matched_in_movie": {
      "movie_name": "video.mp4",
      "start_timestamp": "00:02:15",
      "end_timestamp": "00:02:45",
      "confidence": "87.4%",
      "fps_match": 24,
      "total_matching_frames": 8,
      "metadata_validation": "Verified sequence pattern match at 24fps"
    }
  }
]
```

### Required Fields:
- `short_video_clip` - Name/ID of the clip (e.g., "Scene_01")
- `matched_in_movie.start_timestamp` - Start time in HH:MM:SS format
- `matched_in_movie.end_timestamp` - End time in HH:MM:SS format

### Optional Fields:
- `confidence` - Match confidence percentage
- `fps_match` - Frames per second
- `total_matching_frames` - Number of matching frames
- `metadata_validation` - Validation notes

## Use Cases

🎬 **Copyright Detection**: Extract clips from copyright claim temporal grounding data
📊 **Video Analysis**: Process temporal annotation results from ML models
🎞️ **Video Summarization**: Extract key moments and create highlight reels
📹 **Content Moderation**: Extract flagged clips for review

## Technology Stack

- **Framework**: Next.js 16 with React 19
- **Video Processing**: FFmpeg (fluent-ffmpeg)
- **File Handling**: Formidable
- **Styling**: Tailwind CSS with shadcn/ui
- **Validation**: Zod

## Getting Started

### Installation

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

Visit `http://localhost:3000` in your browser.

### System Requirements

- **Node.js**: 18.x or higher
- **FFmpeg**: Must be installed on the system
  - On macOS: `brew install ffmpeg`
  - On Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - On Windows: Download from https://ffmpeg.org/download.html

## Environment Setup

No environment variables required for basic usage. The app uses:
- Local file storage in `public/temp/` directory
- Server-side FFmpeg for video processing

## API Routes

### POST `/api/extract-clips`
Extracts clips from the uploaded video.

**Request:**
- `FormData`:
  - `video`: Video file (File)
  - `clips`: JSON array of clip objects (string)

**Response:**
```json
{
  "success": true,
  "clips": [
    {
      "id": 0,
      "name": "Scene_01",
      "path": "/temp/clip_1.mp4",
      "order": 0
    }
  ],
  "message": "Extracted X clips"
}
```

### POST `/api/merge-clips`
Merges extracted clips into one video.

**Request:**
```json
{
  "clips": [
    {
      "id": 0,
      "name": "Scene_01",
      "path": "/temp/clip_1.mp4"
    }
  ]
}
```

**Response:**
- Returns the merged video file as binary data

## UI Components

### VideoUploader
- Drag-and-drop file upload
- Individual file selection
- File validation and size display
- JSON format reference

### ClipPreviewer
- List of all clips to be extracted
- Timestamps and confidence scores
- Frame and FPS information
- Scrollable grid layout

### VideoMerger
- Merge status and clip order
- Processing indicators
- Merge and download button

## Limitations & Notes

⚠️ **Important:**
- Processing time depends on video size and clip count
- Very large videos may take several minutes
- Temporary files are stored in `public/temp/`
- Clean up old temporary files periodically
- Maximum request timeout: 5 minutes (300 seconds)

## Troubleshooting

### "FFmpeg not found"
- Install FFmpeg on your system
- Ensure it's in your system PATH

### "Failed to extract clips"
- Check that the video file format is supported
- Verify JSON metadata format matches specification
- Check available disk space for temporary files

### "Failed to merge clips"
- Ensure all clips were successfully extracted
- Verify clip paths are correct
- Check disk space for output file

## Performance Tips

- Use H.264 video codec for maximum compatibility
- Keep audio codec as AAC for web compatibility
- Process videos in batches if handling multiple files
- Monitor disk space for temporary files

## Future Enhancements

- 🚀 Batch processing support
- 🎨 Video preview player before merging
- ⚙️ Codec selection and quality options
- 📊 Progress bar for long operations
- 🔄 Resume interrupted extractions
- ☁️ Cloud storage integration

## License

MIT License - feel free to use this in your projects!

## Support

For issues or questions:
1. Check the JSON metadata format
2. Verify FFmpeg is installed and working
3. Check browser console for error messages
4. Review server logs for detailed error information

---

Built with ❤️ using Next.js and FFmpeg
