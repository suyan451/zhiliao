import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildCapabilityModel } from "./knowledgeModel";
import { useLocalDrafts } from "./localDrafts";
import {
  parseDatasetTemplate,
  parsePaperTemplate,
  parseProjectTemplate,
  parseSubTechTemplate,
} from "./templateImport";

const WORKSPACE_MODULE = "工作台";
const MODULES = [WORKSPACE_MODULE, "前沿研究", "项目应用", "数据积累", "技术积累"];
const RESEARCH_STATUS = ["待读", "粗读", "精读", "已实验", "已结论", "已归档"];
const ALL_FILTER = "全部";
const DRAFT_STATUS = ["draft", "submitted", "approved", "published", "archived"];
const WORKBENCH_DRAFT_STATUS = ["draft", "submitted", "approved"];
const DRAFT_STATUS_LABELS = {
  draft: "草稿",
  submitted: "待审核",
  approved: "已批准",
  published: "已发布",
  archived: "已归档",
};
const DRAFT_CREATE_TYPES = [
  ["research_paper", "论文草稿"],
  ["project_case", "项目草稿"],
  ["dataset_card", "数据草稿"],
  ["tech_card", "技术草稿"],
];
const DEFAULT_DATA = {
  directions: [],
  domains: [],
  papers: [],
  methods: [],
  experiments: [],
  bestPractices: [],
  projects: [],
  assets: [],
};

function text(value) {
  return value == null ? "" : String(value);
}

function splitLines(value) {
  return text(value).split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean);
}

function joinLines(value) {
  return Array.isArray(value) ? value.join("\n") : text(value);
}

function isUrl(value) {
  return /^https?:\/\//i.test(text(value));
}

function includesKeyword(item, keyword, keys) {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return keys.some((key) => text(item[key]).toLowerCase().includes(q));
}

function stripMarkdownTables(value) {
  return text(value)
    .split("\n")
    .filter((line) => !isMarkdownTableLine(line.trim()))
    .join("\n");
}

function feedSummary(value, fallback = "暂无摘要", maxLength = 220) {
  const cleaned = stripMarkdownTables(value)
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const result = cleaned || fallback;
  return result.length > maxLength ? `${result.slice(0, maxLength)}...` : result;
}

function toggleMultiSelection(selected, option) {
  return selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected, option];
}

function badgeTone(value) {
  const raw = text(value);
  if (["已结论", "已验证", "最佳实践", "已交付", "已入库", "有效"].includes(raw)) return "success";
  if (["粗读", "精读", "已实验", "有价值", "待验证", "候选", "沉淀中", "待精读", "计划中"].includes(raw)) return "warning";
  if (["失败", "无效", "已淘汰"].includes(raw)) return "risk";
  if (["草稿", "待审核", "已批准", "已发布", "已归档"].includes(raw)) return "priority";
  return "neutral";
}

async function readApiJson(response) {
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    const body = await response.text().catch(() => "");
    throw new Error(`接口返回了非 JSON 内容：${response.status} ${body.slice(0, 80)}`);
  }
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function uploadKnowledgeImage(file) {
  const dataUrl = await fileToDataUrl(file);
  const response = await fetch("/api/assets/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name || "pasted-image.png", dataUrl }),
  });
  const data = await readApiJson(response);
  return data.item;
}

function insertMarkdownAtCursor(value, insertion, start, end = start) {
  const source = text(value);
  const safeStart = Math.max(0, Math.min(start ?? source.length, source.length));
  const safeEnd = Math.max(safeStart, Math.min(end ?? safeStart, source.length));
  const before = source.slice(0, safeStart);
  const after = source.slice(safeEnd);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n" : "";
  const nextValue = `${before}${prefix}${insertion}${suffix}${after}`;
  return {
    value: nextValue,
    cursor: before.length + prefix.length + insertion.length + suffix.length,
  };
}

function markdownImageText(item) {
  const alt = text(item.filename).replace(/\.[^.]+$/, "") || "图片";
  return `![${alt}](${item.src})`;
}

