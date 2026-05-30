# 拉片数据 JSON Schema

Create `项目名/拉片数据.json` as UTF-8 JSON.

```json
{
  "project": "项目二",
  "video": "素材/video.mp4",
  "title": "片名或产品名拉片笔记",
  "durationSeconds": 46.17,
  "storyboardTitle": "可选：用于 PPT 顶部的大标题",
  "boardSubtitle": "可选：用于 PPT 顶部的小标题信息",
  "visualSummary": "A polished paragraph describing the overall visual style.",
  "boardFooters": [
    {
      "left": "可选：第一页页脚左侧文字",
      "right": "可选：第一页页脚右侧文字"
    }
  ],
  "shots": [
    {
      "shot": 1,
      "title": "可选：PPT 中显示的短镜头名",
      "start": 0,
      "end": 2.17,
      "duration": 2.17,
      "image": "分镜/video_0001.jpg",
      "scaleAngle": "中近景 / 平视偏低 / 暗场开篇",
      "movement": "淡入式亮度变化，机位基本固定。",
      "content": "Detailed visual description of subject, props, action, composition, light, focus, color, mood, and product cues.",
      "boardContent": "可选：PPT 中显示的短版画面说明。",
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
- `storyboardTitle`, `boardSubtitle`: optional PPT title text. Use these when the default title is too generic.
- `boardFooters`: optional per-page footer text. Each entry can include `left` and `right`.
- `title`: optional short shot title for the PPT card.
- `boardContent`: optional short card description for the PPT. Keep the full prompt-like detail in `content`.

## Storyboard Layout Notes

The PPT generator expects vertical keyframes but creates 16:9 horizontal slides. It crops images to equal cards and puts captions below each image. Use concise captions in the generated board; keep full details in Markdown.
