# 拉片数据 JSON Schema

Create `项目名/拉片数据.json` as UTF-8 JSON.

```json
{
  "project": "项目二",
  "video": "素材/video.mp4",
  "title": "片名或产品名拉片笔记",
  "durationSeconds": 46.17,
  "visualSummary": "A polished paragraph describing the overall visual style.",
  "shots": [
    {
      "shot": 1,
      "start": 0,
      "end": 2.17,
      "duration": 2.17,
      "image": "分镜/video_0001.jpg",
      "scaleAngle": "中近景 / 平视偏低 / 暗场开篇",
      "movement": "淡入式亮度变化，机位基本固定。",
      "content": "Detailed visual description of subject, props, action, composition, light, focus, color, mood, and product cues.",
      "notes": "Brief analytical note or production takeaway."
    }
  ]
}
```

## Field Rules

- `shot`: 1-based integer.
- `start`, `end`, `duration`: seconds. Round to 2 decimals unless precision matters.
- `image`: relative path from the project folder to the keyframe JPG.
- `scaleAngle`: include shot size and camera angle; add a short function label when useful.
- `movement`: describe camera movement and subject/action movement separately if needed.
- `content`: make this the richest field. It should be detailed enough that someone could reverse-prompt an image or video shot from it.
- `notes`: keep concise; mention narrative function, brand function, or edit rhythm.
- `visualSummary`: summarize light, palette, lens/depth of field, pacing, recurring props, composition, and overall commercial/MV tone.

## Storyboard Layout Notes

The PPT generator expects vertical keyframes but creates 16:9 horizontal slides. It crops images to equal cards and puts captions below each image. Use concise captions in the generated board; keep full details in Markdown.
