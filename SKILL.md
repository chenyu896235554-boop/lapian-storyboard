---
name: lapian-storyboard
description: Video shot-analysis and storyboard workflow for Chinese "拉片" project folders. Use when Codex needs to process project videos in 素材, export scene keyframes to 分镜, write a Markdown 拉片笔记 with a shot table, create/edit 拉片数据.json, and generate one horizontal commercial-video storyboard PPT similar to a visual shot board.
---

# Lapian Storyboard

## Goal

Turn a project folder such as `项目二/素材/*.mp4` into:
- scene keyframes in `项目二/分镜`
- a Markdown shot-analysis note named `项目二_拉片笔记.md`
- one horizontal PPT storyboard named `项目二_分镜故事板.pptx`

Do not leave multiple competing PPT outputs unless the user asks for them. Preserve source videos.

## Folder Convention

Use the user's workspace root as the command working directory. A project folder should look like:

```text
项目名/
  素材/
    video.mp4
  分镜/
```

The scripts are in this skill's `scripts/` directory:
- `storyboard-workflow.mjs`: detect shots and export keyframe JPGs.
- `lapian-board.mjs`: read `拉片数据.json`, write Markdown, and generate the final horizontal storyboard PPT.

The scripts are Node-only and do not require npm packages. They find `ffmpeg`/`ffprobe` from PATH, common Windows Jianying/helper-app paths, or common macOS Homebrew paths. `FFMPEG_PATH` and `FFPROBE_PATH` can override discovery.

## Install On Another Machine

Copy the whole skill folder to the target machine's Codex skills directory:

```text
Windows: %USERPROFILE%\.codex\skills\lapian-storyboard
macOS:   ~/.codex/skills/lapian-storyboard
```

On macOS, install dependencies if missing:

```bash
brew install node ffmpeg
```

If Homebrew is not available, install Node.js from nodejs.org and ffmpeg from a trusted macOS build, then set `FFMPEG_PATH` and `FFPROBE_PATH` if they are not on PATH.

## Workflow

1. Inspect the project and videos.
   - Confirm `素材` contains at least one video.
   - Ignore unrelated existing outputs unless they block overwriting.

2. Export scene keyframes.
   - From the workspace root, run:

```powershell
node "C:\Users\HK\.codex\skills\lapian-storyboard\scripts\storyboard-workflow.mjs" 项目名
```

   - This writes JPGs to `项目名/分镜` and may create a simple `项目名_分镜.pptx`. If the user wants only the final story board, delete that simple PPT after the final PPT is created.

3. Get accurate shot times.
   - Use ffmpeg `select=gt(scene\,threshold),showinfo` with the same threshold used by extraction, then prepend `0` and append total duration.
   - Use adjacent cut points to compute each shot's `start`, `end`, and `duration`.
   - If scene detection under-detects, sample fallback frames and state that times are approximate.

4. Inspect the keyframes.
   - Create or view a contact sheet for overview if useful.
   - Inspect enough individual frames to describe each shot precisely.
   - Write descriptions detailed enough for prompt reverse-engineering: subject, props, composition, focus, light, color, action, mood, and product cues.

5. Create `项目名/拉片数据.json`.
   - Follow `references/lapian-data-schema.md`.
   - Keep image paths relative to the project folder, for example `分镜/134..._0001.jpg`.
   - Keep `visualSummary` as a polished paragraph summarizing the full MV/commercial visual style.

6. Generate the final story board PPT and Markdown note.

```powershell
node "C:\Users\HK\.codex\skills\lapian-storyboard\scripts\lapian-board.mjs" 项目名
```

   - The PPT is one file only: `项目名_分镜故事板.pptx`.
   - The current layout puts up to 7 shots per 16:9 slide, like a commercial storyboard board.
   - If the PPT is locked by WPS/PowerPoint, ask the user to close it or temporarily set `LAPIAN_OUTPUT_PATH` for a preview. Do not create duplicate final PPT names.

7. Validate before final response.
   - Check PPT ZIP structure can be opened.
   - Confirm slide count, embedded image count, and Markdown table row count.
   - Confirm only the intended final PPT remains when the user asked for a single PPT.

## Output Style

For the final response, report:
- the final PPT path
- the Markdown note path
- number of storyboard pages and shots
- any caveat, such as locked files or approximate timing

Keep the response short; the artifacts are the main output.
