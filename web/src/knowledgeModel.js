const DEFAULT_DIRECTIONS = [
  "分类",
  "异常检测",
  "语义分割",
  "目标检测",
  "实例分割",
  "预训练",
  "交互式分割",
  "提示分割",
  "知识蒸馏",
  "工业解决方案",
];

function text(value) {
  return value == null ? "" : String(value);
}

function compact(values) {
  return values.map(text).map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(compact(values)));
}

function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      type: text(item.type) || "text",
      title: text(item.title),
      content: text(item.content),
      src: text(item.src),
      caption: text(item.caption),
      tableText: text(item.tableText),
      code: text(item.code),
    }))
    .filter((item) => item.title || item.content || item.src || item.caption || item.tableText || item.code);
}

function urlFromText(value) {
  const raw = text(value);
  const match = raw.match(/https?:\/\/[^\s，。；,;)）]+/i);
  return match ? match[0] : "";
}

export function normalizeResearchStatus(status) {
  const raw = text(status);
  if (/已归档|归档/.test(raw)) return "已归档";
  if (/已验证|验证完成|最佳|有效|有价值|值得验证|推荐|已结论/.test(raw)) return "已结论";
  if (/已实验|实验完成|已复现/.test(raw)) return "已实验";
  if (/已阅读|已精读|待精读|精读/.test(raw)) return "精读";
  if (/粗读|速读|初读/.test(raw)) return "粗读";
  return "待读";
}

function directionName(value, domains) {
  const raw = text(value).trim();
  if (!raw) return "";
  return domains[raw] || raw;
}

function buildDirectionRegistry(data, domains) {
  const techDirections = Array.isArray(data.techDirections) ? data.techDirections : [];
  const byName = {};
  const byId = {};
  const aliases = {};
  techDirections.forEach((item) => {
    const name = text(item.name);
    const directionId = text(item.direction_id);
    if (!name || text(item.status) === "archived") return;
    const direction = {
      directionId,
      direction_id: directionId,
      name,
      summary: text(item.summary),
      parentId: text(item.parent_id),
      status: text(item.status) || "active",
    };
    byName[name] = direction;
    if (directionId) byId[directionId] = direction;
    aliases[name] = name;
  });
  (data.directionAliases || []).forEach((item) => {
    const target = byId[text(item.direction_id)];
    if (target && item.alias) aliases[text(item.alias)] = target.name;
  });
  Object.entries(domains).forEach(([slug, name]) => {
    if (aliases[name]) aliases[slug] = aliases[name];
  });
  return { techDirections, byName, byId, aliases };
}

function canonicalDirectionName(value, registry, domains) {
  const named = directionName(value, domains);
  if (!named) return "";
  const aliases = registry && typeof registry === "object" && registry.aliases ? registry.aliases : {};
  return aliases[named] || named;
}

function directionIdFor(name, registry) {
  const byName = registry && typeof registry === "object" && registry.byName ? registry.byName : {};
  return byName[name]?.directionId || "";
}

function directionFor(item, domains, registry) {
  return canonicalDirectionName(item.task, registry, domains) || canonicalDirectionName(item.domain_slug, registry, domains) || "未分类";
}

function directionSummary(name) {
  const copy = {
    分类: "分类模型选型、长尾类别、误检漏检治理和现场鲁棒性经验。",
    异常检测: "少样本、无监督、阈值策略、缺陷定位和现场漂移治理。",
    语义分割: "缺陷区域、边界质量、轻量化部署、蒸馏和后处理实践。",
    目标检测: "检测框定位、小目标、速度精度权衡和工程部署。",
    实例分割: "实例级缺陷、粘连目标、掩码质量和后处理经验。",
    预训练: "工业数据自监督、迁移学习和基础模型适配。",
    交互式分割: "人机协同标注、提示策略和快速修正流程。",
    提示分割: "Promptable segmentation 在工业图像中的落地路径。",
    知识蒸馏: "Teacher-student 压缩、特征对齐和训练阶段增强。",
    工业解决方案: "项目方案、流程复盘、交付经验和可复用工程资产。",
  };
  return copy[name] || "工业算法方向的经验、方法和资产入口。";
}