function extractMarkdownImageSrc(value) {
  const match = text(value).match(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  return match ? match[1] : "";
}

function blockImageSrc(block) {
  if (!block || typeof block !== "object") return "";
  if (block.type === "image" || block.kind === "image") {
    return text(block.src || block.url || block.path || block.value || block.content);
  }
  return extractMarkdownImageSrc(block.content || block.value || block.text || block.body);
}

function thumbnailCandidatesFromObject(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(thumbnailCandidatesFromObject);
  if (typeof value !== "object") return imageSrcsFromValue(value);
  return Object.entries(value)
    .filter(([key]) => !["raw", "payload", "blocks"].includes(key))
    .flatMap(([, item]) => thumbnailCandidatesFromObject(item));
}

function contentThumbnailSrc(item) {
  const payload = draftPayload(item);
  const candidates = [
    item?.thumbnail,
    item?.cover,
    item?.image,
    item?.path,
    item?.acceptanceMetrics,
    item?.flow,
    item?.lineage,
    item?.principle,
    ...(Array.isArray(item?.sampleImages) ? item.sampleImages : []),
    payload.thumbnail,
    payload.cover,
    payload.image,
    payload.path,
    payload.acceptanceMetrics,
    payload.flow,
    payload.lineage,
    payload.principle,
    ...(Array.isArray(payload.sampleImages) ? payload.sampleImages : []),
    extractMarkdownImageSrc(item?.summary),
    extractMarkdownImageSrc(item?.industrialValue),
    extractMarkdownImageSrc(item?.experience),
    extractMarkdownImageSrc(item?.characteristics),
    extractMarkdownImageSrc(draftBody(item)),
    ...thumbnailCandidatesFromObject(item),
    ...thumbnailCandidatesFromObject(payload),
    ...((item?.blocks || payload.blocks || []).map(blockImageSrc)),
  ];
  return candidates.flatMap(imageSrcsFromValue).find(Boolean) || "";
}

function useKnowledgeData() {
  const [state, setState] = useState({ data: DEFAULT_DATA, loading: true, error: "" });

  async function refresh() {
    try {
      const response = await fetch(`/kb-data.json?ts=${Date.now()}`);
      if (!response.ok) throw new Error(`数据读取失败：${response.status}`);
      const data = await response.json();
      setState({ data: { ...DEFAULT_DATA, ...data }, loading: false, error: "" });
      return data;
    } catch (error) {
      setState({ data: DEFAULT_DATA, loading: false, error: error.message });
      return null;
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { ...state, refresh };
}

function normalizeDraft(item) {
  if (!item) return item;
  let payload = item.payload || {};
  if (!Object.keys(payload).length && item.payload_json) {
    try {
      payload = JSON.parse(item.payload_json);
    } catch {
      payload = {};
    }
  }
  return { ...item, payload };
}

function useDraftWorkspace({ onKnowledgeChanged } = {}) {
  const [state, setState] = useState({ drafts: [], archive: [], loading: true, error: "" });

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    return readApiJson(response);
  }

  async function refresh() {
    try {
      const [draftData, archiveData] = await Promise.all([
        request("/api/drafts"),
        request("/api/archive"),
      ]);
      setState({
        drafts: (draftData.drafts || []).map(normalizeDraft),
        archive: archiveData.archive || [],
        loading: false,
        error: "",
      });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addDraft(draft) {
    const data = await request("/api/drafts", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    const item = normalizeDraft(data.item);
    setState((current) => ({ ...current, drafts: [item, ...current.drafts], error: "" }));
    return item;
  }

  async function importPackage(sourceType, rawContent) {
    await request("/api/imports", {
      method: "POST",
      body: JSON.stringify({ sourceType, rawContent }),
    });
    await refresh();
  }

  async function updateDraft(draftId, updates) {
    await request(`/api/drafts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    await refresh();
  }

  async function runDraftAction(draftId, action, payload = {}) {
    const data = await request(`/api/drafts/${draftId}/${action}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await refresh();
    if (action === "publish" && typeof onKnowledgeChanged === "function") await onKnowledgeChanged();
    return data.item;
  }

  async function restoreArchive(archiveId) {
    await request(`/api/archive/${archiveId}/restore`, { method: "POST", body: "{}" });
    await refresh();
  }

  return {
    ...state,
    refresh,
    addDraft,
    importPackage,
    updateDraft,
    submitDraft: (draftId) => runDraftAction(draftId, "submit"),
    approveDraft: (draftId) => runDraftAction(draftId, "approve"),
    publishDraft: (draftId) => runDraftAction(draftId, "publish"),
    archiveDraft: (draftId) => runDraftAction(draftId, "archive", { reason: "前端归档" }),
    deleteDraft: (draftId) => runDraftAction(draftId, "delete", { reason: "前端删除草稿" }),
    restoreArchive,
  };
}

function useMaintenanceWorkspace() {
  const [state, setState] = useState({ audit: null, backup: null, loading: true, busy: false, error: "" });

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    return readApiJson(response);
  }

  async function refresh() {
    try {
      const data = await request("/api/maintenance/audit");
      setState((current) => ({ ...current, audit: data.audit, loading: false, error: "" }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createBackup() {
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const data = await request("/api/maintenance/backup", { method: "POST", body: "{}" });
      setState((current) => ({ ...current, backup: data.item, busy: false, error: "" }));
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  return { ...state, refresh, createBackup };
}

function usePagedCards(cards, pageSize = 4) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(cards.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleCards = cards.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  return { page: safePage, pageCount, visibleCards, setPage };
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("页面渲染异常", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error">
          <h1>页面渲染异常</h1>
          <p>{this.state.error.message || "前端运行时出现异常，请刷新页面或查看浏览器控制台。"}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [module, setModule] = useState(MODULES[0]);
  const [drawer, setDrawer] = useState(null);
  const [modal, setModal] = useState(null);
  const [globalKeyword, setGlobalKeyword] = useState("");
  const { data, loading, error, refresh: refreshKnowledgeData } = useKnowledgeData();
  const draftWorkspace = useDraftWorkspace({ onKnowledgeChanged: refreshKnowledgeData });
  const maintenanceWorkspace = useMaintenanceWorkspace();
  const {
    drafts,
    addDirection,
    hideDirection,
    restoreDirection,
    addSubTechCard,
    updateSubTechCard,
    deleteSubTechCard,
    addResearchCard,
    updateResearchCard,
    deleteResearchCard,
    addProjectCard,
    updateProjectCard,
    deleteProjectCard,
    addDatasetCard,
    updateDatasetCard,
    deleteDatasetCard,
  } = useLocalDrafts();
  const model = useMemo(() => buildCapabilityModel(data, drafts), [data, drafts]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="nav-inner">
          <div className="nav-left">
            <button className="brand" type="button" onClick={() => setModule(MODULES[0])}>
              <img className="brand-icon" src="/zhiliao-workshop-icon.png" alt="" />
              <span>知了工坊</span>
            </button>
            <nav className="module-nav" aria-label="知识库模块">
              {MODULES.map((item) => (
                <button
                  className={`module-button ${item === module ? "active" : ""} ${item === "技术积累" ? "final-module-button" : ""}`}
                  key={item}
                  type="button"
                  onClick={() => setModule(item)}
                >
                  {item}
                </button>
              ))}
            </nav>
          </div>
          <GlobalSearchBox
            value={globalKeyword}
            onChange={setGlobalKeyword}
            placeholder={`搜索${module}内容`}
          />
        </div>
      </header>

      <main className="page">
        {loading && <EmptyState title="正在加载知识库数据" body="读取 web/public/kb-data.json。" />}
        {error && <EmptyState title="数据读取失败" body={error} />}
        {!loading && !error && (
          <ModuleView
            module={module}
            model={model}
            keyword={globalKeyword}
            onOpen={setDrawer}
            onCreate={setModal}
            onHideDirection={hideDirection}
            onRestoreDirection={restoreDirection}
            archivedDirectionNames={drafts.hiddenDirectionNames}
            onUpdateResearch={updateResearchCard}
            onDeleteSubTech={deleteSubTechCard}
            onDeleteResearch={deleteResearchCard}
            onDeleteProject={deleteProjectCard}
            onDeleteDataset={deleteDatasetCard}
            draftWorkspace={draftWorkspace}
            maintenanceWorkspace={maintenanceWorkspace}
          />
        )}
      </main>

      <DetailDrawer detail={drawer} onClose={() => setDrawer(null)} />
      <CreateModal
        modal={modal}
        directions={model.directions}
        onClose={() => setModal(null)}
        onAddDirection={addDirection}
        onAddSubTechCard={addSubTechCard}
        onUpdateSubTechCard={updateSubTechCard}
        onAddResearchCard={addResearchCard}
        onUpdateResearchCard={updateResearchCard}
        onAddProjectCard={addProjectCard}
        onUpdateProjectCard={updateProjectCard}
        onAddDatasetCard={addDatasetCard}
        onUpdateDatasetCard={updateDatasetCard}
        onAddDraft={draftWorkspace.addDraft}
        onImportPackage={draftWorkspace.importPackage}
        onUpdateDraft={draftWorkspace.updateDraft}
      />
    </div>
  );
}

function ModuleView({
  module,
  model,
  keyword,
  onOpen,
  onCreate,
  onHideDirection,
  onRestoreDirection,
  archivedDirectionNames,
  onUpdateResearch,
  onDeleteSubTech,
  onDeleteResearch,
  onDeleteProject,
  onDeleteDataset,
  draftWorkspace,
  maintenanceWorkspace,
}) {
  if (module === "技术积累") {
    return (
      <TechModule
        model={model}
        keyword={keyword}
        onOpen={onOpen}
        onCreate={onCreate}
        onHideDirection={onHideDirection}
        onRestoreDirection={onRestoreDirection}
        archivedDirectionNames={archivedDirectionNames}
        onDeleteSubTech={onDeleteSubTech}
        draftWorkspace={draftWorkspace}
      />
    );
  }
  if (module === "前沿研究") {
    return (
      <ResearchModule
        model={model}
        keyword={keyword}
        onOpen={onOpen}
        onCreate={onCreate}
        onUpdate={onUpdateResearch}
        onDelete={onDeleteResearch}
      />
    );
  }
  if (module === "项目应用") return <ProjectsModule model={model} keyword={keyword} onOpen={onOpen} onCreate={onCreate} onDelete={onDeleteProject} />;
  if (module === "数据积累") return <DataModule model={model} keyword={keyword} onOpen={onOpen} onCreate={onCreate} onDelete={onDeleteDataset} />;
  return <DraftsModule keyword={keyword} workspace={draftWorkspace} maintenance={maintenanceWorkspace} onOpen={onOpen} onCreate={onCreate} />;
}

function TechModule({ model, keyword, onOpen, onCreate, onHideDirection, onRestoreDirection, archivedDirectionNames, onDeleteSubTech, draftWorkspace }) {
  const [selectedDirection, setSelectedDirection] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const directions = model.directions.filter((item) => includesKeyword(item, keyword, ["name", "summary", "description"]));

  if (selectedDirection) {
    return (
      <TechDirectionDetail
        direction={selectedDirection}
        model={model}
        onBack={() => setSelectedDirection(null)}
        onOpen={onOpen}
        onCreate={onCreate}
        onDeleteSubTech={onDeleteSubTech}
        draftWorkspace={draftWorkspace}
      />
    );
  }

  return (
    <section className="tech-board compact-module">
      <ModuleIntro
        action={
          <div className="module-actions tech-icon-actions">
            <button className="icon-button" type="button" onClick={() => onCreate({ type: "direction" })} aria-label="添加新方向" title="添加新方向">+</button>
            <ArchiveBoxButton count={archivedDirectionNames.length} onClick={() => setArchiveOpen(true)} />
          </div>
        }
      />
      <div className="direction-grid direction-scroll">
        {directions.map((item) => (
          <DirectionCard
            key={item.name}
            direction={item}
            onClick={() => setSelectedDirection(item)}
            onHide={onHideDirection}
          />
        ))}
      </div>
      <ArchivedDirectionDrawer
        open={archiveOpen}
        names={archivedDirectionNames}
        model={model}
        onRestore={onRestoreDirection}
        onClose={() => setArchiveOpen(false)}
      />
    </section>
  );
}

function ArchiveBoxButton({ count, onClick }) {
  return (
    <button className="archive-box-button icon-button" type="button" onClick={onClick} aria-label="打开归档箱" title="归档箱">
      <span aria-hidden="true">▣</span>
      <strong>{count}</strong>
    </button>
  );
}

function ArchivedDirectionDrawer({ open, names = [], model, onRestore, onClose }) {
  if (!open) return null;
  return (
    <div className="drawer-layer archive-layer" onMouseDown={onClose}>
      <aside className="archive-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="drawer-type">归档箱</span>
            <h2>已归档方向</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭归档箱">×</button>
        </div>
        {!names.length && <EmptyState title="暂无归档方向" body="归档后的方向会出现在这里，可以随时恢复。" />}
        <div className="archive-list">
          {names.map((name) => {
            const stats = archivedDirectionStats(name, model);
            return (
              <article className="archive-item" key={name}>
                <div>
                  <h3>{name}</h3>
                  <p>{stats.subTechCount} 子技术 · {stats.researchCount} 论文 · {stats.projectCount} 项目 · {stats.datasetCount} 数据</p>
                </div>
                <button type="button" onClick={() => onRestore(name)}>恢复方向</button>
              </article>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function archivedDirectionStats(name, model) {
  return {
    subTechCount: model.subTechCards.filter((item) => item.direction === name).length,
    researchCount: model.researchCards.filter((item) => item.direction === name).length,
    projectCount: model.projectCards.filter((item) => item.direction === name).length,
    datasetCount: model.datasetCards.filter((item) => item.direction === name).length,
  };
}

function DirectionCard({ direction, onClick, onHide }) {
  return (
    <article className="direction-card">
      <div className="card-top compact-top">
        <CardActionMenu
          actions={[
            ["查看方向", onClick],
            ["归档方向", () => onHide(direction.name), "danger"],
          ]}
        />
      </div>
      <button className="card-main-button" type="button" onClick={onClick}>
        <h3>{direction.name}</h3>
        <p>{direction.summary}</p>
        <div className="metric-row">
          <span><strong>{direction.subTechCount}</strong> 子技术</span>
          <span><strong>{direction.researchCount}</strong> 论文</span>
          <span><strong>{direction.projectCount}</strong> 项目</span>
        </div>
      </button>
    </article>
  );
}

function TechDirectionDetail({ direction, model, draftWorkspace, onBack, onOpen, onCreate, onDeleteSubTech }) {
  const subTechCards = model.subTechCards.filter((item) => item.direction === direction.name);
  const researchCards = model.researchCards.filter((item) => item.direction === direction.name);
  const projectCards = model.projectCards.filter((item) => item.direction === direction.name);
  const datasetCards = model.datasetCards.filter((item) => item.direction === direction.name);
  const directionDrafts = (draftWorkspace?.drafts || []).filter((item) => (
    item.draft_type === "tech_card" &&
    !["published", "archived"].includes(item.status) &&
    draftDirection(item) === direction.name
  ));

  async function publishDirectionDraft(item) {
    const result = await draftWorkspace.publishDraft(item.draft_id);
    if (result?.document_id) onOpen(detailFromPublishedDraft(item, result));
  }

  return (
    <section className="direction-detail-page">
      <button className="back-button" type="button" onClick={onBack}>返回技术方向</button>
      <div className="detail-hero">
        <div>
          <h1>{direction.name}</h1>
          <p>{direction.summary}</p>
        </div>
        <div className="detail-stats">
          <span><strong>{subTechCards.length}</strong>子技术</span>
          <span><strong>{researchCards.length}</strong>研究卡</span>
          <span><strong>{projectCards.length + datasetCards.length}</strong>资产支撑</span>
        </div>
      </div>

      <SectionTitle
        title="子技术卡"
        body="记录该方向已经在工业项目中验证过的具体技术，固定字段之外保留自定义经验栏。"
        action={
          <button className="primary-add-button" type="button" onClick={() => onCreate({ type: "draft", draftType: "tech_card", direction: direction.name })}>
            + 新建技术草稿
          </button>
        }
      />
      <div className="content-grid">
        {subTechCards.map((item) => (
          <SubTechCard key={item.id} item={item} onOpen={onOpen} onCreate={onCreate} onDelete={onDeleteSubTech} />
        ))}
      </div>
      {!subTechCards.length && <EmptyState title="暂无技术卡" body="先新建技术草稿，发布后会沉淀为该方向的正式技术卡。" />}

      {!!directionDrafts.length && (
        <>
          <SectionTitle title="草稿待收录" body="这些草稿已经归到当前方向，确认后会进入正式技术卡。" />
          <div className="content-feed direction-draft-feed">
            {directionDrafts.map((item) => (
              <DraftListCard
                key={item.draft_id}
                item={item}
                onSelect={() => onOpen(detailFromDraft(item))}
                onOpen={onOpen}
                onSubmit={draftWorkspace.submitDraft}
                onApprove={draftWorkspace.approveDraft}
                onPublish={publishDirectionDraft}
                onArchive={draftWorkspace.archiveDraft}
                onDelete={draftWorkspace.deleteDraft}
                onEdit={(draft) => onCreate({ type: "editDraft", draft })}
              />
            ))}
          </div>
        </>
      )}

      <SectionTitle title="研究与项目证据" body="前沿论文、项目应用和数据资产共同构成该方向的证据链。" />
      <div className="evidence-lane">
        <EvidenceColumn title="研究来源" items={researchCards} empty="暂无研究卡" onOpen={onOpen} />
        <EvidenceColumn title="项目应用" items={projectCards} empty="暂无项目卡" onOpen={onOpen} />
        <EvidenceColumn title="数据支撑" items={datasetCards} empty="暂无数据卡" onOpen={onOpen} />
      </div>
    </section>
  );
}

function SubTechCard({ item, onOpen, onCreate, onDelete }) {
  return (
    <article className="resource-card subtech-card">
      <CardTop>
        <Badge>{item.direction}</Badge>
        <Badge tone={item.source === "draft" ? "priority" : "success"}>{item.source === "draft" ? "草稿" : "技术卡"}</Badge>
        <CardActionMenu
          actions={[
            ["查看详情", () => onOpen(detailFromSubTech(item))],
            ["编辑", () => onCreate({ type: "editSubTech", card: item })],
            ["复制为草稿", () => onCreate({ type: "draft", draftType: "tech_card", direction: item.direction, card: item })],
            ["删除", () => onDelete(item.id), "danger"],
          ]}
        />
      </CardTop>
      <h3>{item.techName || "未命名技术"}</h3>
      <dl>
        <div><dt>技术脉络图</dt><dd>{item.lineage || "未填写"}</dd></div>
        <div><dt>技术原理</dt><dd>{item.principle || "未填写"}</dd></div>
        <div><dt>应用效果</dt><dd>{item.applicationEffect || "未填写"}</dd></div>
        <div><dt>优势 / 不足</dt><dd>{[item.strengths, item.limitations].filter(Boolean).join(" / ") || "未填写"}</dd></div>
      </dl>
      <KnowledgeBlockRenderer blocks={item.blocks} compact />
    </article>
  );
}

function ResearchModule({ model, keyword, onOpen, onCreate, onUpdate, onDelete }) {
  const [selectedDirections, setSelectedDirections] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const cards = model.researchCards.filter((item) => {
    const directionMatch = !selectedDirections.length || selectedDirections.includes(item.direction);
    const statusMatch = !statuses.length || statuses.includes(item.status);
    return directionMatch &&
      statusMatch &&
      includesKeyword(item, keyword, ["title", "summary", "industrialValue", "directionKeywords", "officialGithub", "paperUrl"]);
  });

  return (
    <section className="compact-module">
      <div className="research-workbench content-feed">
        <section className="research-list-panel">
          <div className="research-filter-strip">
            <ChipGroup options={[ALL_FILTER, ...model.directions.map((item) => item.name)]} selected={selectedDirections} onChange={setSelectedDirections} multiple />
            <ChipGroup options={[ALL_FILTER, ...RESEARCH_STATUS]} selected={statuses} onChange={setStatuses} multiple />
          </div>
          <div className="research-list-scroll">
            {cards.map((item) => (
              <ResearchCard
                key={item.id}
                item={item}
                onSelect={() => onOpen(detailFromResearch(item))}
                onOpen={onOpen}
                onCreate={onCreate}
                onUpdate={onUpdate}
                onDelete={onDelete}
              />
            ))}
            {!cards.length && <EmptyState title="暂无论文" body="调整筛选条件，或新建论文草稿进入审核发布流程。" />}
          </div>
        </section>
      </div>
    </section>
  );
}

function ResearchCard({ item, active, onSelect, onOpen, onCreate, onUpdate, onDelete }) {
  return (
    <article className={`research-list-card ${active ? "active" : ""}`}>
      <CardTop>
        <Badge>{item.direction}</Badge>
        <Badge tone={badgeTone(item.status)}>{item.status}</Badge>
        <CardActionMenu
          actions={[
            ["查看详情", () => onOpen(detailFromResearch(item))],
            ["编辑", () => onCreate({ type: "editResearch", card: item })],
            ["生成技术草稿", () => onCreate({ type: "draft", draftType: "tech_card", direction: item.direction, card: subTechSeedFromResearch(item) })],
            ["标记已结论", () => onUpdate(item.id, { status: "已结论" })],
            ["复制为草稿", () => onCreate({ type: "draft", draftType: "research_paper", card: item })],
            ["删除", () => onDelete(item.id), "danger"],
          ]}
        />
      </CardTop>
      <div className="feed-row-body">
        <button type="button" className="research-card-main" onClick={onSelect}>
          <h3>{item.title}</h3>
          <p>{feedSummary(item.industrialValue || item.summary, "暂无工业价值判断。")}</p>
        </button>
        <FeedThumbnail item={item} />
      </div>
      <KnowledgeBlockRenderer blocks={item.blocks} compact />
    </article>
  );
}

function LifecycleStepper({ status, onChange }) {
  return (
    <div className="lifecycle-stepper" aria-label="生命周期">
      <div>
        {RESEARCH_STATUS.map((item) => (
          <button key={item} type="button" className={item === status ? "active" : ""} onClick={() => onChange(item)}>
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectsModule({ model, keyword, onOpen, onCreate, onDelete }) {
  const [direction, setDirection] = useState(ALL_FILTER);
  const cards = model.projectCards.filter((item) => {
    const directionMatch = direction === ALL_FILTER || item.direction === direction;
    return directionMatch && includesKeyword(item, keyword, ["title", "requirements", "keyTech", "flow", "experience", "status"]);
  });

  return (
    <section className="compact-module">
      <div className="project-index-layout">
        <FilterBar compact>
          <ChipGroup options={[ALL_FILTER, ...model.directions.map((item) => item.name)]} selected={direction} onChange={setDirection} />
        </FilterBar>
        <div className="content-feed">
          {cards.map((item) => (
            <ProjectCard key={item.id} item={item} onOpen={onOpen} onCreate={onCreate} onDelete={onDelete} />
          ))}
        </div>
      </div>
      {!cards.length && <EmptyState title="暂无项目卡" body="项目验证结束后，把需求、指标、方案流程和经验沉淀为长期资产。" />}
    </section>
  );
}

function DataModule({ model, keyword, onOpen, onCreate, onDelete }) {
  const [direction, setDirection] = useState(ALL_FILTER);
  const cards = model.datasetCards.filter((item) => {
    const directionMatch = direction === ALL_FILTER || item.direction === direction;
    return directionMatch && includesKeyword(item, keyword, ["title", "path", "characteristics", "taskFit", "processingNotes", "quality", "labelQuality", "categories"]);
  });

  return (
    <section className="compact-module">
      <div className="dataset-index-layout">
        <FilterBar compact>
          <ChipGroup options={[ALL_FILTER, ...model.directions.map((item) => item.name)]} selected={direction} onChange={setDirection} />
        </FilterBar>
        <div className="content-feed">
          {cards.map((item) => (
            <DatasetCard key={item.id} item={item} onOpen={onOpen} onCreate={onCreate} onDelete={onDelete} />
          ))}
        </div>
      </div>
      {!cards.length && <EmptyState title="暂无数据卡" body="后续可以把项目场景数据路径、质量、标注和样例图维护到这里。" />}
    </section>
  );
}

function DraftsModule({ keyword, workspace, maintenance, onOpen, onCreate }) {
  const [status, setStatus] = useState("all");
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const filterCount = status === "all" ? 0 : 1;
  const drafts = (workspace.drafts || []).filter((item) => {
    const workbenchStatusMatch = WORKBENCH_DRAFT_STATUS.includes(item.status);
    const statusMatch = status === "all" || item.status === status;
    const keywordMatch = includesKeyword(
      { ...item, ...draftPayload(item), typeLabel: draftTypeLabel(item.draft_type) },
      keyword,
      ["title", "draft_type", "typeLabel", "direction", "techName", "summary", "body"],
    );
    return workbenchStatusMatch && statusMatch && keywordMatch;
  });

  async function publishAndOpen(item) {
    const result = await workspace.publishDraft(item.draft_id);
    if (result?.document_id) onOpen(detailFromPublishedDraft(item, result));
  }

  return (
    <section className="compact-module">
      <ModuleIntro
        action={
          <div className="workbench-toolbar" aria-label="工作台工具">
            <button className="icon-button" type="button" onClick={() => onCreate({ type: "importPackage" })} aria-label="导入AI文本" title="导入AI文本">AI</button>
            <button className="icon-button" type="button" onClick={() => onCreate({ type: "draft" })} aria-label="新建草稿" title="新建草稿">+</button>
            <button className="icon-button" type="button" onClick={workspace.refresh} aria-label="刷新草稿" title="刷新草稿">↻</button>
            <button className="icon-button" type="button" onClick={() => setMaintenanceOpen(true)} aria-label="打开系统维护" title="系统维护">⚙</button>
          </div>
        }
      />
      {workspace.error && <EmptyState title="草稿服务不可用" body={workspace.error} />}
      <div className="draft-workbench maintenance-workbench content-feed">
        <section className="research-list-panel">
          <div className="feed-filter-strip">
            <div className="chips">
              {["all", ...WORKBENCH_DRAFT_STATUS].map((itemStatus) => (
                <button
                  className={`chip ${status === itemStatus ? "active" : ""}`}
                  type="button"
                  key={itemStatus}
                  onClick={() => setStatus(itemStatus)}
                >
                  {itemStatus === "all" ? "全部" : draftStatusLabel(itemStatus)}
                </button>
              ))}
            </div>
          </div>
          <div className="research-list-scroll">
            {workspace.loading && <EmptyState title="正在读取草稿" body="读取统一草稿表。" />}
            {drafts.map((item) => (
              <DraftListCard
                key={item.draft_id}
                item={item}
                onSelect={() => onOpen(detailFromDraft(item))}
                onOpen={onOpen}
                onSubmit={workspace.submitDraft}
                onApprove={workspace.approveDraft}
                onPublish={publishAndOpen}
                onArchive={workspace.archiveDraft}
                onDelete={workspace.deleteDraft}
                onEdit={(item) => onCreate({ type: "editDraft", draft: item })}
              />
            ))}
            {!workspace.loading && !drafts.length && <EmptyState title="暂无草稿" body="点击“新建草稿”，选择论文、项目、数据或技术草稿。" />}
          </div>
        </section>
        <MaintenanceDrawer
          open={maintenanceOpen}
          maintenance={maintenance}
          archive={workspace.archive || []}
          onRestore={workspace.restoreArchive}
          onClose={() => setMaintenanceOpen(false)}
        />
      </div>
    </section>
  );
}

function MaintenanceDrawer({ open, maintenance, archive, onRestore, onClose }) {
  if (!open) return null;
  return (
    <div className="drawer-layer archive-layer" onMouseDown={onClose}>
      <aside className="maintenance-drawer-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="drawer-type">系统维护</span>
            <h2>对账、归档与备份</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭系统维护">×</button>
        </div>
        <MaintenancePanel maintenance={maintenance} archive={archive} onRestore={onRestore} />
      </aside>
    </div>
  );
}

function MaintenancePanel({ maintenance, archive, onRestore }) {
  const summary = maintenance.audit?.summary || {};
  const archived = archive.filter((item) => !item.restored_at);
  const problems = [
    ...(maintenance.audit?.failed_publish_jobs || []).map((item) => ({ title: "发布失败", body: `${item.draft_id || item.job_id}：${item.error || "未记录错误"}` })),
    ...(maintenance.audit?.missing_markdown_documents || []).map((item) => ({ title: "Markdown缺失", body: `${item.title || item.document_id} -> ${item.document_path}` })),
    ...(maintenance.audit?.orphan_published_knowledge || []).map((item) => ({ title: "孤儿发布索引", body: `${item.published_id} -> ${item.document_id}` })),
  ];

  return (
    <aside className="maintenance-panel">
      <div className="panel-head">
        <div>
          <h2>系统维护</h2>
          <p>对账报告、归档箱和备份导出集中在这里。</p>
        </div>
        <button className="secondary-button" type="button" onClick={maintenance.refresh}>刷新</button>
      </div>
      {maintenance.error && <EmptyState title="维护服务不可用" body={maintenance.error} />}
      <div className="maintenance-metrics" aria-label="对账报告">
        <MetricCard label="未发布草稿" value={summary.unpublished_drafts || 0} />
        <MetricCard label="发布失败" value={summary.failed_publish_jobs || 0} />
        <MetricCard label="已归档" value={summary.archived_records || archived.length || 0} />
        <MetricCard label="Markdown缺失" value={summary.missing_markdown_documents || 0} />
      </div>
      <div className="maintenance-section">
        <div className="panel-head compact-head">
          <h3>备份</h3>
          <button className="primary-add-button" type="button" onClick={maintenance.createBackup} disabled={maintenance.busy}>
            {maintenance.busy ? "正在导出" : "导出备份"}
          </button>
        </div>
        <p>{maintenance.backup?.backup_path || "备份会导出 Markdown、SQLite、文档和配置，用于恢复或作为大模型知识库输入。"}</p>
      </div>
      <div className="maintenance-section">
        <h3>归档箱</h3>
        {archived.slice(0, 6).map((item) => (
          <div className="archive-row" key={item.archive_id}>
            <span>{item.object_id}</span>
            <button type="button" onClick={() => onRestore(item.archive_id)}>恢复</button>
          </div>
        ))}
        {!archived.length && <p>暂无归档草稿。</p>}
      </div>
      <div className="maintenance-section">
        <h3>异常列表</h3>
        {problems.slice(0, 6).map((item) => (
          <div className="issue-row" key={`${item.title}-${item.body}`}>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </div>
        ))}
        {!problems.length && <p>当前没有发布失败、Markdown缺失或孤儿发布索引。</p>}
      </div>
    </aside>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function DraftListCard({ item, active, onSelect, onOpen, onSubmit, onApprove, onPublish, onArchive, onDelete, onEdit }) {
  return (
    <article className={`research-list-card ${active ? "active" : ""}`}>
      <CardTop>
        <Badge>{draftTypeLabel(item.draft_type)}</Badge>
        <Badge tone={badgeTone(draftStatusLabel(item.status))}>{draftStatusLabel(item.status)}</Badge>
        <DraftActionMenu item={item} onOpen={onOpen} onSubmit={onSubmit} onApprove={onApprove} onPublish={onPublish} onArchive={onArchive} onDelete={onDelete} onEdit={onEdit} />
      </CardTop>
      <div className="feed-row-body">
        <button type="button" className="research-card-main" onClick={onSelect}>
          <h3>{draftTitle(item)}</h3>
          <div className="draft-card-meta">
            <span>{draftDirection(item)}</span>
            <span>{draftUpdatedAt(item)}</span>
          </div>
          <p className="draft-card-summary">{draftSummary(item)}</p>
        </button>
        <FeedThumbnail item={item} />
      </div>
    </article>
  );
}

function DraftActionMenu({ item, onOpen, onSubmit, onApprove, onPublish, onArchive, onDelete, onEdit }) {
  const actions = [["查看详情", () => onOpen(detailFromDraft(item))]];
  if (!["archived", "published"].includes(item.status)) actions.push(["编辑草稿", () => onEdit(item)]);
  if (item.status === "draft") actions.push(["提交审核", () => onSubmit(item.draft_id)]);
  if (item.status === "submitted") actions.push(["批准发布", () => onApprove(item.draft_id)]);
  if (!["archived", "published"].includes(item.status)) actions.push(["确认并收录", () => onPublish(item)]);
  if (!["archived", "published"].includes(item.status)) actions.push(["删除草稿", () => (onDelete || onArchive)(item.draft_id), "danger"]);
  return <CardActionMenu actions={actions} />;
}

function draftPayload(item) {
  return item?.payload && typeof item.payload === "object" ? item.payload : {};
}

function draftTitle(item) {
  const payload = draftPayload(item);
  return payload.techName || item.title || "未命名草稿";
}

function draftBody(item) {
  const payload = draftPayload(item);
  return payload.body || payload.principle || payload.summary || payload.applicationEffect || payload.projectUsage || "";
}

function draftSummary(item) {
  return feedSummary(draftBody(item));
}

function draftDirection(item) {
  const payload = draftPayload(item);
  return payload.direction || "未归类";
}

function draftUpdatedAt(item) {
  const raw = text(item.updated_at || item.created_at);
  return raw ? raw.replace("T", " ").slice(0, 16) : "未记录时间";
}

function draftTypeLabel(type) {
  return {
    tech_card: "技术草稿",
    research_paper: "论文草稿",
    project_case: "项目草稿",
    dataset_card: "数据草稿",
  }[type] || "知识草稿";
}

function draftStatusLabel(status) {
  return DRAFT_STATUS_LABELS[status] || status || "草稿";
}

function draftPublishTarget(item) {
  return {
    research_paper: "前沿研究",
    project_case: "项目应用",
    dataset_card: "数据积累",
    tech_card: "技术积累",
  }[item?.draft_type] || "知识库";
}

function draftAiSuggestion(item, payload) {
  const direction = payload.direction || "未归类";
  return `${draftTypeLabel(item.draft_type)} · ${direction}`;
}

function draftPendingConfirmation(payload) {
  const missing = [
    ["技术方向", payload.direction],
    ["标题", payload.title || payload.techName],
    ["摘要", payload.summary || payload.body || payload.applicationEffect || payload.experience || payload.characteristics],
  ].filter(([, value]) => !text(value).trim()).map(([label]) => label);
  return missing.length ? `需补充：${missing.join("、")}` : "核心字段已填写";
}

function ProjectCard({ item, onOpen, onCreate, onDelete }) {
  return (
    <article className="resource-card">
      <CardTop>
        <Badge>{item.direction}</Badge>
        <Badge tone={badgeTone(item.status)}>{item.status}</Badge>
        <CardActionMenu
          actions={[
            ["查看详情", () => onOpen(detailFromProject(item))],
            ["编辑", () => onCreate({ type: "editProject", card: item })],
            ["复制为草稿", () => onCreate({ type: "draft", draftType: "project_case", card: item })],
            ["删除", () => onDelete(item.id), "danger"],
          ]}
        />
      </CardTop>
      <div className="feed-row-body">
        <button type="button" className="resource-card-main" onClick={() => onOpen(detailFromProject(item))}>
          <h3>{item.title}</h3>
          <p>{feedSummary(item.experience || item.requirements, "暂无项目场景。")}</p>
          <div className="feed-meta-row">
            <span>{feedSummary(item.projectStage || item.status, "未填写阶段", 64)}</span>
            <span>{feedSummary(item.keyTech, "未填写关键技术", 80)}</span>
            <span>{feedSummary(item.acceptanceMetrics || item.metricSpec, "未填写指标", 80)}</span>
          </div>
        </button>
        <FeedThumbnail item={item} />
      </div>
      <KnowledgeBlockRenderer blocks={item.blocks} compact />
    </article>
  );
}

function DatasetCard({ item, onOpen, onCreate, onDelete }) {
  const imageLike = /\.(png|jpe?g|webp|gif)$/i.test(text(item.path));
  return (
    <article className="resource-card">
      <CardTop>
        <Badge>{item.direction}</Badge>
        <Badge tone="priority">数据卡</Badge>
        <CardActionMenu
          actions={[
            ["查看详情", () => onOpen(detailFromDataset(item))],
            ["编辑", () => onCreate({ type: "editDataset", card: item })],
            ["复制为草稿", () => onCreate({ type: "draft", draftType: "dataset_card", card: item })],
            ["删除", () => onDelete(item.id), "danger"],
          ]}
        />
      </CardTop>
      {imageLike && <img className="sample-image" src={item.path} alt={`${item.title} 样例`} />}
      <div className="feed-row-body">
        <button type="button" className="resource-card-main" onClick={() => onOpen(detailFromDataset(item))}>
          <h3>{item.title}</h3>
          <p>{feedSummary(item.characteristics || item.processingNotes, "暂无数据特点。")}</p>
          <div className="feed-meta-row">
            <span>{feedSummary(item.taskFit, "未填写适配任务", 80)}</span>
            <span>{feedSummary(item.quality, "未填写质量", 80)}</span>
            <span>{feedSummary(item.pathStatus, "未校验路径", 64)}</span>
          </div>
        </button>
        <FeedThumbnail item={item} />
      </div>
      <KnowledgeBlockRenderer blocks={item.blocks} compact />
    </article>
  );
}

function FeedThumbnail({ item }) {
  const src = contentThumbnailSrc(item);
  if (!src) return null;
  return <img className="feed-thumbnail" src={resolveKnowledgeAssetSrc(src)} alt="" loading="lazy" />;
}

function EvidenceColumn({ title, items, empty, onOpen }) {
  return (
    <section className="evidence-column">
      <h3>{title}</h3>
      {items.slice(0, 3).map((item) => (
        <button className="evidence-item" type="button" key={item.id} onClick={() => onOpen(detailFromAny(item))}>
          <strong>{item.title || item.techName}</strong>
          <span>{item.status || item.direction}</span>
        </button>
      ))}
      {!items.length && <p>{empty}</p>}
    </section>
  );
}

function ModuleIntro({ title, body, action }) {
  if (!title && !body && !action) return null;
  return (
    <section className={`module-intro ${!title && !body ? "action-only" : ""}`}>
      {(title || body) && (
        <div>
          {title && <h1>{title}</h1>}
          {body && <p>{body}</p>}
        </div>
      )}
      {action}
    </section>
  );
}

function SectionTitle({ title, body, action }) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {body && <p>{body}</p>}
      </div>
      {action}
    </div>
  );
}

function FilterBar({ children, compact = false }) {
  return <section className={`filter-bar ${compact ? "feed-filter-strip" : ""}`}>{children}</section>;
}

function ChipGroup({ label, options, selected, onChange, multiple = false }) {
  function toggle(option) {
    if (!multiple) {
      onChange(option);
      return;
    }
    const next = option === ALL_FILTER ? [] : toggleMultiSelection(selected, option);
    onChange(next);
  }

  return (
    <div className="filter-group">
      {label && <span className="filter-label">{label}</span>}
      <div className="chips">
        {options.map((option) => {
          const active = multiple ? (option === ALL_FILTER ? selected.length === 0 : selected.includes(option)) : selected === option;
          return (
            <button className={`chip ${active ? "active" : ""}`} type="button" key={option} onClick={() => toggle(option)}>
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="search-box">
      <span>搜索</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function GlobalSearchBox({ value, onChange, placeholder }) {
  return (
    <label className="global-search-box">
      <span>搜索</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Badge({ children, tone }) {
  return <span className={`badge ${tone || badgeTone(children)}`}>{children || "未填写"}</span>;
}

function CardTop({ children }) {
  return <div className="card-top">{children}</div>;
}

function EmptyState({ title, body }) {
  return (
    <section className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
    </section>
  );
}

function CreateModal({
  modal,
  directions,
  onClose,
  onAddDirection,
  onAddSubTechCard,
  onUpdateSubTechCard,
  onAddResearchCard,
  onUpdateResearchCard,
  onAddProjectCard,
  onUpdateProjectCard,
  onAddDatasetCard,
  onUpdateDatasetCard,
  onAddDraft,
  onImportPackage,
  onUpdateDraft,
}) {
  if (!modal) return null;
  const title = {
    direction: "添加新方向",
    editSubTech: "编辑技术卡",
    draft: "新建草稿",
    editDraft: "编辑草稿",
    importPackage: "导入AI文本",
    editResearch: "编辑论文卡",
    editProject: "编辑项目卡",
    editDataset: "编辑数据卡",
  }[modal.type];
  return (
    <div className="drawer-layer modal-layer" onMouseDown={onClose}>
      <aside className="drawer create-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭详情">×</button>
        </div>
        {modal.type === "direction" ? (
          <DirectionForm onSave={(value) => { onAddDirection(value); onClose(); }} />
        ) : modal.type === "importPackage" ? (
          <ImportPackageForm onSave={(value) => { onImportPackage(value.sourceType, value.rawContent); onClose(); }} />
        ) : modal.type === "draft" ? (
          <DraftCreateForm
            directions={directions}
            initialDraftType={modal.draftType}
            initialDirection={modal.direction}
            initialCard={modal.card}
            onSave={(value) => { onAddDraft(value); onClose(); }}
          />
        ) : modal.type === "editDraft" ? (
          <DraftEditForm
            draft={modal.draft}
            directions={directions}
            onSave={(value) => { onUpdateDraft(modal.draft.draft_id, value); onClose(); }}
          />
        ) : modal.type === "editResearch" ? (
          <PaperForm
            directions={directions}
            initialCard={modal.card}
            onSave={(value) => { onUpdateResearchCard(modal.card.id, value); onClose(); }}
          />
        ) : modal.type === "editProject" ? (
          <ProjectForm
            directions={directions}
            initialCard={modal.card}
            onSave={(value) => { onUpdateProjectCard(modal.card.id, value); onClose(); }}
          />
        ) : modal.type === "editDataset" ? (
          <DatasetForm
            directions={directions}
            initialCard={modal.card}
            onSave={(value) => { onUpdateDatasetCard(modal.card.id, value); onClose(); }}
          />
        ) : modal.type === "editSubTech" ? (
          <SubTechForm
            directions={directions}
            initialCard={modal.card}
            onSave={(value) => { onUpdateSubTechCard(modal.card.id, value); onClose(); }}
          />
        ) : (
          <EmptyState title="未知操作" body="请关闭窗口后重新选择入口。" />
        )}
      </aside>
    </div>
  );
}

function DirectionForm({ onSave }) {
  const [form, setForm] = useState({ name: "", summary: "" });
  return (
    <form className="edit-form" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <Field label="方向名称" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
      <Field label="方向说明" value={form.summary} onChange={(summary) => setForm({ ...form, summary })} multiline />
      <button className="submit-button" type="submit">保存方向草稿</button>
    </form>
  );
}

function DraftCreateForm({ directions, initialDraftType, initialDirection, initialCard, onSave }) {
  const [selectedDraftType, setSelectedDraftType] = useState(initialDraftType || "research_paper");
  const cardSeed = { ...(initialCard || {}) };
  if (initialDirection && !cardSeed.direction) cardSeed.direction = initialDirection;

  function saveDraft(value) {
    onSave(draftFromTypedForm(selectedDraftType, value));
  }

  return (
    <section className="draft-create-form">
      <label className="form-field">
        <span>草稿类型</span>
        <select value={selectedDraftType} onChange={(event) => setSelectedDraftType(event.target.value)}>
          {DRAFT_CREATE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {selectedDraftType === "tech_card" && (
        <SubTechForm directions={directions} initialDirection={initialDirection} initialCard={cardSeed} onSave={saveDraft} />
      )}
      {selectedDraftType === "research_paper" && (
        <PaperForm directions={directions} initialCard={cardSeed} onSave={saveDraft} />
      )}
      {selectedDraftType === "project_case" && (
        <ProjectForm directions={directions} initialCard={cardSeed} onSave={saveDraft} />
      )}
      {selectedDraftType === "dataset_card" && (
        <DatasetForm directions={directions} initialCard={cardSeed} onSave={saveDraft} />
      )}
    </section>
  );
}

function ImportPackageForm({ onSave }) {
  const [form, setForm] = useState({ sourceType: "paper_brief", rawContent: "" });
  const sourceTypes = [
    ["paper_brief", "论文简报"],
    ["project_review", "项目复盘"],
    ["dataset_note", "数据说明"],
    ["tech_template", "技术卡模板"],
  ];
  return (
    <form className="edit-form" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <label className="form-field">
        <span>导入类型</span>
        <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })}>
          {sourceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <Field
        label="AI解析文本"
        value={form.rawContent}
        onChange={(rawContent) => setForm({ ...form, rawContent })}
        multiline
        required
      />
      <button className="submit-button" type="submit">生成可审核草稿</button>
    </form>
  );
}

function DraftEditForm({ draft, directions, onSave }) {
  const payload = draftPayload(draft);
  const draftType = draft?.draft_type || "tech_card";
  const isResearchDraft = draftType === "research_paper";
  const isProjectDraft = draftType === "project_case";
  const isDatasetDraft = draftType === "dataset_card";
  const isTechDraft = draftType === "tech_card";
  const [form, setForm] = useState({
    title: draft?.title || payload.title || payload.techName || "",
    direction: payload.direction || directions[0]?.name || "",
    status: payload.status || "",
    techName: payload.techName || "",
    officialPaperLink: payload.officialPaperLink || "",
    officialGithub: payload.officialGithub || "",
    codeRepo: payload.codeRepo || "",
    paperUrl: payload.paperUrl || "",
    summary: payload.summary || "",
    body: payload.body || "",
    directionKeywords: payload.directionKeywords || "",
    industrialValue: payload.industrialValue || "",
    applicationEffect: payload.applicationEffect || "",
    principle: payload.principle || "",
    lineage: payload.lineage || "",
    strengths: payload.strengths || "",
    limitations: payload.limitations || "",
    verificationConclusion: payload.verificationConclusion || "",
    experimentObservation: payload.experimentObservation || "",
    failureReason: payload.failureReason || "",
    experimentExperience: payload.experimentExperience || "",
    projectUsage: payload.projectUsage || "",
    customFieldsText: joinLines(payload.customFields),
    projectStage: payload.projectStage || "",
    acceptanceMetrics: payload.acceptanceMetrics || "",
    requirements: payload.requirements || "",
    metricSpec: payload.metricSpec || "",
    keyTech: payload.keyTech || "",
    relatedDatasetsText: joinLines(payload.relatedDatasets),
    relatedPapersText: joinLines(payload.relatedPapers),
    relatedTechCardsText: joinLines(payload.relatedTechCards),
    flow: payload.flow || "",
    experience: payload.experience || "",
    retrospectiveConclusion: payload.retrospectiveConclusion || "",
    docPath: payload.docPath || "",
    path: payload.path || "",
    dataVersion: payload.dataVersion || "",
    annotationVersion: payload.annotationVersion || "",
    characteristics: payload.characteristics || "",
    taskFit: payload.taskFit || "",
    processingNotes: payload.processingNotes || "",
    processingScript: payload.processingScript || "",
    quality: payload.quality || "",
    labelQuality: payload.labelQuality || "",
    categories: payload.categories || "",
    sampleImagesText: joinLines(payload.sampleImages),
    relatedProjectsText: joinLines(payload.relatedProjects),
    relatedTechValidationsText: joinLines(payload.relatedTechValidations),
    blocks: payload.blocks || [],
  });
  const directionOptions = Array.from(new Set([form.direction, ...directions.map((direction) => direction.name)].filter(Boolean)));

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save(event) {
    event.preventDefault();
    const {
      title,
      customFieldsText,
      relatedDatasetsText,
      relatedPapersText,
      relatedTechCardsText,
      sampleImagesText,
      relatedProjectsText,
      relatedTechValidationsText,
      ...payloadUpdates
    } = form;
    const nextPayload = {
      ...payload,
      ...payloadUpdates,
      title,
    };
    if (isTechDraft) {
      nextPayload.customFields = splitLines(customFieldsText);
      nextPayload.relatedProjects = splitLines(relatedProjectsText);
      nextPayload.relatedDatasets = splitLines(relatedDatasetsText);
      nextPayload.relatedPapers = splitLines(relatedPapersText);
      nextPayload.relatedTechCards = splitLines(relatedTechCardsText);
    }
    if (isProjectDraft) {
      nextPayload.relatedDatasets = splitLines(relatedDatasetsText);
      nextPayload.relatedPapers = splitLines(relatedPapersText);
      nextPayload.relatedTechCards = splitLines(relatedTechCardsText);
    }
    if (isDatasetDraft) {
      nextPayload.sampleImages = sampleImagesText.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      nextPayload.relatedProjects = splitLines(relatedProjectsText);
      nextPayload.relatedTechValidations = splitLines(relatedTechValidationsText);
    }
    onSave({
      title,
      payload: nextPayload,
    });
  }

  return (
    <form className="edit-form" onSubmit={save}>
      <Field label="草稿标题" value={form.title} onChange={(value) => update("title", value)} required />
      <label className="form-field">
        <span>技术方向</span>
        <select value={form.direction} onChange={(event) => update("direction", event.target.value)}>
          {directionOptions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}
        </select>
      </label>
      {isResearchDraft && (
        <>
          <Field label="验证状态" value={form.status} onChange={(value) => update("status", value)} />
          <Field label="论文链接" value={form.paperUrl} onChange={(value) => update("paperUrl", value)} />
          <Field label="官方 GitHub 仓库" value={form.officialGithub} onChange={(value) => update("officialGithub", value)} />
          <Field label="论文概要" value={form.summary} onChange={(value) => update("summary", value)} multiline />
          <Field label="技术方向关键词" value={form.directionKeywords} onChange={(value) => update("directionKeywords", value)} />
          <Field label="工业价值" value={form.industrialValue} onChange={(value) => update("industrialValue", value)} multiline />
          <Field label="实验现象" value={form.experimentObservation} onChange={(value) => update("experimentObservation", value)} multiline />
          <Field label="失败原因" value={form.failureReason} onChange={(value) => update("failureReason", value)} multiline />
          <Field label="验证结论" value={form.verificationConclusion} onChange={(value) => update("verificationConclusion", value)} multiline />
          <Field label="实验经验" value={form.experimentExperience} onChange={(value) => update("experimentExperience", value)} multiline />
          <Field label="正文摘要" value={form.body} onChange={(value) => update("body", value)} multiline />
        </>
      )}
      {isProjectDraft && (
        <>
          <Field label="项目状态" value={form.status} onChange={(value) => update("status", value)} />
          <Field label="项目阶段" value={form.projectStage} onChange={(value) => update("projectStage", value)} />
          <Field label="验收指标" value={form.acceptanceMetrics} onChange={(value) => update("acceptanceMetrics", value)} multiline />
          <Field label="核心项目需求" value={form.requirements} onChange={(value) => update("requirements", value)} multiline />
          <Field label="规格指标" value={form.metricSpec} onChange={(value) => update("metricSpec", value)} multiline />
          <Field label="关键技术" value={form.keyTech} onChange={(value) => update("keyTech", value)} multiline />
          <Field label="关联数据集" value={form.relatedDatasetsText} onChange={(value) => update("relatedDatasetsText", value)} multiline />
          <Field label="关联论文" value={form.relatedPapersText} onChange={(value) => update("relatedPapersText", value)} multiline />
          <Field label="关联技术卡" value={form.relatedTechCardsText} onChange={(value) => update("relatedTechCardsText", value)} multiline />
          <Field label="方案流程图" value={form.flow} onChange={(value) => update("flow", value)} multiline />
          <Field label="项目经验" value={form.experience} onChange={(value) => update("experience", value)} multiline />
          <Field label="复盘结论" value={form.retrospectiveConclusion} onChange={(value) => update("retrospectiveConclusion", value)} multiline />
          <Field label="文档路径" value={form.docPath} onChange={(value) => update("docPath", value)} />
          <Field label="正文摘要" value={form.body} onChange={(value) => update("body", value)} multiline />
        </>
      )}
      {isDatasetDraft && (
        <>
          <Field label="数据路径" value={form.path} onChange={(value) => update("path", value)} />
          <Field label="数据版本" value={form.dataVersion} onChange={(value) => update("dataVersion", value)} />
          <Field label="标注版本" value={form.annotationVersion} onChange={(value) => update("annotationVersion", value)} />
          <Field label="数据特点" value={form.characteristics} onChange={(value) => update("characteristics", value)} multiline />
          <Field label="适配任务" value={form.taskFit} onChange={(value) => update("taskFit", value)} />
          <Field label="数据处理要点" value={form.processingNotes} onChange={(value) => update("processingNotes", value)} multiline />
          <Field label="处理脚本" value={form.processingScript} onChange={(value) => update("processingScript", value)} />
          <Field label="数据质量" value={form.quality} onChange={(value) => update("quality", value)} />
          <Field label="标注质量" value={form.labelQuality} onChange={(value) => update("labelQuality", value)} />
          <Field label="类别信息" value={form.categories} onChange={(value) => update("categories", value)} />
          <Field label="样例图片路径" value={form.sampleImagesText} onChange={(value) => update("sampleImagesText", value)} multiline />
          <Field label="支撑项目" value={form.relatedProjectsText} onChange={(value) => update("relatedProjectsText", value)} multiline />
          <Field label="支撑技术验证" value={form.relatedTechValidationsText} onChange={(value) => update("relatedTechValidationsText", value)} multiline />
          <Field label="正文摘要" value={form.body} onChange={(value) => update("body", value)} multiline />
        </>
      )}
      {isTechDraft && (
        <>
          <Field label="技术名称" value={form.techName} onChange={(value) => update("techName", value)} />
          <Field label="官方论文链接" value={form.officialPaperLink} onChange={(value) => update("officialPaperLink", value)} />
          <Field label="代码仓库" value={form.codeRepo} onChange={(value) => update("codeRepo", value)} />
          <Field label="技术脉络图" value={form.lineage} onChange={(value) => update("lineage", value)} multiline />
          <Field label="技术原理" value={form.principle} onChange={(value) => update("principle", value)} multiline />
          <Field label="应用效果" value={form.applicationEffect} onChange={(value) => update("applicationEffect", value)} multiline />
          <Field label="优势" value={form.strengths} onChange={(value) => update("strengths", value)} multiline />
          <Field label="不足" value={form.limitations} onChange={(value) => update("limitations", value)} multiline />
          <Field label="项目使用记录" value={form.projectUsage} onChange={(value) => update("projectUsage", value)} multiline />
          <Field label="关联项目" value={form.relatedProjectsText} onChange={(value) => update("relatedProjectsText", value)} multiline />
          <Field label="关联数据集" value={form.relatedDatasetsText} onChange={(value) => update("relatedDatasetsText", value)} multiline />
          <Field label="关联论文" value={form.relatedPapersText} onChange={(value) => update("relatedPapersText", value)} multiline />
          <Field label="关联技术卡" value={form.relatedTechCardsText} onChange={(value) => update("relatedTechCardsText", value)} multiline />
          <Field label="自定义信息栏" value={form.customFieldsText} onChange={(value) => update("customFieldsText", value)} multiline />
          <Field label="正文摘要" value={form.body} onChange={(value) => update("body", value)} multiline />
        </>
      )}
      <KnowledgeBlockEditor blocks={form.blocks} onChange={(blocks) => update("blocks", blocks)} />
      <button className="submit-button" type="submit">保存草稿修改</button>
    </form>
  );
}

function CardActionMenu({ actions }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-action-menu" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="card-menu-trigger" aria-label="卡片管理" onClick={() => setOpen((value) => !value)}>
        ⋯
      </button>
      {open && (
        <div className="card-menu-popover">
          {actions.map(([label, handler, tone]) => (
            <button
              key={label}
              type="button"
              className={tone === "danger" ? "danger-menu-item" : ""}
              onClick={() => {
                setOpen(false);
                handler();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const BLOCK_TYPES = [
  ["text", "文本块"],
  ["image", "图片块"],
  ["table", "表格块"],
  ["mermaid", "Mermaid 图块"],
  ["file", "文件链接块"],
];

function emptyBlock(type = "text") {
  return { type, title: "", content: "", src: "", caption: "", tableText: "", code: "" };
}

function resolveKnowledgeAssetSrc(src) {
  const raw = text(src).trim();
  if (!raw) return "";
  if (raw.startsWith("/knowledge-assets/")) return raw;
  if (raw.startsWith("knowledge-assets/")) return `/${raw}`;
  return raw;
}

function KnowledgeBlockEditor({ blocks, onChange }) {
  const currentBlocks = Array.isArray(blocks) ? blocks : [];

  function updateBlock(index, key, value) {
    const next = [...currentBlocks];
    next[index] = { ...emptyBlock(next[index]?.type), ...next[index], [key]: value };
    onChange(next);
  }

  function addBlock(type = "text") {
    onChange([...currentBlocks, emptyBlock(type)]);
  }

  function removeBlock(index) {
    onChange(currentBlocks.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleImageFiles(files, index = null) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const uploaded = await Promise.all(imageFiles.map(uploadKnowledgeImage));
    if (index == null) {
      onChange([
        ...currentBlocks,
        ...uploaded.map((item) => ({ ...emptyBlock("image"), title: "图片", src: item.src, caption: item.filename })),
      ]);
      return;
    }
    const next = [...currentBlocks];
    const [first, ...rest] = uploaded;
    next[index] = {
      ...emptyBlock("image"),
      ...next[index],
      type: "image",
      title: next[index]?.title || "图片",
      src: first.src,
      caption: next[index]?.caption || first.filename,
    };
    rest.forEach((item) => next.push({ ...emptyBlock("image"), title: "图片", src: item.src, caption: item.filename }));
    onChange(next);
  }

  async function handleEditorPaste(event) {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean)
      .filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    await handleImageFiles(files);
  }

  return (
    <section className="knowledge-block-editor" onPaste={handleEditorPaste}>
      <div className="form-row-title">
        <span>附加内容块</span>
        <div className="asset-upload-row">
          <label className="text-link file-pick-button">
            选择图片
            <input type="file" accept="image/*" multiple onChange={(event) => handleImageFiles(event.target.files)} />
          </label>
          <button type="button" className="text-link" onClick={() => addBlock("image")}>添加内容块</button>
        </div>
      </div>
      {!currentBlocks.length && <p className="block-editor-empty">可粘贴截图，或添加图片、实验表格、Mermaid 流程和文件链接。</p>}
      {currentBlocks.map((block, index) => (
        <div className="knowledge-block-row" key={`block-${index}`}>
          <div className="block-row-head">
            <select value={block.type || "text"} onChange={(event) => updateBlock(index, "type", event.target.value)}>
              {BLOCK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="text-link danger-text" onClick={() => removeBlock(index)}>删除</button>
          </div>
          <input
            value={block.title || ""}
            placeholder="标题，如流程图 / 消融实验 / 样例图"
            onChange={(event) => updateBlock(index, "title", event.target.value)}
          />
          {block.type === "image" && (
            <>
              <label className="image-upload-control">
                <span>上传图片</span>
                <input type="file" accept="image/*" onChange={(event) => handleImageFiles(event.target.files, index)} />
              </label>
              <input value={block.src || ""} placeholder="图片路径或 URL" onChange={(event) => updateBlock(index, "src", event.target.value)} />
              <input value={block.caption || ""} placeholder="图片说明" onChange={(event) => updateBlock(index, "caption", event.target.value)} />
            </>
          )}
          {block.type === "table" && (
            <textarea
              value={block.tableText || ""}
              placeholder={"表格内容：指标|Baseline|Ours\nF1|91.2|94.8"}
              onChange={(event) => updateBlock(index, "tableText", event.target.value)}
            />
          )}
          {block.type === "mermaid" && (
            <textarea
              value={block.code || ""}
              placeholder={"Mermaid 代码：flowchart LR\nA[数据] --> B[训练]"}
              onChange={(event) => updateBlock(index, "code", event.target.value)}
            />
          )}
          {block.type === "file" && (
            <>
              <input value={block.src || ""} placeholder="文档路径或 URL" onChange={(event) => updateBlock(index, "src", event.target.value)} />
              <textarea value={block.content || ""} placeholder="文件说明" onChange={(event) => updateBlock(index, "content", event.target.value)} />
            </>
          )}
          {(!block.type || block.type === "text") && (
            <textarea value={block.content || ""} placeholder="记录补充说明、实验观察或经验" onChange={(event) => updateBlock(index, "content", event.target.value)} />
          )}
        </div>
      ))}
    </section>
  );
}

function KnowledgeBlockRenderer({ blocks, compact = false }) {
  const visibleBlocks = (Array.isArray(blocks) ? blocks : []).filter(hasBlockContent);
  const compactBlocks = visibleBlocks.filter((block) => block.type !== "table");
  const displayBlocks = compact ? compactBlocks.slice(0, 2) : visibleBlocks;
  if (!displayBlocks.length) return null;
  return (
    <div className={`knowledge-blocks ${compact ? "compact-blocks" : ""}`}>
      {displayBlocks.map((block, index) => (
        <KnowledgeBlock key={`${block.type || "text"}-${index}`} block={block} compact={compact} />
      ))}
      {compact && compactBlocks.length > displayBlocks.length && <span className="more-blocks">另有 {compactBlocks.length - displayBlocks.length} 个内容块</span>}
    </div>
  );
}

function KnowledgeBlock({ block, compact }) {
  const title = block.title || block.caption || "附加内容";
  if (block.type === "image") {
    return (
      <figure className="knowledge-block image-block">
        {block.src ? <img className="block-image" src={resolveKnowledgeAssetSrc(block.src)} alt={title} /> : <div className="block-placeholder">未填写图片路径</div>}
        <figcaption>{title}{block.caption ? `：${block.caption}` : ""}</figcaption>
      </figure>
    );
  }
  if (block.type === "table") {
    const rows = parseTableBlock(block.tableText);
    return (
      <section className="knowledge-block table-block">
        <h4>{title}</h4>
        {rows.length ? (
          <table className="block-table">
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => {
                    const Cell = rowIndex === 0 ? "th" : "td";
                    return <Cell key={`cell-${cellIndex}`}>{cell}</Cell>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>未填写表格内容</p>}
      </section>
    );
  }
  if (block.type === "mermaid") {
    return (
      <section className="knowledge-block mermaid-block">
        <h4>{title}</h4>
        <pre>{compact ? text(block.code).slice(0, 120) : block.code || "未填写 Mermaid 代码"}</pre>
      </section>
    );
  }
  if (block.type === "file") {
    return (
      <section className="knowledge-block file-block">
        <h4>{title}</h4>
        {block.src ? <a href={block.src} target="_blank" rel="noreferrer">{block.src}</a> : <p>未填写文件路径</p>}
        {block.content && <p>{block.content}</p>}
      </section>
    );
  }
  return (
    <section className="knowledge-block text-block">
      <h4>{title}</h4>
      <MarkdownBody value={block.content || "未填写内容"} compact={compact} />
    </section>
  );
}

function MarkdownBody({ value, compact = false }) {
  const lines = text(value).split("\n");
  const nodes = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imageMatch) {
      nodes.push(
        <figure className="markdown-image" key={`image-${index}`}>
          <img src={resolveKnowledgeAssetSrc(imageMatch[2])} alt={imageMatch[1] || "知识图片"} />
          {imageMatch[1] && <figcaption>{imageMatch[1]}</figcaption>}
        </figure>,
      );
      index += 1;
      continue;
    }

    if (isMarkdownTableLine(line)) {
      const tableLines = [];
      while (index < lines.length && isMarkdownTableLine(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      if (compact) continue;
      nodes.push(renderMarkdownTable(tableLines, `table-${index}`));
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index].trim();
      if (!nextLine || isMarkdownTableLine(nextLine) || /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.test(nextLine)) break;
      paragraphLines.push(nextLine);
      index += 1;
    }
    nodes.push(<p key={`p-${index}`}>{paragraphLines.join(compact ? " " : "\n")}</p>);
  }
  if (!nodes.length) return <span>未填写</span>;
  return <div className={`markdown-body ${compact ? "compact-markdown" : ""}`}>{nodes}</div>;
}

function isMarkdownTableLine(line) {
  return line.includes("|") && line.replace(/^\|/, "").replace(/\|$/, "").split("|").length > 1;
}

function markdownTableCells(line) {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownSeparatorRow(line) {
  const cells = markdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownTable(lines, key = "markdown-table") {
  const rows = lines.filter((line) => !isMarkdownSeparatorRow(line)).map(markdownTableCells).filter((row) => row.length);
  if (!rows.length) return null;
  return (
    <table className="markdown-table" key={key}>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`markdown-row-${rowIndex}`}>
            {row.map((cell, cellIndex) => {
              const Cell = rowIndex === 0 ? "th" : "td";
              return <Cell key={`markdown-cell-${cellIndex}`}>{cell}</Cell>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function hasBlockContent(block) {
  return Boolean(block && (block.title || block.content || block.src || block.caption || block.tableText || block.code));
}

function parseTableBlock(tableText) {
  return text(tableText)
    .split(/\n+/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.replace(/^\|/, "").replace(/\|$/, "").split(/\s*\|\s*|,|\t/).map((cell) => cell.trim()).filter(Boolean))
    .filter((row) => row.length);
}

function SubTechForm({ directions, initialDirection, initialCard, onSave }) {
  const [form, setForm] = useState({
    direction: initialCard?.direction || initialDirection || directions[0]?.name || "",
    techName: initialCard?.techName || "",
    officialPaperLink: initialCard?.officialPaperLink || "",
    codeRepo: initialCard?.codeRepo || "",
    lineage: initialCard?.lineage || "",
    principle: initialCard?.principle || "",
    applicationEffect: initialCard?.applicationEffect || "",
    strengths: initialCard?.strengths || "",
    limitations: initialCard?.limitations || "",
    projectUsage: initialCard?.projectUsage || "",
    relatedProjectsText: (initialCard?.relatedProjects || []).join("\n"),
    relatedDatasetsText: (initialCard?.relatedDatasets || []).join("\n"),
    relatedPapersText: (initialCard?.relatedPapers || []).join("\n"),
    relatedTechCardsText: (initialCard?.relatedTechCards || []).join("\n"),
    blocks: initialCard?.blocks || [],
  });
  const [customFields, setCustomFields] = useState(() => {
    const fields = initialCard?.customFields || [];
    if (!fields.length) return [{ label: "", value: "" }];
    return fields.map((item) => {
      const [label, ...rest] = text(item).split("：");
      return { label, value: rest.join("：") };
    });
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(parsed) {
    const { customFields: parsedCustomFields = [], ...fields } = parsed;
    setForm((current) => ({ ...current, ...fields }));
    if (parsedCustomFields.length) setCustomFields(parsedCustomFields);
  }

  function save(event) {
    event.preventDefault();
    onSave({
      ...form,
      relatedProjects: splitLines(form.relatedProjectsText),
      relatedDatasets: splitLines(form.relatedDatasetsText),
      relatedPapers: splitLines(form.relatedPapersText),
      relatedTechCards: splitLines(form.relatedTechCardsText),
      customFields: customFields
        .filter((item) => item.label.trim() || item.value.trim())
        .map((item) => `${item.label || "自定义信息"}：${item.value}`),
    });
  }

  return (
    <form className="edit-form" onSubmit={save}>
      <TemplateImportPanel
        label="粘贴技术卡模板"
        placeholder="例如：技术名称、技术方向、官方论文链接、代码仓库、技术原理、应用效果、优势、不足、项目使用记录。未识别字段会进入自定义信息栏。"
        parse={parseSubTechTemplate}
        onApply={applyTemplate}
      />
      <label className="form-field">
        <span>技术方向</span>
        <select value={form.direction} onChange={(event) => update("direction", event.target.value)}>
          {directions.map((direction) => <option key={direction.name} value={direction.name}>{direction.name}</option>)}
        </select>
      </label>
      <Field label="技术名称" value={form.techName} onChange={(value) => update("techName", value)} required />
      <Field label="官方论文链接" value={form.officialPaperLink} onChange={(value) => update("officialPaperLink", value)} />
      <Field label="官方代码仓库" value={form.codeRepo} onChange={(value) => update("codeRepo", value)} />
      <Field label="技术脉络图" value={form.lineage} onChange={(value) => update("lineage", value)} multiline />
      <Field label="技术原理" value={form.principle} onChange={(value) => update("principle", value)} multiline />
      <Field label="应用效果" value={form.applicationEffect} onChange={(value) => update("applicationEffect", value)} multiline />
      <Field label="优势" value={form.strengths} onChange={(value) => update("strengths", value)} multiline />
      <Field label="不足" value={form.limitations} onChange={(value) => update("limitations", value)} multiline />
      <Field label="项目使用记录" value={form.projectUsage} onChange={(value) => update("projectUsage", value)} multiline />
      <Field label="关联项目" value={form.relatedProjectsText} onChange={(value) => update("relatedProjectsText", value)} multiline />
      <Field label="关联数据集" value={form.relatedDatasetsText} onChange={(value) => update("relatedDatasetsText", value)} multiline />
      <Field label="关联论文" value={form.relatedPapersText} onChange={(value) => update("relatedPapersText", value)} multiline />
      <Field label="关联技术卡" value={form.relatedTechCardsText} onChange={(value) => update("relatedTechCardsText", value)} multiline />
      <KnowledgeBlockEditor blocks={form.blocks} onChange={(blocks) => update("blocks", blocks)} />
      <div className="custom-field-editor">
        <div className="form-row-title">
          <span>自定义信息栏</span>
          <button type="button" className="text-link" onClick={() => setCustomFields([...customFields, { label: "", value: "" }])}>
            添加自定义信息栏
          </button>
        </div>
        {customFields.map((item, index) => (
          <div className="custom-field-row" key={`custom-${index}`}>
            <input
              value={item.label}
              placeholder="字段名，如适用缺陷类型"
              onChange={(event) => {
                const next = [...customFields];
                next[index] = { ...next[index], label: event.target.value };
                setCustomFields(next);
              }}
            />
            <input
              value={item.value}
              placeholder="字段内容"
              onChange={(event) => {
                const next = [...customFields];
                next[index] = { ...next[index], value: event.target.value };
                setCustomFields(next);
              }}
            />
          </div>
        ))}
      </div>
      <button className="submit-button" type="submit">{initialCard ? "保存技术卡修改" : "保存新技术"}</button>
    </form>
  );
}

function PaperForm({ directions, initialCard, onSave }) {
  const [form, setForm] = useState({
    title: initialCard?.title || "",
    direction: initialCard?.direction || directions[0]?.name || "",
    status: initialCard?.status || "待读",
    officialGithub: initialCard?.officialGithub || "",
    paperUrl: initialCard?.paperUrl || "",
    summary: initialCard?.summary || "",
    directionKeywords: initialCard?.directionKeywords || "",
    industrialValue: initialCard?.industrialValue || "",
    verificationConclusion: initialCard?.verificationConclusion || "",
    experimentObservation: initialCard?.experimentObservation || "",
    failureReason: initialCard?.failureReason || "",
    experimentExperience: initialCard?.experimentExperience || "",
    blocks: initialCard?.blocks || [],
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(parsed) {
    setForm((current) => ({ ...current, ...parsed }));
  }

  return (
    <form className="edit-form" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <TemplateImportPanel
        label="粘贴 AI 论文简报"
        placeholder="例如：论文标题、原文链接、官方 GitHub、论文概要、技术方向关键词、工业价值、验证状态、验证结论、实验经验。"
        parse={parsePaperTemplate}
        onApply={applyTemplate}
      />
      <Field label="论文标题" value={form.title} onChange={(value) => update("title", value)} required />
      <label className="form-field">
        <span>技术方向</span>
        <select value={form.direction} onChange={(event) => update("direction", event.target.value)}>
          {directions.map((direction) => <option key={direction.name} value={direction.name}>{direction.name}</option>)}
        </select>
      </label>
      <label className="form-field">
        <span>验证状态</span>
        <select value={form.status} onChange={(event) => update("status", event.target.value)}>
          {RESEARCH_STATUS.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      <Field label="官方 GitHub 仓库" value={form.officialGithub} onChange={(value) => update("officialGithub", value)} />
      <Field label="原文链接" value={form.paperUrl} onChange={(value) => update("paperUrl", value)} />
      <Field label="论文概要" value={form.summary} onChange={(value) => update("summary", value)} multiline />
      <Field label="技术方向关键词" value={form.directionKeywords} onChange={(value) => update("directionKeywords", value)} />
      <Field label="对工业场景的技术价值" value={form.industrialValue} onChange={(value) => update("industrialValue", value)} multiline />
      <Field label="实验现象" value={form.experimentObservation} onChange={(value) => update("experimentObservation", value)} multiline />
      <Field label="失败原因" value={form.failureReason} onChange={(value) => update("failureReason", value)} multiline />
      <Field label="验证结论" value={form.verificationConclusion} onChange={(value) => update("verificationConclusion", value)} multiline />
      <Field label="实验经验" value={form.experimentExperience} onChange={(value) => update("experimentExperience", value)} multiline />
      <KnowledgeBlockEditor blocks={form.blocks} onChange={(blocks) => update("blocks", blocks)} />
      <button className="submit-button" type="submit">{initialCard ? "保存论文卡修改" : "保存新论文"}</button>
    </form>
  );
}

function ProjectForm({ directions, initialCard, onSave }) {
  const [form, setForm] = useState({
    title: initialCard?.title || "",
    direction: initialCard?.direction || directions[0]?.name || "",
    status: initialCard?.status || "沉淀中",
    projectStage: initialCard?.projectStage || "",
    acceptanceMetrics: initialCard?.acceptanceMetrics || "",
    requirements: initialCard?.requirements || "",
    metricSpec: initialCard?.metricSpec || "",
    keyTech: initialCard?.keyTech || "",
    relatedDatasetsText: (initialCard?.relatedDatasets || []).join("\n"),
    relatedPapersText: (initialCard?.relatedPapers || []).join("\n"),
    relatedTechCardsText: (initialCard?.relatedTechCards || []).join("\n"),
    flow: initialCard?.flow || "",
    experience: initialCard?.experience || "",
    retrospectiveConclusion: initialCard?.retrospectiveConclusion || "",
    docPath: initialCard?.docPath || "",
    blocks: initialCard?.blocks || [],
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(parsed) {
    setForm((current) => ({ ...current, ...parsed }));
  }

  return (
    <form className="edit-form" onSubmit={(event) => {
      event.preventDefault();
      onSave({
        ...form,
        relatedDatasets: splitLines(form.relatedDatasetsText),
        relatedPapers: splitLines(form.relatedPapersText),
        relatedTechCards: splitLines(form.relatedTechCardsText),
      });
    }}>
      <TemplateImportPanel
        label="粘贴项目复盘"
        placeholder="例如：项目名称、技术方向、项目状态、核心项目需求、规格指标、关键技术、方案流程、项目经验、文档路径。"
        parse={parseProjectTemplate}
        onApply={applyTemplate}
      />
      <Field label="项目名称" value={form.title} onChange={(value) => update("title", value)} required />
      <label className="form-field">
        <span>技术方向</span>
        <select value={form.direction} onChange={(event) => update("direction", event.target.value)}>
          {directions.map((direction) => <option key={direction.name} value={direction.name}>{direction.name}</option>)}
        </select>
      </label>
      <Field label="项目状态" value={form.status} onChange={(value) => update("status", value)} />
      <Field label="项目阶段" value={form.projectStage} onChange={(value) => update("projectStage", value)} />
      <Field label="验收指标" value={form.acceptanceMetrics} onChange={(value) => update("acceptanceMetrics", value)} multiline />
      <Field label="核心项目需求" value={form.requirements} onChange={(value) => update("requirements", value)} multiline />
      <Field label="规格指标" value={form.metricSpec} onChange={(value) => update("metricSpec", value)} multiline />
      <Field label="关键技术" value={form.keyTech} onChange={(value) => update("keyTech", value)} multiline />
      <Field label="关联数据集" value={form.relatedDatasetsText} onChange={(value) => update("relatedDatasetsText", value)} multiline />
      <Field label="关联论文" value={form.relatedPapersText} onChange={(value) => update("relatedPapersText", value)} multiline />
      <Field label="关联技术卡" value={form.relatedTechCardsText} onChange={(value) => update("relatedTechCardsText", value)} multiline />
      <Field label="方案流程图" value={form.flow} onChange={(value) => update("flow", value)} multiline />
      <Field label="项目经验" value={form.experience} onChange={(value) => update("experience", value)} multiline />
      <Field label="复盘结论" value={form.retrospectiveConclusion} onChange={(value) => update("retrospectiveConclusion", value)} multiline />
      <Field label="文档路径" value={form.docPath} onChange={(value) => update("docPath", value)} />
      <KnowledgeBlockEditor blocks={form.blocks} onChange={(blocks) => update("blocks", blocks)} />
      <button className="submit-button" type="submit">{initialCard ? "保存项目卡修改" : "保存新项目"}</button>
    </form>
  );
}

function DatasetForm({ directions, initialCard, onSave }) {
  const [form, setForm] = useState({
    title: initialCard?.title || "",
    direction: initialCard?.direction || directions[0]?.name || "",
    path: initialCard?.path || "",
    dataVersion: initialCard?.dataVersion || "",
    annotationVersion: initialCard?.annotationVersion || "",
    characteristics: initialCard?.characteristics || "",
    taskFit: initialCard?.taskFit || "",
    processingNotes: initialCard?.processingNotes || "",
    processingScript: initialCard?.processingScript || "",
    quality: initialCard?.quality || "",
    labelQuality: initialCard?.labelQuality || "",
    categories: initialCard?.categories || "",
    sampleImagesText: (initialCard?.sampleImages || []).join("\n"),
    relatedProjectsText: (initialCard?.relatedProjects || []).join("\n"),
    relatedTechValidationsText: (initialCard?.relatedTechValidations || []).join("\n"),
    blocks: initialCard?.blocks || [],
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(parsed) {
    setForm((current) => ({ ...current, ...parsed }));
  }

  function save(event) {
    event.preventDefault();
    onSave({
      ...form,
      sampleImages: form.sampleImagesText.split(/\n+/).map((item) => item.trim()).filter(Boolean),
      relatedProjects: splitLines(form.relatedProjectsText),
      relatedTechValidations: splitLines(form.relatedTechValidationsText),
    });
  }

  return (
    <form className="edit-form" onSubmit={save}>
      <TemplateImportPanel
        label="粘贴数据说明"
        placeholder="例如：数据名称、技术方向、数据路径、数据特点、适配任务、处理要点、数据质量、标注质量、类别信息、样例图片路径。"
        parse={parseDatasetTemplate}
        onApply={applyTemplate}
      />
      <Field label="数据名称" value={form.title} onChange={(value) => update("title", value)} required />
      <label className="form-field">
        <span>技术方向</span>
        <select value={form.direction} onChange={(event) => update("direction", event.target.value)}>
          {directions.map((direction) => <option key={direction.name} value={direction.name}>{direction.name}</option>)}
        </select>
      </label>
      <Field label="数据路径" value={form.path} onChange={(value) => update("path", value)} />
      <Field label="数据版本" value={form.dataVersion} onChange={(value) => update("dataVersion", value)} />
      <Field label="标注版本" value={form.annotationVersion} onChange={(value) => update("annotationVersion", value)} />
      <Field label="数据特点" value={form.characteristics} onChange={(value) => update("characteristics", value)} multiline />
      <Field label="适配任务" value={form.taskFit} onChange={(value) => update("taskFit", value)} />
      <Field label="数据处理要点" value={form.processingNotes} onChange={(value) => update("processingNotes", value)} multiline />
      <Field label="处理脚本" value={form.processingScript} onChange={(value) => update("processingScript", value)} />
      <Field label="数据质量" value={form.quality} onChange={(value) => update("quality", value)} />
      <Field label="标注质量" value={form.labelQuality} onChange={(value) => update("labelQuality", value)} />
      <Field label="类别信息" value={form.categories} onChange={(value) => update("categories", value)} />
      <Field label="样例图片路径" value={form.sampleImagesText} onChange={(value) => update("sampleImagesText", value)} multiline />
      <Field label="支撑项目" value={form.relatedProjectsText} onChange={(value) => update("relatedProjectsText", value)} multiline />
      <Field label="支撑技术验证" value={form.relatedTechValidationsText} onChange={(value) => update("relatedTechValidationsText", value)} multiline />
      <KnowledgeBlockEditor blocks={form.blocks} onChange={(blocks) => update("blocks", blocks)} />
      <button className="submit-button" type="submit">{initialCard ? "保存数据卡修改" : "保存新数据"}</button>
    </form>
  );
}

function TemplateImportPanel({ label, placeholder, parse, onApply }) {
  const [mode, setMode] = useState("manual");
  const [raw, setRaw] = useState("");

  function applyParsed() {
    onApply(parse(raw));
    setMode("manual");
  }

  return (
    <section className="template-import-panel">
      <div className="template-mode-switch">
        <button type="button" className={mode === "template" ? "active" : ""} onClick={() => setMode("template")}>
          模板导入
        </button>
        <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>
          手动填写
        </button>
      </div>
      {mode === "template" && (
        <div className="template-import-body">
          <label className="form-field">
            <span>{label}</span>
            <textarea value={raw} placeholder={placeholder} onChange={(event) => setRaw(event.target.value)} />
          </label>
          <button className="secondary-button" type="button" onClick={applyParsed}>解析并填入</button>
        </div>
      )}
    </section>
  );
}

function MarkdownField({ value, onChange, required = false }) {
  const textareaRef = useRef(null);

  async function insertImages(files) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const uploaded = await Promise.all(imageFiles.map((file) => uploadKnowledgeImage(file)));
    const insertion = uploaded.map(markdownImageText).join("\n\n");
    const target = textareaRef.current;
    const start = target?.selectionStart ?? text(value).length;
    const end = target?.selectionEnd ?? start;
    const next = insertMarkdownAtCursor(value, insertion, start, end);
    onChange(next.value);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    }, 0);
  }

  async function handleMarkdownPaste(event) {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean)
      .filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    await insertImages(files);
  }

  return (
    <div className="markdown-field">
      <textarea
        ref={textareaRef}
        value={value}
        required={required}
        onPaste={handleMarkdownPaste}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="markdown-field-toolbar">
        <label className="markdown-field-button">
          插入图片
          <input type="file" accept="image/*" multiple onChange={(event) => insertImages(event.target.files)} />
        </label>
        <span>支持 Markdown 图片和表格</span>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, multiline = false, required = false }) {
  return (
    <div className="form-field">
      <span>{label}</span>
      {multiline ? (
        <MarkdownField value={value} required={required} onChange={onChange} />
      ) : (
        <input value={value} required={required} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

function imageLikeSrc(value) {
  const raw = text(value).trim();
  if (!raw) return "";
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(raw) || raw.startsWith("knowledge-assets/") || raw.startsWith("/knowledge-assets/")
    ? raw
    : "";
}

function extractMarkdownImageSrcs(value) {
  const matches = [];
  const pattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match = pattern.exec(text(value));
  while (match) {
    matches.push(match[1]);
    match = pattern.exec(text(value));
  }
  return matches;
}

function imageSrcsFromValue(value) {
  if (Array.isArray(value)) return value.flatMap(imageSrcsFromValue);
  const raw = text(value);
  const direct = imageLikeSrc(raw);
  return [direct, ...extractMarkdownImageSrcs(raw)].filter(Boolean);
}

function DetailDrawer({ detail, onClose }) {
  if (!detail) return null;
  return (
    <div className="drawer-layer" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="drawer-type">{detail.type}</span>
            <h2>{detail.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭详情">×</button>
        </div>
        <div className="drawer-content">
          <div className="drawer-detail-body">
            <div className="detail-list">
              {detail.fields.map(([label, value]) => (
                <div className="detail-row" key={label}>
                  <dt>{label}</dt>
                  <dd>{renderValue(value)}</dd>
                </div>
              ))}
            </div>
            <KnowledgeBlockRenderer blocks={detail.blocks} />
          </div>
        </div>
      </aside>
    </div>
  );
}

function renderValue(value) {
  if (Array.isArray(value)) {
    if (!value.length) return "未填写";
    return (
      <ul className="value-list">
        {value.map((item) => <li key={item}><MarkdownBody value={item} compact /></li>)}
      </ul>
    );
  }
  return isUrl(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <MarkdownBody value={value} />;
}

function draftFromTypedForm(draftType, value) {
  if (draftType === "research_paper") return draftFromResearchForm(value);
  if (draftType === "project_case") return draftFromProjectForm(value);
  if (draftType === "dataset_card") return draftFromDatasetForm(value);
  return draftFromSubTechForm(value);
}

function draftFromResearchForm(value) {
  const title = value.title || "未命名论文草稿";
  return {
    draftType: "research_paper",
    title,
    payload: {
      ...value,
      title,
      body: [
        value.summary && `论文概要：${value.summary}`,
        value.industrialValue && `工业价值：${value.industrialValue}`,
        value.verificationConclusion && `验证结论：${value.verificationConclusion}`,
        value.experimentExperience && `实验经验：${value.experimentExperience}`,
      ].filter(Boolean).join("\n\n"),
    },
  };
}

function draftFromProjectForm(value) {
  const title = value.title || "未命名项目草稿";
  return {
    draftType: "project_case",
    title,
    payload: {
      ...value,
      title,
      body: [
        value.requirements && `核心项目需求：${value.requirements}`,
        value.metricSpec && `规格指标：${value.metricSpec}`,
        value.keyTech && `关键技术：${value.keyTech}`,
        value.experience && `项目经验：${value.experience}`,
        value.retrospectiveConclusion && `复盘结论：${value.retrospectiveConclusion}`,
      ].filter(Boolean).join("\n\n"),
    },
  };
}

function draftFromDatasetForm(value) {
  const title = value.title || "未命名数据草稿";
  return {
    draftType: "dataset_card",
    title,
    payload: {
      ...value,
      title,
      body: [
        value.path && `数据路径：${value.path}`,
        value.characteristics && `数据特点：${value.characteristics}`,
        value.taskFit && `适配任务：${value.taskFit}`,
        value.processingNotes && `数据处理要点：${value.processingNotes}`,
      ].filter(Boolean).join("\n\n"),
    },
  };
}

function draftFromSubTechForm(value) {
  const title = value.techName || "未命名技术草稿";
  return {
    draftType: "tech_card",
    title,
    payload: {
      ...value,
      title,
      body: [
        value.principle && `技术原理：${value.principle}`,
        value.applicationEffect && `应用效果：${value.applicationEffect}`,
        value.strengths && `优势：${value.strengths}`,
        value.limitations && `不足：${value.limitations}`,
        value.projectUsage && `项目使用记录：${value.projectUsage}`,
        value.relatedProjects?.length && `关联项目：${value.relatedProjects.join("、")}`,
        value.relatedDatasets?.length && `关联数据集：${value.relatedDatasets.join("、")}`,
        value.relatedPapers?.length && `关联论文：${value.relatedPapers.join("、")}`,
        value.relatedTechCards?.length && `关联技术卡：${value.relatedTechCards.join("、")}`,
      ].filter(Boolean).join("\n\n"),
    },
  };
}

function subTechSeedFromResearch(item) {
  return {
    direction: item.direction,
    techName: item.title,
    officialPaperLink: item.paperUrl,
    codeRepo: item.officialGithub,
    principle: item.summary,
    applicationEffect: item.verificationConclusion || item.industrialValue,
    strengths: item.industrialValue,
    limitations: item.failureReason,
    projectUsage: item.experimentExperience,
    customFields: [
      item.directionKeywords && `技术方向关键词：${item.directionKeywords}`,
      item.experimentObservation && `实验现象：${item.experimentObservation}`,
    ].filter(Boolean),
    blocks: item.blocks || [],
  };
}

function detailFromSubTech(item) {
  return {
    title: item.techName,
    type: "子技术卡",
    fields: [
      ["技术方向", item.direction],
      ["技术名称", item.techName],
      ["官方论文链接", item.officialPaperLink],
      ["代码仓库", item.codeRepo],
      ["技术脉络图", item.lineage],
      ["技术原理", item.principle],
      ["应用效果", item.applicationEffect],
      ["优势", item.strengths],
      ["不足", item.limitations],
      ["项目使用记录", item.projectUsage],
      ["关联项目", item.relatedProjects],
      ["关联数据集", item.relatedDatasets],
      ["关联论文", item.relatedPapers],
      ["关联技术卡", item.relatedTechCards],
      ["自定义信息栏", item.customFields],
    ],
    blocks: item.blocks || [],
  };
}

function draftDetailFields(item, payload) {
  const commonFields = [
    ["生命周期", draftStatusLabel(item.status)],
    ["技术方向", payload.direction],
  ];

  if (item.draft_type === "research_paper") {
    return [
      ...commonFields,
      ["验证状态", payload.status],
      ["论文链接", payload.paperUrl],
      ["官方 GitHub 仓库", payload.officialGithub],
      ["论文概要", payload.summary],
      ["技术方向关键词", payload.directionKeywords],
      ["工业价值", payload.industrialValue],
      ["实验现象", payload.experimentObservation],
      ["失败原因", payload.failureReason],
      ["验证结论", payload.verificationConclusion],
      ["实验经验", payload.experimentExperience],
      ["正文摘要", payload.body],
    ];
  }

  if (item.draft_type === "project_case") {
    return [
      ...commonFields,
      ["项目状态", payload.status],
      ["项目阶段", payload.projectStage],
      ["验收指标", payload.acceptanceMetrics],
      ["核心项目需求", payload.requirements],
      ["规格指标", payload.metricSpec],
      ["关键技术", payload.keyTech],
      ["关联数据集", payload.relatedDatasets],
      ["关联论文", payload.relatedPapers],
      ["关联技术卡", payload.relatedTechCards],
      ["方案流程图", payload.flow],
      ["项目经验", payload.experience],
      ["复盘结论", payload.retrospectiveConclusion],
      ["文档路径", payload.docPath],
      ["正文摘要", payload.body],
    ];
  }

  if (item.draft_type === "dataset_card") {
    return [
      ...commonFields,
      ["数据路径", payload.path],
      ["数据版本", payload.dataVersion],
      ["标注版本", payload.annotationVersion],
      ["数据特点", payload.characteristics],
      ["适配任务", payload.taskFit],
      ["数据处理要点", payload.processingNotes],
      ["处理脚本", payload.processingScript],
      ["数据质量", payload.quality],
      ["标注质量", payload.labelQuality],
      ["类别信息", payload.categories],
      ["样例图片路径", payload.sampleImages],
      ["支撑项目", payload.relatedProjects],
      ["支撑技术验证", payload.relatedTechValidations],
      ["正文摘要", payload.body],
    ];
  }

  return [
    ...commonFields,
    ["技术名称", payload.techName || item.title],
    ["官方论文链接", payload.officialPaperLink],
    ["代码仓库", payload.codeRepo],
    ["技术脉络图", payload.lineage],
    ["技术原理", payload.principle],
    ["应用效果", payload.applicationEffect],
    ["优势", payload.strengths],
    ["不足", payload.limitations],
    ["项目使用记录", payload.projectUsage],
    ["关联项目", payload.relatedProjects],
    ["关联数据集", payload.relatedDatasets],
    ["关联论文", payload.relatedPapers],
    ["关联技术卡", payload.relatedTechCards],
    ["自定义信息栏", payload.customFields],
    ["正文摘要", payload.body],
  ];
}

function detailFromDraft(item) {
  const payload = draftPayload(item);
  return {
    title: draftTitle(item),
    type: draftTypeLabel(item.draft_type),
    fields: draftDetailFields(item, payload),
    blocks: payload.blocks || [],
  };
}

function detailFromPublishedDraft(item, result) {
  const detail = detailFromDraft(item);
  return {
    ...detail,
    type: "已收录内容",
    fields: [
      ["收录模块", publishModuleLabel(result.target_module)],
      ["正式卡类型", result.target_entity_type],
      ["正式卡ID", result.published_entity_id || result.document_id],
      ["Markdown文档", result.document_path],
      ["Git提交", result.git_commit || "待系统维护提交"],
      ...detail.fields,
    ],
  };
}

function publishModuleLabel(module) {
  return {
    research: "前沿研究",
    project: "项目应用",
    dataset: "数据积累",
    technology: "技术积累",
  }[module] || module || "未记录";
}

function detailFromResearch(item) {
  return {
    title: item.title,
    type: "研究卡",
    fields: [
      ["验证状态", item.status],
      ["官方 GitHub 仓库", item.officialGithub],
      ["原文链接", item.paperUrl],
      ["论文概要", item.summary],
      ["技术方向关键词", item.directionKeywords],
      ["对工业场景的技术价值", item.industrialValue],
      ["实验现象", item.experimentObservation],
      ["失败原因", item.failureReason],
      ["验证结论", item.verificationConclusion],
      ["实验经验", item.experimentExperience],
    ],
    blocks: item.blocks || [],
  };
}

function detailFromProject(item) {
  return {
    title: item.title,
    type: "项目卡",
    fields: [
      ["技术方向", item.direction],
      ["项目阶段", item.projectStage],
      ["验收指标", item.acceptanceMetrics],
      ["核心项目需求", item.requirements],
      ["规格指标", item.metricSpec],
      ["关键技术", item.keyTech],
      ["关联数据集", item.relatedDatasets],
      ["关联论文", item.relatedPapers],
      ["关联技术卡", item.relatedTechCards],
      ["方案流程图", item.flow],
      ["项目经验", item.experience],
      ["复盘结论", item.retrospectiveConclusion],
      ["文档", item.docPath],
    ],
    blocks: item.blocks || [],
  };
}

function detailFromDataset(item) {
  return {
    title: item.title,
    type: "数据卡",
    fields: [
      ["技术方向", item.direction],
      ["数据路径", item.path],
      ["数据版本", item.dataVersion],
      ["标注版本", item.annotationVersion],
      ["路径状态", item.pathStatus],
      ["数据特点", item.characteristics],
      ["适配任务", item.taskFit],
      ["数据处理要点", item.processingNotes],
      ["处理脚本", item.processingScript],
      ["数据质量", item.quality],
      ["标注质量", item.labelQuality],
      ["类别信息", item.categories],
      ["样例图片路径", item.sampleImages],
      ["支撑项目", item.relatedProjects],
      ["支撑技术验证", item.relatedTechValidations],
    ],
    blocks: item.blocks || [],
  };
}

function detailFromAny(item) {
  if (item.officialGithub !== undefined) return detailFromResearch(item);
  if (item.requirements !== undefined) return detailFromProject(item);
  if (item.path !== undefined) return detailFromDataset(item);
  return detailFromSubTech(item);
}

export default App;
