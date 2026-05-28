import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"]);
const ROOT = process.cwd();
const MATERIAL_DIR = "素材";
const FRAME_DIR = "分镜";
const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;
const EMU_PER_INCH = 914400;
let ffmpegPath = "";
let ffprobePath = "";

const defaults = {
  threshold: 0.22,
  minFrames: 8,
  maxFrames: 80,
  cols: 5,
  rows: 2,
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ffmpegPath = await findTool("ffmpeg");
  ffprobePath = await findTool("ffprobe");

  if (!ffmpegPath) {
    throw new Error("Could not find ffmpeg. Install ffmpeg or set FFMPEG_PATH.");
  }
  if (!ffprobePath) {
    throw new Error("Could not find ffprobe. Install ffmpeg with ffprobe, or set FFPROBE_PATH.");
  }

  console.log(`Using ffmpeg: ${ffmpegPath}`);
  console.log(`Using ffprobe: ${ffprobePath}`);

  const projects = await resolveProjects(options);

  if (projects.length === 0) {
    throw new Error("No project folders with a 素材 directory were found.");
  }

  for (const projectDir of projects) {
    await processProject(projectDir, options);
  }
}

function parseArgs(args) {
  const options = { ...defaults, projectNames: [], all: false };

  for (const arg of args) {
    if (arg === "--all") {
      options.all = true;
    } else if (arg.startsWith("--threshold=")) {
      options.threshold = Number(arg.slice("--threshold=".length));
    } else if (arg.startsWith("--min=")) {
      options.minFrames = Number(arg.slice("--min=".length));
    } else if (arg.startsWith("--max=")) {
      options.maxFrames = Number(arg.slice("--max=".length));
    } else if (arg.startsWith("--cols=")) {
      options.cols = Number(arg.slice("--cols=".length));
    } else if (arg.startsWith("--rows=")) {
      options.rows = Number(arg.slice("--rows=".length));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      options.projectNames.push(arg);
    }
  }

  for (const key of ["threshold", "minFrames", "maxFrames", "cols", "rows"]) {
    if (!Number.isFinite(options[key]) || options[key] <= 0) {
      throw new Error(`Invalid option value for ${key}.`);
    }
  }

  options.maxFrames = Math.max(1, Math.floor(options.maxFrames));
  options.minFrames = Math.min(Math.floor(options.minFrames), options.maxFrames);
  options.cols = Math.max(1, Math.floor(options.cols));
  options.rows = Math.max(1, Math.floor(options.rows));

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run storyboard -- 项目一
  npm run storyboard -- --all

Options:
  --threshold=0.22   Scene-change sensitivity. Lower values export more shots.
  --min=8           If too few shots are detected, sample at least this many.
  --max=80          Maximum frames per video.
  --cols=5          Images per slide row.
  --rows=2          Image rows per slide.`);
}

async function resolveProjects(options) {
  if (options.projectNames.length > 0) {
    return options.projectNames.map((name) => path.resolve(ROOT, name));
  }

  if (await exists(path.join(ROOT, MATERIAL_DIR))) {
    return [ROOT];
  }

  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(ROOT, entry.name);
    if (await exists(path.join(projectDir, MATERIAL_DIR))) {
      projects.push(projectDir);
    }
  }

  if (options.all) {
    return projects;
  }

  return projects.slice(0, 1);
}

async function processProject(projectDir, options) {
  const projectName = path.basename(projectDir);
  const materialDir = path.join(projectDir, MATERIAL_DIR);
  const frameDir = path.join(projectDir, FRAME_DIR);
  await fs.mkdir(frameDir, { recursive: true });

  const videos = await listVideos(materialDir);
  if (videos.length === 0) {
    console.log(`[${projectName}] No videos found in ${MATERIAL_DIR}.`);
    return;
  }

  console.log(`[${projectName}] Found ${videos.length} video(s).`);
  const allFrames = [];
  const manifest = {
    project: projectName,
    generatedAt: new Date().toISOString(),
    videos: [],
  };

  for (const videoPath of videos) {
    const result = await extractStoryboardFrames(videoPath, frameDir, options);
    allFrames.push(...result.frames);
    manifest.videos.push({
      source: path.relative(projectDir, videoPath),
      mode: result.mode,
      durationSeconds: round(result.duration, 3),
      frameCount: result.frames.length,
      frames: result.frames.map((frame) => path.relative(projectDir, frame.path)),
    });
    console.log(`  ${path.basename(videoPath)} -> ${result.frames.length} frame(s), ${result.mode}`);
  }

  if (allFrames.length === 0) {
    console.log(`[${projectName}] No frames were exported.`);
    return;
  }

  await fs.writeFile(
    path.join(frameDir, "_manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const pptxPath = await createPpt(projectDir, projectName, allFrames, options);
  console.log(`[${projectName}] PPT written to ${pptxPath}`);
}

async function listVideos(materialDir) {
  if (!(await exists(materialDir))) {
    return [];
  }

  const entries = await fs.readdir(materialDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(materialDir, entry.name))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

async function extractStoryboardFrames(videoPath, frameDir, options) {
  const prefix = safeFileStem(path.parse(videoPath).name);
  await removeGeneratedFrames(frameDir, prefix);

  const metadata = await probeMedia(videoPath);
  const duration = metadata.duration || 0;
  const tempDir = await fs.mkdtemp(path.join(frameDir, `.tmp-${prefix}-`));

  try {
    const firstFrame = path.join(frameDir, `${prefix}_0001.jpg`);
    await extractFrameAt(videoPath, firstFrame, Math.min(0.15, Math.max(duration / 100, 0)));

    await runProcess(ffmpegPath, [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      videoPath,
      "-vf",
      `select=gt(scene\\,${options.threshold})`,
      "-vsync",
      "vfr",
      "-q:v",
      "2",
      path.join(tempDir, `${prefix}_scene_%04d.jpg`),
    ]);

    const detected = (await listJpegs(tempDir)).sort((a, b) => a.localeCompare(b));
    const selected = pickEvenly(detected, Math.max(0, options.maxFrames - 1));
    let frames = [await makeFrameInfo(firstFrame, metadata)];

    let index = 2;
    for (const source of selected) {
      const target = path.join(frameDir, `${prefix}_${pad(index)}.jpg`);
      await fs.rename(source, target);
      frames.push(await makeFrameInfo(target, metadata));
      index += 1;
    }

    if (frames.length < options.minFrames && duration > 1) {
      for (const frame of frames) {
        await fs.rm(frame.path, { force: true });
      }

      const targetCount = Math.min(
        options.maxFrames,
        Math.max(options.minFrames, Math.ceil(duration / 3)),
      );
      frames = [];
      for (let i = 0; i < targetCount; i += 1) {
        const second = duration > 0 ? (duration * (i + 0.5)) / targetCount : 0;
        const target = path.join(frameDir, `${prefix}_${pad(i + 1)}.jpg`);
        await extractFrameAt(videoPath, target, second);
        frames.push(await makeFrameInfo(target, metadata));
      }
      return { frames, mode: "sampled-fallback", duration };
    }

    return { frames, mode: "scene-detected", duration };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractFrameAt(videoPath, outputPath, second) {
  await runProcess(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss",
    String(Math.max(0, second)),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath,
  ]);
}

async function makeFrameInfo(imagePath, fallbackMetadata) {
  const metadata = await probeMedia(imagePath).catch(() => fallbackMetadata);
  return {
    path: imagePath,
    width: metadata.width || fallbackMetadata.width || 1080,
    height: metadata.height || fallbackMetadata.height || 1920,
  };
}

async function probeMedia(filePath) {
  const { stdout } = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    filePath,
  ]);

  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] || {};
  return {
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    duration: Number(data.format?.duration) || 0,
  };
}

async function createPpt(projectDir, projectName, frames, options) {
  const slideW = 13.333;
  const slideH = 7.5;
  const margin = 0.1;
  const gap = 0.045;
  const cols = options.cols;
  const rows = options.rows;
  const perSlide = cols * rows;
  const cellW = (slideW - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (slideH - margin * 2 - gap * (rows - 1)) / rows;

  const pptxPath = path.join(projectDir, `${projectName}_分镜.pptx`);
  const tempRoot = await fs.mkdtemp(path.join(projectDir, ".pptx-build-"));

  try {
    await fs.mkdir(path.join(tempRoot, "_rels"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "docProps"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "ppt", "_rels"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "ppt", "slides", "_rels"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "ppt", "media"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "ppt", "slideMasters", "_rels"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "ppt", "slideLayouts", "_rels"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "ppt", "theme"), { recursive: true });

    const slides = [];
    let mediaIndex = 1;

    for (let start = 0; start < frames.length; start += perSlide) {
      const chunk = frames.slice(start, start + perSlide);
      const pictures = [];

      for (let idx = 0; idx < chunk.length; idx += 1) {
        const frame = chunk[idx];
        const mediaName = `image${mediaIndex}.jpg`;
        await fs.copyFile(frame.path, path.join(tempRoot, "ppt", "media", mediaName));

        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const boxX = margin + col * (cellW + gap);
        const boxY = margin + row * (cellH + gap);
        const fitted = fitContain(frame.width, frame.height, boxX, boxY, cellW, cellH);
        pictures.push({ ...fitted, mediaName, relId: `rId${idx + 1}` });
        mediaIndex += 1;
      }

      const slideNumber = slides.length + 1;
      slides.push({ slideNumber, pictures });
      await fs.writeFile(
        path.join(tempRoot, "ppt", "slides", `slide${slideNumber}.xml`),
        slideXml(pictures),
        "utf8",
      );
      await fs.writeFile(
        path.join(tempRoot, "ppt", "slides", "_rels", `slide${slideNumber}.xml.rels`),
        slideRelsXml(pictures),
        "utf8",
      );
    }

    await writePptScaffold(tempRoot, projectName, slides);
    await fs.rm(pptxPath, { force: true });
    await zipDirectory(tempRoot, pptxPath);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return pptxPath;
}

async function writePptScaffold(tempRoot, projectName, slides) {
  const now = new Date().toISOString();
  await fs.writeFile(path.join(tempRoot, "[Content_Types].xml"), contentTypesXml(slides), "utf8");
  await fs.writeFile(path.join(tempRoot, "_rels", ".rels"), packageRelsXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "docProps", "app.xml"), appPropsXml(slides.length), "utf8");
  await fs.writeFile(path.join(tempRoot, "docProps", "core.xml"), corePropsXml(projectName, now), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "presentation.xml"), presentationXml(slides), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "_rels", "presentation.xml.rels"), presentationRelsXml(slides), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideMasters", "slideMaster1.xml"), slideMasterXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideMasters", "_rels", "slideMaster1.xml.rels"), slideMasterRelsXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideLayouts", "slideLayout1.xml"), slideLayoutXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideLayouts", "_rels", "slideLayout1.xml.rels"), slideLayoutRelsXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "theme", "theme1.xml"), themeXml(), "utf8");
}

function slideXml(pictures) {
  return xmlHeader(`\
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
${pictures.map((picture, idx) => pictureXml(picture, idx + 2)).join("\n")}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sld>`);
}

function pictureXml(picture, id) {
  return `\
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="${id}" name="Picture ${id - 1}"/>
          <p:cNvPicPr>
            <a:picLocks noChangeAspect="1"/>
          </p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="${picture.relId}"/>
          <a:stretch>
            <a:fillRect/>
          </a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="${inchToEmu(picture.x)}" y="${inchToEmu(picture.y)}"/>
            <a:ext cx="${inchToEmu(picture.w)}" cy="${inchToEmu(picture.h)}"/>
          </a:xfrm>
          <a:prstGeom prst="rect">
            <a:avLst/>
          </a:prstGeom>
        </p:spPr>
      </p:pic>`;
}

function slideRelsXml(pictures) {
  const rels = pictures
    .map((picture) => `<Relationship Id="${picture.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${picture.mediaName}"/>`)
    .join("");
  return xmlHeader(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
}

function contentTypesXml(slides) {
  const slideTypes = slides
    .map((slide) => `<Override PartName="/ppt/slides/slide${slide.slideNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join("");
  return xmlHeader(`\
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideTypes}
</Types>`);
}