function linkedPapers(method, papers) {
  const ids = text(method.paper_ids).split(/[,，\s]+/).filter(Boolean);
  return papers.filter((paper) => ids.includes(String(paper.id)));
}

function buildSubTechCards(data, domains, registry) {
  const papers = data.papers || [];
  const practices = data.bestPractices || [];
  const methodCards = (data.methods || []).map((method) => {
    const direction = directionFor(method, domains, registry);
    const paperLinks = linkedPapers(method, papers).map((paper) => paper.url).filter(Boolean);
    const practice = practices.find((item) => {
      return text(item.method_name) === text(method.name) || directionFor(item, domains, registry) === direction;
    });
    return {
      id: `method-${method.id}`,
      source: "sqlite",
      direction,
      directionId: directionIdFor(direction, registry),
      techName: text(method.name),
      officialPaperLink: paperLinks[0] || "",
      codeRepo: urlFromText(method.implementation_cost),
      lineage: text(method.category),
      principle: text(method.summary),
      applicationEffect: text(method.best_score) || text(practice?.result_summary),
      strengths: text(method.applicable_scenarios),
      limitations: text(practice?.limits) || text(method.implementation_cost),
      evidence: text(method.evidence),
      projectUsage: text(practice?.scenario),
      relatedProjects: compact([practice?.scenario]),
      relatedDatasets: [],
      relatedPapers: linkedPapers(method, papers).map((paper) => text(paper.title) || text(paper.id)),
      relatedTechCards: [],
      customFields: compact([
        method.implementation_cost && `工程成本：${method.implementation_cost}`,
        method.evidence && `实验证据：${method.evidence}`,
        method.paper_ids && `关联论文：${method.paper_ids}`,
        method.card_path && `卡片路径：${method.card_path}`,
      ]),
      blocks: [],
      raw: method,
    };
  });
  const customCards = (data.customSubTechCards || []).map((item) => {
    const direction = canonicalDirectionName(item.direction, registry, domains);
    return {
      id: text(item.id),
      source: "sqlite",
      direction,
      directionId: directionIdFor(direction, registry),
      techName: text(item.techName),
      officialPaperLink: text(item.officialPaperLink),
      codeRepo: text(item.codeRepo),
      lineage: text(item.lineage),
      principle: text(item.principle),
      applicationEffect: text(item.applicationEffect),
      strengths: text(item.strengths),
      limitations: text(item.limitations),
      evidence: text(item.evidence),
      projectUsage: text(item.projectUsage),
      relatedProjects: Array.isArray(item.relatedProjects) ? item.relatedProjects : [],
      relatedDatasets: Array.isArray(item.relatedDatasets) ? item.relatedDatasets : [],
      relatedPapers: Array.isArray(item.relatedPapers) ? item.relatedPapers : [],
      relatedTechCards: Array.isArray(item.relatedTechCards) ? item.relatedTechCards : [],
      customFields: Array.isArray(item.customFields) ? item.customFields : [],
      blocks: normalizeBlocks(item.blocks),
      raw: item,
    };
  });
  const customById = Object.fromEntries(customCards.map((item) => [item.id, item]));
  return [
    ...methodCards.map((item) => ({ ...item, ...(customById[item.id] || {}) })),
    ...customCards.filter((item) => !methodCards.some((method) => method.id === item.id)),
  ];
}

function buildResearchCards(data, domains, registry) {
  const paperCards = (data.papers || []).map((paper) => {
    const direction = directionFor(paper, domains, registry);
    return {
      id: `paper-${paper.id}`,
      source: "sqlite",
      title: text(paper.title),
      direction,
      directionId: directionIdFor(direction, registry),
      status: normalizeResearchStatus(paper.status),
      officialGithub: text(paper.code_url),
      paperUrl: text(paper.url),
      summary: text(paper.summary || paper.abstract),
      directionKeywords: unique([paper.task, paper.method_type, paper.keywords]).join("，"),
      industrialValue: text(paper.industrial_value),
    verificationConclusion: text(paper.reproducibility || paper.risk),
    experimentExperience: text(paper.risk),
    experimentObservation: text(paper.experiment_observation),
    failureReason: text(paper.failure_reason),
      blocks: [],
      raw: paper,
    };
  });
  const customCards = (data.customResearchCards || []).map((item) => normalizeDraftResearchCard(item, domains, registry)).map((item) => ({
      ...item,
      source: "sqlite",
    }));
  const customById = Object.fromEntries(customCards.map((item) => [item.id, item]));
  return [
    ...paperCards.map((item) => ({ ...item, ...(customById[item.id] || {}) })),
    ...customCards.filter((item) => !paperCards.some((paper) => paper.id === item.id)),
  ];
}

