import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;
const EMU_PER_INCH = 914400;
const SHOTS_PER_PAGE = 7;

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const projectName = process.argv[2] || "项目二";
  const projectDir = path.resolve(ROOT, projectName);
  const dataPath = path.join(projectDir, "拉片数据.json");
  const data = JSON.parse(await fs.readFile(dataPath, "utf8"));

  const mdPath = path.join(projectDir, `${data.project}_拉片笔记.md`);
  const pptPath = process.env.LAPIAN_OUTPUT_PATH
    ? path.resolve(process.env.LAPIAN_OUTPUT_PATH)
    : path.join(projectDir, `${data.project}_分镜故事板.pptx`);

  await fs.writeFile(mdPath, buildMarkdown(data), "utf8");
  await createStoryboardPpt(projectDir, data, pptPath);

  console.log(`Markdown written to ${mdPath}`);
  console.log(`PPT written to ${pptPath}`);
}

function buildMarkdown(data) {
  const lines = [];
  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(`- 项目：${data.project}`);
  lines.push(`- 视频：${data.video}`);
  lines.push(`- 总时长：${formatSeconds(data.durationSeconds)} 秒`);
  lines.push(`- 镜头数：${data.shots.length}`);
  lines.push("");
  lines.push("| 镜号 | 景别/角度 | 运动 | 画面内容 | 时长(秒) | 参考画面(截取该画面的关键帧) | 备注 |");
  lines.push("|---:|---|---|---|---:|---|---|");

  for (const shot of data.shots) {
    lines.push(
      [
        shot.shot,
        mdCell(shot.scaleAngle),
        mdCell(shot.movement),
        mdCell(shot.content),
        formatSeconds(shot.duration),
        `<img src="${shot.image}" width="90">`,
        mdCell(shot.notes),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  lines.push("");
  lines.push("## 整体视觉风格总结");
  lines.push("");
  lines.push(data.visualSummary);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function createStoryboardPpt(projectDir, data, outputPath) {
  const tempRoot = await fs.mkdtemp(path.join(projectDir, ".storyboard-pptx-"));

  try {
    await makeDirs(tempRoot);
    const pages = chunk(data.shots, SHOTS_PER_PAGE);
    const slideCount = pages.length;
    let mediaIndex = 1;

    for (let i = 0; i < pages.length; i += 1) {
      const slide = await buildStoryboardSlide(tempRoot, projectDir, data, pages[i], i + 1, slideCount, mediaIndex);
      mediaIndex = slide.nextMediaIndex;
      await fs.writeFile(path.join(tempRoot, "ppt", "slides", `slide${i + 1}.xml`), slideXml(slide), "utf8");
      await fs.writeFile(path.join(tempRoot, "ppt", "slides", "_rels", `slide${i + 1}.xml.rels`), slideRelsXml(slide.pictures), "utf8");
    }

    await writePptScaffold(tempRoot, data.title, slideCount);
    await fs.rm(outputPath, { force: true });
    await zipDirectory(tempRoot, outputPath);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function buildStoryboardSlide(tempRoot, projectDir, data, shots, pageNumber, pageCount, mediaIndex) {
  const pictures = [];
  const texts = [];
  const lineShapes = [];
  const startShot = shots[0].shot.toString().padStart(2, "0");
  const endShot = shots.at(-1).shot.toString().padStart(2, "0");
  const totalSeconds = Math.round(data.durationSeconds);

  const boardTitle = data.storyboardTitle || `${data.title || data.project} ${totalSeconds}s 故事板`;
  const boardSubtitle = data.boardSubtitle || `影调风格：自然光影  |  分镜画幅：9:16 竖屏  |  故事板画幅：16:9 横版  |  镜头 ${startShot}-${endShot} / 第 ${pageNumber} 页`;
  texts.push(textBox(0.25, 0.25, 12.85, 0.45, boardTitle, 25, "222222", true, "center"));
  texts.push(textBox(0.25, 0.83, 12.85, 0.26, boardSubtitle, 9.5, "555555", false, "center"));

  const marginX = 0.22;
  const gap = 0.08;
  const cols = SHOTS_PER_PAGE;
  const cardW = (13.333 - marginX * 2 - gap * (cols - 1)) / cols;
  const imageY = 1.35;
  const imageH = 3.25;
  const captionY = 4.78;
  const captionH = 1.55;

  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    const x = marginX + i * (cardW + gap);
    const mediaName = await addMedia(tempRoot, path.join(projectDir, shot.image), mediaIndex);
    const relId = `rId${i + 1}`;
    mediaIndex += 1;

    pictures.push({
      ...fitCover(720, 1280, x, imageY, cardW, imageH),
      mediaName,
      relId,
    });

    const time = `${formatSeconds(shot.start)}-${formatSeconds(shot.end)}s`;
    texts.push(textBox(x, captionY, 0.33, 0.24, shot.shot.toString().padStart(2, "0"), 15, "222222", true, "left"));
    texts.push(textBox(x + 0.36, captionY + 0.02, cardW - 0.36, 0.2, `${shotTitle(shot)}  |  ${time}`, 7.2, "333333", false, "left"));
    texts.push(textBox(x + 0.01, captionY + 0.36, cardW - 0.02, 0.22, compactScale(shot.scaleAngle), 7.1, "333333", false, "center"));
    texts.push(textBox(x + 0.01, captionY + 0.72, cardW - 0.02, 0.72, compactDescription(shot), 7.0, "333333", false, "left"));
  }

  lineShapes.push(line(0.18, 6.63, 13.15, 6.63, "BFBFBF", 0.6));
  const footer = data.boardFooters?.[pageNumber - 1] || {};
  const footerLeft = footer.left || (pageNumber === 1
    ? "拍摄建议\n自然光优先  |  保留环境声  |  大光圈浅景深  |  让主体动作慢下来"
    : `视觉总结\n${clipText(data.visualSummary, 78)}`);
  const footerRight = footer.right || (pageNumber === 1
    ? "声音设计\n环境底噪  |  风声与衣料摩擦  |  水声或道具声  |  轻音乐托底"
    : "剪辑节奏\n按场景建立、主体动作、质感特写、情绪收束组织镜头，保持呼吸感。");
  texts.push(textBox(0.6, 6.88, 5.25, 0.42, footerLeft, 8.5, "333333", false, "left"));
  texts.push(textBox(6.15, 6.88, 6.55, 0.42, footerRight, 8.5, "333333", false, "left"));
  lineShapes.push(line(5.95, 6.82, 5.95, 7.28, "C9C9C9", 0.5));

  return { pictures, texts, lineShapes, nextMediaIndex: mediaIndex };
}

function shotTitle(shot) {
  return shot.title || shot.boardTitle || "镜头";
}

function compactScale(value) {
  return value.split("/").map((part) => part.trim()).slice(0, 2).join(" / ");
}

function compactDescription(shot) {
  return shot.boardContent || shot.caption || clipText(shot.content, 76);
}

function slideXml(slide) {
  const shapes = [];
  let shapeId = 2;
  for (const picture of slide.pictures) {
    shapes.push(pictureXml(picture, shapeId++));
  }
  for (const box of slide.texts) {
    shapes.push(textXml(box, shapeId++));
  }
  for (const shape of slide.lineShapes) {
    shapes.push(lineXml(shape, shapeId++));
  }

  return xmlHeader(`\
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${shapes.join("\n")}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`);
}

function pictureXml(picture, id) {
  const srcRect = picture.crop
    ? `<a:srcRect l="${picture.crop.l}" t="${picture.crop.t}" r="${picture.crop.r}" b="${picture.crop.b}"/>`
    : "";

  return `\
      <p:pic>
        <p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id - 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="${picture.relId}"/>${srcRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="${inchToEmu(picture.x)}" y="${inchToEmu(picture.y)}"/><a:ext cx="${inchToEmu(picture.w)}" cy="${inchToEmu(picture.h)}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></p:spPr>
      </p:pic>`;
}

function textXml(box, id) {
  const paragraphs = box.text.split("\n").map((lineText) => paragraphXml(lineText, box)).join("");
  return `\
      <p:sp>
        <p:nvSpPr><p:cNvPr id="${id}" name="Text ${id - 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="${inchToEmu(box.x)}" y="${inchToEmu(box.y)}"/><a:ext cx="${inchToEmu(box.w)}" cy="${inchToEmu(box.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
        <p:txBody><a:bodyPr wrap="square" anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${paragraphs}</p:txBody>
      </p:sp>`;
}

function paragraphXml(lineText, box) {
  const align = box.align === "center" ? '<a:pPr algn="ctr"/>' : '<a:pPr marL="0" indent="0"/>';
  return `<a:p>${align}<a:r><a:rPr lang="zh-CN" sz="${Math.round(box.fontSize * 100)}"${box.bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${box.color}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${xmlEscape(lineText)}</a:t></a:r></a:p>`;
}

function lineXml(shape, id) {
  return `\
      <p:cxnSp>
        <p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id - 1}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
        <p:spPr><a:xfrm><a:off x="${inchToEmu(Math.min(shape.x1, shape.x2))}" y="${inchToEmu(Math.min(shape.y1, shape.y2))}"/><a:ext cx="${inchToEmu(Math.abs(shape.x2 - shape.x1))}" cy="${inchToEmu(Math.abs(shape.y2 - shape.y1))}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${Math.round(shape.width * 12700)}"><a:solidFill><a:srgbClr val="${shape.color}"/></a:solidFill></a:ln></p:spPr>
      </p:cxnSp>`;
}

function textBox(x, y, w, h, text, fontSize, color, bold, align = "left") {
  return { x, y, w, h, text, fontSize, color, bold, align };
}

function line(x1, y1, x2, y2, color, width) {
  return { x1, y1, x2, y2, color, width };
}

function slideRelsXml(pictures) {
  const rels = pictures
    .map((picture) => `<Relationship Id="${picture.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${picture.mediaName}"/>`)
    .join("");
  return xmlHeader(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
}

async function writePptScaffold(tempRoot, title, slideCount) {
  const now = new Date().toISOString();
  await fs.writeFile(path.join(tempRoot, "[Content_Types].xml"), contentTypesXml(slideCount), "utf8");
  await fs.writeFile(path.join(tempRoot, "_rels", ".rels"), packageRelsXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "docProps", "app.xml"), appPropsXml(slideCount), "utf8");
  await fs.writeFile(path.join(tempRoot, "docProps", "core.xml"), corePropsXml(title, now), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "presentation.xml"), presentationXml(slideCount), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "_rels", "presentation.xml.rels"), presentationRelsXml(slideCount), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideMasters", "slideMaster1.xml"), slideMasterXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideMasters", "_rels", "slideMaster1.xml.rels"), slideMasterRelsXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideLayouts", "slideLayout1.xml"), slideLayoutXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "slideLayouts", "_rels", "slideLayout1.xml.rels"), slideLayoutRelsXml(), "utf8");
  await fs.writeFile(path.join(tempRoot, "ppt", "theme", "theme1.xml"), themeXml(), "utf8");
}

function contentTypesXml(slideCount) {
  const slideTypes = Array.from({ length: slideCount }, (_, idx) => `<Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  return xmlHeader(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideTypes}</Types>`);
}

function packageRelsXml() {
  return xmlHeader(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
}

function appPropsXml(slideCount) {
  return xmlHeader(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Codex storyboard board</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop></Properties>`);
}

function corePropsXml(title, now) {
  return xmlHeader(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
}

function presentationXml(slideCount) {
  const slideIds = Array.from({ length: slideCount }, (_, idx) => `<p:sldId id="${256 + idx}" r:id="rId${idx + 2}"/>`).join("");
  return xmlHeader(`<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}" type="wideScreen"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
}

function presentationRelsXml(slideCount) {
  const slideRels = Array.from({ length: slideCount }, (_, idx) => `<Relationship Id="rId${idx + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${idx + 1}.xml"/>`).join("");
  return xmlHeader(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels}</Relationships>`);
}

function slideMasterXml() {
  return xmlHeader(`<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`);
}

function slideMasterRelsXml() {
  return xmlHeader(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
}

function slideLayoutXml() {
  return xmlHeader(`<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
}

function slideLayoutRelsXml() {
  return xmlHeader(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
}

function themeXml() {
  return xmlHeader(`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Storyboard Theme"><a:themeElements><a:clrScheme name="Storyboard"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F6F6F4"/></a:lt2><a:accent1><a:srgbClr val="A65F3F"/></a:accent1><a:accent2><a:srgbClr val="607D8B"/></a:accent2><a:accent3><a:srgbClr val="9E9E9E"/></a:accent3><a:accent4><a:srgbClr val="D4A373"/></a:accent4><a:accent5><a:srgbClr val="7D8F69"/></a:accent5><a:accent6><a:srgbClr val="8A817C"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Microsoft YaHei"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="Storyboard"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`);
}

async function makeDirs(tempRoot) {
  const dirs = [
    "_rels",
    "docProps",
    "ppt/_rels",
    "ppt/slides/_rels",
    "ppt/media",
    "ppt/slideMasters/_rels",
    "ppt/slideLayouts/_rels",
    "ppt/theme",
  ];
  await Promise.all(dirs.map((dir) => fs.mkdir(path.join(tempRoot, dir), { recursive: true })));
}

async function addMedia(tempRoot, sourcePath, index) {
  const name = `image${index}.jpg`;
  await fs.copyFile(sourcePath, path.join(tempRoot, "ppt", "media", name));
  return name;
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
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await walk(rootDir);
  return files;
}

function fitCover(sourceW, sourceH, boxX, boxY, boxW, boxH) {
  const sourceRatio = sourceW / sourceH;
  const boxRatio = boxW / boxH;
  const crop = { l: 0, t: 0, r: 0, b: 0 };

  if (sourceRatio > boxRatio) {
    const visibleWidth = boxRatio / sourceRatio;
    const cropSide = Math.round(((1 - visibleWidth) / 2) * 100000);
    crop.l = cropSide;
    crop.r = cropSide;
  } else if (sourceRatio < boxRatio) {
    const visibleHeight = sourceRatio / boxRatio;
    const cropTop = Math.round(((1 - visibleHeight) / 2) * 100000);
    crop.t = cropTop;
    crop.b = cropTop;
  }

  return { x: round(boxX, 4), y: round(boxY, 4), w: round(boxW, 4), h: round(boxH, 4), crop };
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = makeCrcTable();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
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

function mdCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

function clipText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function inchToEmu(value) {
  return Math.round(value * EMU_PER_INCH);
}

function formatSeconds(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function round(number, digits = 2) {
  const base = 10 ** digits;
  return Math.round(number * base) / base;
}
