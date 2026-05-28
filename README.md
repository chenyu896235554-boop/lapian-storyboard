# 拉片故事板 Skill

`lapian-storyboard` 是一个 Codex skill，用来把项目文件夹里的视频自动做成“拉片故事板”：

- 从 `素材` 文件夹中的视频检测镜头变化
- 导出每个镜头的关键帧到 `分镜`
- 生成 Markdown 拉片笔记，包含镜号、景别/角度、运动、画面内容、时长、参考画面、备注
- 根据拉片数据生成一个横版 16:9 故事板 PPT
- 适合短视频、广告片、MV、产品片、生活方式片的分镜拆解和复盘

## 项目目录要求

把视频放在项目的 `素材` 文件夹里：

```text
拉片/
  项目一/
    素材/
      video.mp4
    分镜/
```

如果没有 `分镜` 文件夹，脚本会自动创建。

## 在 Codex 中使用

把本 skill 放到 Codex skills 目录：

```text
Windows: %USERPROFILE%\.codex\skills\lapian-storyboard
macOS:   ~/.codex/skills/lapian-storyboard
```

然后在 Codex 里直接说：

```text
用 $lapian-storyboard 跑一下项目一
```

也可以说：

```text
把 项目一 做成拉片故事板 PPT，用 lapian-storyboard
```

## 手动运行脚本

进入包含项目文件夹的工作区，例如：

```powershell
cd C:\Users\HK\Downloads\拉片
```

先抽分镜关键帧：

```powershell
node "%USERPROFILE%\.codex\skills\lapian-storyboard\scripts\storyboard-workflow.mjs" 项目一
```

再根据 `项目一\拉片数据.json` 生成拉片笔记和故事板 PPT：

```powershell
node "%USERPROFILE%\.codex\skills\lapian-storyboard\scripts\lapian-board.mjs" 项目一
```

## 输出文件

运行后会在项目目录里得到：

```text
项目一/
  分镜/
    video_0001.jpg
    video_0002.jpg
    ...
  拉片数据.json
  项目一_拉片笔记.md
  项目一_分镜故事板.pptx
```

`项目一_分镜故事板.pptx` 是最终 PPT。默认一页最多放 7 个镜头，镜头多时会自动拆成多页，但仍只生成一个 PPT。

## 拉片数据格式

`lapian-board.mjs` 读取 `项目名\拉片数据.json`。核心字段示例：

```json
{
  "project": "项目一",
  "video": "素材/video.mp4",
  "title": "产品短片拉片笔记",
  "durationSeconds": 46.17,
  "visualSummary": "整体视觉风格总结...",
  "shots": [
    {
      "shot": 1,
      "start": 0,
      "end": 2.17,
      "duration": 2.17,
      "image": "分镜/video_0001.jpg",
      "scaleAngle": "中近景 / 平视偏低",
      "movement": "机位固定，手部把产品带入画面。",
      "content": "详细画面描述...",
      "notes": "镜头作用或拍摄备注。"
    }
  ]
}
```

更完整的字段说明见：

```text
references/lapian-data-schema.md
```

## 依赖

需要：

- Node.js
- ffmpeg / ffprobe

Windows 上脚本会尝试自动查找剪映自带的 `ffmpeg.exe`。如果找不到，可以手动设置：

```powershell
$env:FFMPEG_PATH="D:\Tools\ffmpeg\ffmpeg.exe"
$env:FFPROBE_PATH="D:\Tools\ffmpeg\ffprobe.exe"
```

macOS 可以用 Homebrew 安装：

```bash
brew install node ffmpeg
```

## 注意事项

- 源视频不会被修改。
- 如果 PPT 被 WPS 或 PowerPoint 打开，脚本无法覆盖，需要先关闭文件。
- 镜头检测基于画面变化，遇到极慢剪辑或大量叠化时，可能需要人工修正 `拉片数据.json`。
- Markdown 笔记负责完整描述，PPT 负责故事板排版展示。