function normalizeDraftResearchCard(item, domains = {}, registry = { aliases: {}, byName: {} }) {
  const direction = canonicalDirectionName(item.direction, registry, domains);
  return {
    id: text(item.id) || `research-${Date.now()}`,
    source: "draft",
    title: text(item.title),
    direction,
    directionId: directionIdFor(direction, registry),
    status: normalizeResearchStatus(item.status),
    officialGithub: text(item.officialGithub),
    paperUrl: text(item.paperUrl),
    summary: text(item.summary),
    directionKeywords: text(item.directionKeywords),
    industrialValue: text(item.industrialValue),
    verificationConclusion: text(item.verificationConclusion),
    experimentExperience: text(item.experimentExperience),
    experimentObservation: text(item.experimentObservation),
    failureReason: text(item.failureReason),
    blocks: normalizeBlocks(item.blocks),
    raw: item,
  };
}

function buildProjectCards(data, domains, registry) {
  const existingCards = (data.projects || []).map((project) => {
    const direction = directionFor(project, domains, registry);
    return {
      id: `project-${project.id}`,
      title: text(project.name),
    direction,
    directionId: directionIdFor(direction, registry),
    status: text(project.status) || "沉淀中",
    projectStage: text(project.project_stage),
    acceptanceMetrics: text(project.acceptance_metrics),
    requirements: text(project.problem),
    metricSpec: "",
    keyTech: text(project.solution),
    relatedDatasets: [],
    relatedPapers: [],
    relatedTechCards: [],
    flow: text(project.solution),
    experience: text(project.scenario),
    retrospectiveConclusion: "",
    docPath: text(project.doc_path),
      blocks: [],
      raw: project,
    };
  });
  const customCards = (data.customProjectCards || []).map((item) => normalizeDraftProjectCard(item, domains, registry)).map((item) => ({
    ...item,
    source: "sqlite",
  }));
  const customById = Object.fromEntries(customCards.map((item) => [item.id, item]));
  return [
    ...existingCards.map((item) => ({ ...item, ...(customById[item.id] || {}) })),
    ...customCards.filter((item) => !existingCards.some((project) => project.id === item.id)),
  ];
}

function buildDatasetCards(data, domains, registry) {
  const assetCards = (data.assets || [])
    .filter((asset) => text(asset.type) === "dataset")
    .map((asset) => {
      const direction = directionFor(asset, domains, registry);
      return {
        id: `dataset-${asset.id}`,
        title: text(asset.name),
    direction,
    directionId: directionIdFor(direction, registry),
    path: text(asset.path),
    dataVersion: text(asset.data_version),
    annotationVersion: text(asset.annotation_version),
    pathStatus: text(asset.path_status),
    characteristics: text(asset.description),
    taskFit: text(asset.related_method),
    processingNotes: text(asset.related_method),
    processingScript: text(asset.processing_script),
    quality: "",
    labelQuality: "",
    categories: "",
    sampleImages: [],
    relatedProjects: [],
    relatedTechValidations: [],
        blocks: [],
        raw: asset,
      };
    });
  const customCards = (data.customDatasetCards || []).map((item) => normalizeDraftDatasetCard(item, domains, registry)).map((item) => ({
    ...item,
    source: "sqlite",
  }));
  const customById = Object.fromEntries(customCards.map((item) => [item.id, item]));
  return [
    ...assetCards.map((item) => ({ ...item, ...(customById[item.id] || {}) })),
    ...customCards.filter((item) => !assetCards.some((asset) => asset.id === item.id)),
  ];
}