function packageRelsXml() {
  return xmlHeader(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
}

function appPropsXml(slideCount) {
  return xmlHeader(`\
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Codex storyboard workflow</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Slides>${slideCount}</Slides>
  <Notes>0</Notes>
  <HiddenSlides>0</HiddenSlides>
  <MMClips>0</MMClips>
  <ScaleCrop>false</ScaleCrop>
</Properties>`);
}

function corePropsXml(projectName, now) {
  const title = xmlEscape(`${projectName} 分镜`);
  return xmlHeader(`\
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${title}</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`);
}

function presentationXml(slides) {
  const slideIds = slides
    .map((slide, idx) => `<p:sldId id="${256 + idx}" r:id="rId${idx + 2}"/>`)
    .join("");
  return xmlHeader(`\
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}" type="wideScreen"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);
}

function presentationRelsXml(slides) {
  const slideRels = slides
    .map((slide, idx) => `<Relationship Id="rId${idx + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slide.slideNumber}.xml"/>`)
    .join("");
  return xmlHeader(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`);
}

function slideMasterXml() {
  return xmlHeader(`\
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`);
}

function slideMasterRelsXml() {
  return xmlHeader(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`);
}

function slideLayoutXml() {
  return xmlHeader(`\
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sldLayout>`);
}

function slideLayoutRelsXml() {
  return xmlHeader(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);
}

function themeXml() {
  return xmlHeader(`\
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F1F1F"/></a:dk2>
      <a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:majorFont>
      <a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`);
}

async function zipDirectory(sourceDir, outputPath) {
  const files = await collectFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const filePath of files) {
    const relPath = path.relative(sourceDir, filePath).replaceAll(path.sep, "/");
    const name = Buffer.from(relPath, "utf8");
    const data = await fs.readFile(filePath);
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await fs.writeFile(outputPath, Buffer.concat([...localParts, ...centralParts, end]));
}

async function collectFiles(rootDir) {
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = makeCrcTable();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

function fitContain(sourceW, sourceH, boxX, boxY, boxW, boxH) {
  const scale = Math.min(boxW / sourceW, boxH / sourceH);
  const w = sourceW * scale;
  const h = sourceH * scale;
  return {
    x: round(boxX + (boxW - w) / 2, 4),
    y: round(boxY + (boxH - h) / 2, 4),
    w: round(w, 4),
    h: round(h, 4),
  };
}

function pickEvenly(items, maxCount) {
  if (items.length <= maxCount) {
    return items;
  }
  if (maxCount <= 0) {
    return [];
  }

  const picked = [];
  for (let i = 0; i < maxCount; i += 1) {
    const index = Math.round((i * (items.length - 1)) / (maxCount - 1 || 1));
    picked.push(items[index]);
  }
  return picked;
}

async function removeGeneratedFrames(frameDir, prefix) {
  const entries = await fs.readdir(frameDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${prefix}_`) && entry.name.endsWith(".jpg"))
      .map((entry) => fs.rm(path.join(frameDir, entry.name), { force: true })),
  );
}

