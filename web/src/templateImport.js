function clean(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeLabel(label) {
  return clean(label)
    .replace(/^#+\s*/, "")
    .replace(/^[\-*]\s*/, "")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeValue(value) {
  return clean(value).replace(/\n{3,}/g, "\n\n");
}

function collectSections(input) {
  const sections = {};
  let currentKey = "";
  clean(input).split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      if (currentKey) sections[currentKey].push("");
      return;
    }
    const heading = line.match(/^#{1,4}\s*(.+)$/);
    if (heading) {
      currentKey = normalizeLabel(heading[1]);
      sections[currentKey] = sections[currentKey] || [];
      return;
    }
    const pair = line.match(/^(?:[-*]\s*)?([^：:]{2,32})[：:]\s*(.*)$/);
    if (pair) {
      currentKey = normalizeLabel(pair[1]);
      sections[currentKey] = [pair[2].trim()];
      return;
    }
    if (currentKey) sections[currentKey].push(line);
  });
  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, normalizeValue(lines.join("\n"))])
  );
}

function pick(sections, aliases) {
  const normalizedAliases = aliases.map(normalizeLabel);
  const entry = Object.entries(sections).find(([key]) => normalizedAliases.includes(key));
  return entry ? entry[1] : "";
}

function applyAliases(sections, aliasesByKey) {
  return Object.fromEntries(
    Object.entries(aliasesByKey)
      .map(([key, aliases]) => [key, pick(sections, aliases)])
      .filter(([, value]) => value)
  );
}

export function parsePaperTemplate(input) {
  const sections = collectSections(input);
  return applyAliases(sections, {
    title: ["标题", "论文标题", "paper title", "title"],
    direction: ["技术方向", "方向", "direction"],
    status: ["验证状态", "状态", "status"],
    officialGithub: ["官方 github", "github", "官方代码仓库", "代码仓库", "repo"],
    paperUrl: ["原文链接", "论文链接", "paper", "paper url", "url"],
    summary: ["论文概要", "概要", "摘要", "summary"],
    directionKeywords: ["技术方向关键词", "方向关键词", "关键词", "keywords"],
    industrialValue: ["工业价值", "对工业场景的技术价值", "技术价值", "industrial value"],
    experimentObservation: ["实验现象", "验证现象", "实验结果", "observation"],
    failureReason: ["失败原因", "失败分析", "无效原因", "failure reason"],
    verificationConclusion: ["验证结论", "实验结论", "conclusion"],
    experimentExperience: ["实验经验", "验证经验", "experience"],
  });
}

export function parseProjectTemplate(input) {
  const sections = collectSections(input);
  return applyAliases(sections, {
    title: ["项目名称", "标题", "项目", "project title", "title"],
    direction: ["技术方向", "方向", "direction"],
    status: ["项目状态", "状态", "status"],
    projectStage: ["项目阶段", "阶段", "stage"],
    acceptanceMetrics: ["验收指标", "验收标准", "acceptance metrics"],
    requirements: ["核心项目需求", "项目需求", "需求", "requirements"],
    metricSpec: ["规格指标", "指标", "验收指标", "metrics"],
    keyTech: ["关键技术", "技术方案", "key tech", "key technology"],
    relatedDatasetsText: ["关联数据集", "数据集", "related datasets"],
    relatedPapersText: ["关联论文", "论文", "related papers"],
    relatedTechCardsText: ["关联技术卡", "技术卡", "related tech cards"],
    flow: ["方案流程图", "方案流程", "流程", "flow"],
    experience: ["项目经验", "经验", "复盘", "retrospective"],
    retrospectiveConclusion: ["复盘结论", "结论", "retrospective conclusion"],
    docPath: ["文档路径", "文档", "doc", "doc path"],
  });
}

export function parseDatasetTemplate(input) {
  const sections = collectSections(input);
  const parsed = applyAliases(sections, {
    title: ["数据名称", "数据集名称", "标题", "dataset title", "title"],
    direction: ["技术方向", "方向", "direction"],
    path: ["数据路径", "路径", "path"],
    dataVersion: ["数据版本", "版本", "data version"],
    annotationVersion: ["标注版本", "annotation version"],
    characteristics: ["数据特点", "特点", "场景信息", "characteristics"],
    taskFit: ["适配任务", "任务", "task", "task fit"],
    processingNotes: ["数据处理要点", "处理要点", "处理流程", "processing notes"],
    processingScript: ["处理脚本", "脚本", "processing script"],
    quality: ["数据质量", "质量", "quality"],
    labelQuality: ["标注质量", "标注", "label quality"],
    categories: ["类别信息", "类别", "classes", "categories"],
    sampleImagesText: ["样例图片路径", "样例图", "样例图片", "sample images"],
    relatedProjectsText: ["支撑项目", "关联项目", "related projects"],
    relatedTechValidationsText: ["支撑技术验证", "关联技术验证", "related validations"],
  });
  if (parsed.sampleImagesText) {
    parsed.sampleImagesText = parsed.sampleImagesText
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n");
  }
  return parsed;
}

export function parseSubTechTemplate(input) {
  const sections = collectSections(input);
  const parsed = applyAliases(sections, {
    techName: ["技术名称", "名称", "子技术", "tech name", "title"],
    direction: ["技术方向", "方向", "direction"],
    officialPaperLink: ["官方论文链接", "论文链接", "paper url", "paper"],
    codeRepo: ["官方代码仓库", "代码仓库", "github", "repo"],
    lineage: ["技术脉络图", "技术脉络", "lineage"],
    principle: ["技术原理", "原理", "principle"],
    applicationEffect: ["应用效果", "效果", "application effect"],
    strengths: ["优势", "优点", "strengths"],
    limitations: ["不足", "限制", "limitations"],
    projectUsage: ["项目使用记录", "项目应用", "project usage"],
    relatedProjectsText: ["关联项目", "支撑项目", "related projects"],
    relatedDatasetsText: ["关联数据集", "数据集", "related datasets"],
    relatedPapersText: ["关联论文", "论文", "related papers"],
    relatedTechCardsText: ["关联技术卡", "技术卡", "related tech cards"],
  });
  const customFields = Object.entries(sections)
    .filter(([label]) => !Object.values({
      techName: ["技术名称", "名称", "子技术", "tech name", "title"],
      direction: ["技术方向", "方向", "direction"],
      officialPaperLink: ["官方论文链接", "论文链接", "paper url", "paper"],
      codeRepo: ["官方代码仓库", "代码仓库", "github", "repo"],
      lineage: ["技术脉络图", "技术脉络", "lineage"],
      principle: ["技术原理", "原理", "principle"],
      applicationEffect: ["应用效果", "效果", "application effect"],
      strengths: ["优势", "优点", "strengths"],
      limitations: ["不足", "限制", "limitations"],
      projectUsage: ["项目使用记录", "项目应用", "project usage"],
      relatedProjectsText: ["关联项目", "支撑项目", "related projects"],
      relatedDatasetsText: ["关联数据集", "数据集", "related datasets"],
      relatedPapersText: ["关联论文", "论文", "related papers"],
      relatedTechCardsText: ["关联技术卡", "技术卡", "related tech cards"],
    }).flat().map(normalizeLabel).includes(label))
    .map(([label, value]) => ({ label, value }))
    .filter((item) => item.label && item.value);
  if (customFields.length) parsed.customFields = customFields;
  return parsed;
}