function normalizeDraftProjectCard(item, domains = {}, registry = { aliases: {}, byName: {} }) {
  const direction = canonicalDirectionName(item.direction, registry, domains);
  return {
    id: text(item.id) || `project-${Date.now()}`,
    source: "draft",
    title: text(item.title),
    direction,
    directionId: directionIdFor(direction, registry),
    status: text(item.status) || "沉淀中",
    projectStage: text(item.projectStage),
    acceptanceMetrics: text(item.acceptanceMetrics),
    requirements: text(item.requirements),
    metricSpec: text(item.metricSpec),
    keyTech: text(item.keyTech),
    relatedDatasets: Array.isArray(item.relatedDatasets) ? item.relatedDatasets : [],
    relatedPapers: Array.isArray(item.relatedPapers) ? item.relatedPapers : [],
    relatedTechCards: Array.isArray(item.relatedTechCards) ? item.relatedTechCards : [],
    flow: text(item.flow),
    experience: text(item.experience),
    retrospectiveConclusion: text(item.retrospectiveConclusion),
    docPath: text(item.docPath),
    blocks: normalizeBlocks(item.blocks),
    raw: item,
  };
}

function normalizeDraftDatasetCard(item, domains = {}, registry = { aliases: {}, byName: {} }) {
  const direction = canonicalDirectionName(item.direction, registry, domains);
  return {
    id: text(item.id) || `dataset-${Date.now()}`,
    source: "draft",
    title: text(item.title),
    direction,
    directionId: directionIdFor(direction, registry),
    path: text(item.path),
    dataVersion: text(item.dataVersion),
    annotationVersion: text(item.annotationVersion),
    pathStatus: text(item.pathStatus),
    characteristics: text(item.characteristics),
    taskFit: text(item.taskFit),
    processingNotes: text(item.processingNotes),
    processingScript: text(item.processingScript),
    quality: text(item.quality),
    labelQuality: text(item.labelQuality),
    categories: text(item.categories),
    sampleImages: Array.isArray(item.sampleImages) ? item.sampleImages : [],
    relatedProjects: Array.isArray(item.relatedProjects) ? item.relatedProjects : [],
    relatedTechValidations: Array.isArray(item.relatedTechValidations) ? item.relatedTechValidations : [],
    blocks: normalizeBlocks(item.blocks),
    raw: item,
  };
}

