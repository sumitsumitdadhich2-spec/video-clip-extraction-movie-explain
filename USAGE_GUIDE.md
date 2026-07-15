# Usage Guide - Video Clip Extractor & Merger

## Quick Start

### Prerequisites
- A video file (MP4, MKV, WebM, etc.)
- A JSON metadata file with temporal grounding data
- FFmpeg installed on your system

### Step-by-Step Instructions

#### Step 1: Upload Your Files

1. **Open the App**
   - Navigate to `http://localhost:3000` (or your deployment URL)
   - You'll see the "Video Clip Extractor & Merger" interface

2. **Upload Your Movie File**
   - Click the "Click to select video" button under "Movie File"
   - OR drag and drop a video file onto the dashed box
   - File will appear with a green checkmark and file size

3. **Upload Your Metadata JSON**
   - Click the "Click to select JSON" button under "Metadata JSON File"
   - OR drag and drop the JSON file onto the dashed box
   - File will appear with a green checkmark and file size

4. **Continue to Preview**
   - Click the "Continue to Preview" button (now enabled)
   - The app will parse your JSON and move to Step 2

#### Step 2: Review Clips Preview

You'll see a scrollable grid of all clips to be extracted:

**For Each Clip, You'll See:**
- **Scene Name**: e.g., "Scene_01"
- **Duration**: Length of the clip in seconds
- **Movie Location**: Start → End timestamps in the source video
- **Match Confidence**: How confident the system is about the match
- **Frames**: Total number of matching frames
- **FPS**: Frames per second of the video

**Tips:**
- Review the confidence scores - they indicate match quality
- Check timestamps make sense for your source video
- Scroll through all clips to ensure they're correct

#### Step 3: Extract All Clips

1. **Click "Extract All Clips"**
   - Button will show "Extracting Clips..." while processing
   - The app will:
     - Parse each clip timestamp from the JSON
     - Extract segments from your source video
     - Save each clip as a separate MP4 file

2. **Processing Times:**
   - Depends on video size and number of clips
   - Small video (< 100MB): 1-5 minutes
   - Medium video (100-500MB): 5-15 minutes
   - Large video (> 500MB): 15-60+ minutes

3. **Success**
   - You'll see a confirmation and move to Step 3
   - System shows number of successfully extracted clips

#### Step 4: Merge & Download

1. **Click "Merge & Download"**
   - Button will show "Merging Videos..."
   - The app will combine all extracted clips in order

2. **Download**
   - Your browser will automatically download `merged_video.mp4`
   - File size depends on total clip duration
   - Video quality matches your source video

## JSON Metadata Format

### Example Format

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
      "movie_name": "source_video.mp4",
      "start_timestamp": "00:01:16",
      "end_timestamp": "00:03:03",
      "confidence": "87.9%",
      "fps_match": 24,
      "total_matching_frames": 33,
      "metadata_validation": "Verified sequence pattern match at 24fps"
    }
  }
]
```

### Required Fields

```json
{
  "short_video_clip": "Unique identifier for this clip",
  "matched_in_movie": {
    "start_timestamp": "HH:MM:SS - Start time in source video",
    "end_timestamp": "HH:MM:SS - End time in source video"
  }
}
```

### Optional Fields (for display/info)

```json
{
  "short_duration": {
    "start": "Clip start in original short video",
    "end": "Clip end in original short video",
    "duration_seconds": "Length in seconds"
  },
  "matched_in_movie": {
    "movie_name": "Source video filename",
    "confidence": "Match quality percentage",
    "fps_match": "Frames per second",
    "total_matching_frames": "Number of frames",
    "metadata_validation": "Validation notes"
  }
}
```

## Timestamp Format

All timestamps must be in **HH:MM:SS** format:
- `00:00:00` - Start of video
- `01:23:45` - 1 hour, 23 minutes, 45 seconds
- `23:59:59` - Maximum valid time

## Common Scenarios

### Scenario 1: Extract Scenes from Movie for Clip Compilation

**Setup:**
- Have a full movie file
- Have JSON with copyright claim data or your own annotations

**Process:**
1. Upload movie and JSON
2. Review clips in preview
3. Extract and merge
4. Download the compilation video

### Scenario 2: Extract Multiple Segments

**Setup:**
- One source video
- Multiple clips to extract at different timestamps

**Process:**
- JSON should contain all clips
- They'll be extracted in order and merged sequentially
- Final video combines all in JSON order

### Scenario 3: Verify Clips Before Merging

**Setup:**
- Want to check individual clips first

**Process:**
1. Upload and extract clips (they're saved in `public/temp/`)
2. Review individually if needed
3. Then merge and download

## Troubleshooting

### Problem: "Failed to parse JSON file"
**Solutions:**
- Verify JSON syntax is valid (use https://jsonlint.com)
- Ensure file is plain text, not formatted
- Check that timestamps are strings in "HH:MM:SS" format

### Problem: "Failed to extract clips"
**Solutions:**
- Verify video format is supported (MP4, MKV, WebM, etc.)
- Check that FFmpeg is installed: `ffmpeg -version`
- Ensure source video isn't corrupted
- Check available disk space

### Problem: "Failed to merge clips"
**Solutions:**
- Check that all clips extracted successfully
- Verify there's enough disk space for merged file
- Try extracting fewer clips if file is very large

### Problem: Download doesn't start
**Solutions:**
- Check browser download settings
- Try a different browser
- Check that merge process completed

### Problem: Video plays incorrectly
**Solutions:**
- Verify source video is valid and plays
- Try a different video player
- Check that extracted clips have consistent codec

## Tips & Tricks

### For Large Videos
- Process during off-hours
- Monitor system resources (CPU, disk space)
- Consider splitting large JSON into smaller batches

### For Best Quality
- Use source video in H.264 codec (MP4)
- Ensure consistent frame rate
- Verify all clips have matching properties

### For Faster Processing
- Use smaller video files
- Reduce number of clips
- Ensure system has adequate RAM

### For Production Use
- Test with small sample first
- Verify output video quality
- Check file sizes are as expected
- Implement error handling in your workflow

## API Integration

For developers who want to integrate this into their workflow:

### Extract Clips API
```bash
curl -X POST http://localhost:3000/api/extract-clips \
  -F "video=@movie.mp4" \
  -F "clips=[{...}]"
```

### Merge Clips API
```bash
curl -X POST http://localhost:3000/api/merge-clips \
  -H "Content-Type: application/json" \
  -d '{"clips":[...]}'
```

## File Management

### Temporary Files
- Stored in: `public/temp/`
- Created during extraction and merging
- Deleted automatically after download
- If issue occurs, manually clean the directory

### Cleanup
To clean temporary files:
```bash
rm -rf public/temp/*
```

## Performance Expectations

| Video Size | Clips Count | Approx. Time |
|-----------|-------------|------------|
| 50 MB | 5 | 1-2 min |
| 100 MB | 10 | 3-5 min |
| 250 MB | 15 | 8-12 min |
| 500 MB | 20 | 15-25 min |
| 1 GB | 30 | 30-60 min |

*Times are estimates and depend on system specifications*

## Getting Help

1. **Check JSON Format**: Use the provided example
2. **Verify FFmpeg**: `ffmpeg -version`
3. **Check Timestamps**: Ensure they match your source video
4. **Browser Console**: Press F12 to see any error messages
5. **Server Logs**: Check terminal output for detailed errors

## Next Steps

After downloading your merged video:
1. Play it in your video player
2. Verify all clips are in correct order
3. Check audio synchronization
4. Re-encode if needed for your platform

Enjoy extracting and merging your video clips! 🎬