async function listJpegs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && /\.(jpe?g)$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name));
}

async function findTool(toolName) {
  const envName = toolName.toLowerCase().startsWith("ffprobe") ? "FFPROBE_PATH" : "FFMPEG_PATH";
  const envPath = process.env[envName];
  if (envPath && (await exists(envPath))) {
    return envPath;
  }

  const exeName = process.platform === "win32" ? `${toolName}.exe` : toolName;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const fromPath = await runProcess(locator, [exeName], { allowFailure: true });
  const pathHit = fromPath.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (pathHit && (await exists(pathHit))) {
    return pathHit;
  }

  const roots = [
    ...(process.platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA || "", "JianyingPro", "Apps"),
          path.join(process.env.ProgramFiles || "", "微购相册"),
          path.join(process.env["ProgramFiles(x86)"] || "", "微购相册"),
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/Applications/CapCut.app",
          "/Applications/JianyingPro.app",
        ]),
  ];
  const hits = [];
  for (const root of roots) {
    hits.push(...(await findUnder(root, exeName, 4)));
  }

  return hits.sort((a, b) => b.localeCompare(a, "zh-Hans-CN", { numeric: true }))[0] || "";
}

async function findUnder(root, exeName, maxDepth) {
  if (!root || !(await exists(root))) {
    return [];
  }

  const hits = [];
  async function walk(dir, depth) {
    if (depth < 0) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === exeName.toLowerCase()) {
        hits.push(fullPath);
      } else if (entry.isDirectory()) {
        await walk(fullPath, depth - 1);
      }
    }
  }

  await walk(root, maxDepth);
  return hits;
}

function xmlHeader(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}\n`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function inchToEmu(value) {
  return Math.round(value * EMU_PER_INCH);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else if (options.allowFailure) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`${path.basename(command)} failed with code ${code}\n${stderr.trim()}`));
      }
    });
  });
}

async function exists(targetPath) {
  return fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);
}

function safeFileStem(stem) {
  return stem.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80) || "video";
}

function pad(number) {
  return String(number).padStart(4, "0");
}

function round(number, digits = 2) {
  const base = 10 ** digits;
  return Math.round(number * base) / base;
}