export function mergeLocalDrafts(model, drafts = {}) {
  const subTechEdits = drafts.subTechEdits || {};
  const researchEdits = drafts.researchEdits || {};
  const projectEdits = drafts.projectEdits || {};
  const datasetEdits = drafts.datasetEdits || {};
  const hiddenDirectionNames = new Set(drafts.hiddenDirectionNames || []);
  const deletedSubTechIds = new Set(drafts.deletedSubTechIds || []);
  const deletedResearchIds = new Set(drafts.deletedResearchIds || []);
  const deletedProjectIds = new Set(drafts.deletedProjectIds || []);
  const deletedDatasetIds = new Set(drafts.deletedDatasetIds || []);
  const draftDirections = (drafts.directions || []).map((item) => ({
    name: text(item.name),
    summary: text(item.summary) || directionSummary(item.name),
    source: "draft",
  }));
  const names = new Set(model.directions.map((item) => item.name));
  const directions = [
    ...model.directions,
    ...draftDirections.filter((item) => item.name && !names.has(item.name)),
  ].filter((item) => !hiddenDirectionNames.has(item.name));
  const modelSubTechIds = new Set(model.subTechCards.map((item) => item.id));
  const modelResearchIds = new Set(model.researchCards.map((item) => item.id));
  const modelProjectIds = new Set(model.projectCards.map((item) => item.id));
  const modelDatasetIds = new Set(model.datasetCards.map((item) => item.id));
  const subTechCards = [
    ...model.subTechCards
      .filter((item) => !deletedSubTechIds.has(item.id))
      .map((item) => ({ ...item, ...(subTechEdits[item.id] || {}) })),
    ...(drafts.subTechCards || []).filter((item) => !modelSubTechIds.has(text(item.id)) && !deletedSubTechIds.has(text(item.id))).map((item) => ({
      id: text(item.id) || `draft-${Date.now()}`,
      source: "draft",
      direction: text(item.direction),
      techName: text(item.techName),
      officialPaperLink: text(item.officialPaperLink),
      codeRepo: text(item.codeRepo),
      lineage: text(item.lineage),
      principle: text(item.principle),
      applicationEffect: text(item.applicationEffect),
      strengths: text(item.strengths),
      limitations: text(item.limitations),
      evidence: text(item.evidence),
      projectUsage: text(item.projectUsage),
      relatedProjects: Array.isArray(item.relatedProjects) ? item.relatedProjects : [],
      relatedDatasets: Array.isArray(item.relatedDatasets) ? item.relatedDatasets : [],
      relatedPapers: Array.isArray(item.relatedPapers) ? item.relatedPapers : [],
      relatedTechCards: Array.isArray(item.relatedTechCards) ? item.relatedTechCards : [],
      customFields: Array.isArray(item.customFields) ? item.customFields : [],
      blocks: normalizeBlocks(item.blocks),
      raw: item,
    })),
  ];
  const researchCards = [
    ...model.researchCards
      .filter((item) => !deletedResearchIds.has(item.id))
      .map((item) => ({ ...item, ...(researchEdits[item.id] || {}) })),
    ...(drafts.researchCards || [])
      .filter((item) => !modelResearchIds.has(text(item.id)) && !deletedResearchIds.has(text(item.id)))
      .map((item) => normalizeDraftResearchCard(item)),
  ];
  const projectCards = [
    ...model.projectCards
      .filter((item) => !deletedProjectIds.has(item.id))
      .map((item) => ({ ...item, ...(projectEdits[item.id] || {}) })),
    ...(drafts.projectCards || [])
      .filter((item) => !modelProjectIds.has(text(item.id)) && !deletedProjectIds.has(text(item.id)))
      .map((item) => normalizeDraftProjectCard(item)),
  ];
  const datasetCards = [
    ...model.datasetCards
      .filter((item) => !deletedDatasetIds.has(item.id))
      .map((item) => ({ ...item, ...(datasetEdits[item.id] || {}) })),
    ...(drafts.datasetCards || [])
      .filter((item) => !modelDatasetIds.has(text(item.id)) && !deletedDatasetIds.has(text(item.id)))
      .map((item) => normalizeDraftDatasetCard(item)),
  ];
  return { ...model, directions, subTechCards, researchCards, projectCards, datasetCards };
}

export function buildCapabilityModel(data = {}, drafts = {}) {
  const domains = Object.fromEntries((data.domains || []).map((item) => [text(item.slug), text(item.name)]));
  const registry = buildDirectionRegistry(data, domains);
  const subTechCards = buildSubTechCards(data, domains, registry);
  const researchCards = buildResearchCards(data, domains, registry);
  const projectCards = buildProjectCards(data, domains, registry);
  const datasetCards = buildDatasetCards(data, domains, registry);
  const directionNames = unique([
    ...(data.techDirections || []).filter((item) => text(item.status) !== "archived").map((item) => item.name),
    ...(data.directions || []),
    ...DEFAULT_DIRECTIONS,
    ...(data.customDirections || []).map((item) => item.name),
    ...subTechCards.map((item) => item.direction),
    ...researchCards.map((item) => item.direction),
    ...projectCards.map((item) => item.direction),
    ...datasetCards.map((item) => item.direction),
  ]);
  const model = {
    directions: directionNames.map((name) => ({
      directionId: directionIdFor(name, registry),
      name,
      summary: registry.byName[name]?.summary || directionSummary(name),
      source: registry.byName[name] ? "registry" : "system",
    })),
    subTechCards,
    researchCards,
    projectCards,
    datasetCards,
  };
  const merged = mergeLocalDrafts(model, drafts);
  return {
    ...merged,
    directions: merged.directions.map((direction) => ({
      ...direction,
      subTechCount: merged.subTechCards.filter((item) => item.direction === direction.name).length,
      researchCount: merged.researchCards.filter((item) => item.direction === direction.name).length,
      projectCount: merged.projectCards.filter((item) => item.direction === direction.name).length,
      datasetCount: merged.datasetCards.filter((item) => item.direction === direction.name).length,
    })),
  };
}
