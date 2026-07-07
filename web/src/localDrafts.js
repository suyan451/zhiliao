import { useEffect, useState } from "react";

export const STORAGE_KEY = "industrial-kb-custom-assets:v1";

const EMPTY_DRAFTS = {
  directions: [],
  subTechCards: [],
  researchCards: [],
  projectCards: [],
  datasetCards: [],
  subTechEdits: {},
  researchEdits: {},
  projectEdits: {},
  datasetEdits: {},
  hiddenDirectionNames: [],
  deletedSubTechIds: [],
  deletedResearchIds: [],
  deletedProjectIds: [],
  deletedDatasetIds: [],
};

function readDrafts() {
  if (typeof window === "undefined") return EMPTY_DRAFTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFTS;
    const parsed = JSON.parse(raw);
    return {
      directions: Array.isArray(parsed.directions) ? parsed.directions : [],
      subTechCards: Array.isArray(parsed.subTechCards) ? parsed.subTechCards : [],
      researchCards: Array.isArray(parsed.researchCards) ? parsed.researchCards : [],
      projectCards: Array.isArray(parsed.projectCards) ? parsed.projectCards : [],
      datasetCards: Array.isArray(parsed.datasetCards) ? parsed.datasetCards : [],
      subTechEdits: parsed.subTechEdits && typeof parsed.subTechEdits === "object" ? parsed.subTechEdits : {},
      researchEdits: parsed.researchEdits && typeof parsed.researchEdits === "object" ? parsed.researchEdits : {},
      projectEdits: parsed.projectEdits && typeof parsed.projectEdits === "object" ? parsed.projectEdits : {},
      datasetEdits: parsed.datasetEdits && typeof parsed.datasetEdits === "object" ? parsed.datasetEdits : {},
      hiddenDirectionNames: Array.isArray(parsed.hiddenDirectionNames) ? parsed.hiddenDirectionNames : [],
      deletedSubTechIds: Array.isArray(parsed.deletedSubTechIds) ? parsed.deletedSubTechIds : [],
      deletedResearchIds: Array.isArray(parsed.deletedResearchIds) ? parsed.deletedResearchIds : [],
      deletedProjectIds: Array.isArray(parsed.deletedProjectIds) ? parsed.deletedProjectIds : [],
      deletedDatasetIds: Array.isArray(parsed.deletedDatasetIds) ? parsed.deletedDatasetIds : [],
    };
  } catch {
    return EMPTY_DRAFTS;
  }
}

function writeDrafts(drafts) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

async function saveApiAsset(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Save failed: ${response.status}`);
  }
  return response.json();
}

function persist(path, payload) {
  saveApiAsset(path, payload).catch((error) => {
    console.warn("保存到本地数据库失败，已保留浏览器草稿。", error);
  });
}

async function deleteApiAsset(path) {
  const response = await fetch(path, { method: "DELETE" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Delete failed: ${response.status}`);
  }
  return response.json();
}

function persistDelete(path) {
  deleteApiAsset(path).catch((error) => {
    console.warn("从本地数据库删除失败，已保留浏览器删除标记。", error);
  });
}

export function useLocalDrafts() {
  const [drafts, setDrafts] = useState(readDrafts);

  useEffect(() => {
    writeDrafts(drafts);
  }, [drafts]);

  function addDirection(direction) {
    const name = String(direction.name || "").trim();
    const item = {
      id: `direction-${Date.now()}`,
      name,
      summary: direction.summary || "",
    };
    setDrafts((current) => {
      const hiddenDirectionNames = current.hiddenDirectionNames.filter((item) => item !== name);
      const exists = current.directions.some((item) => item.name === name);
      if (exists || !name) return { ...current, hiddenDirectionNames };
      return {
        ...current,
        hiddenDirectionNames,
        directions: [...current.directions, item],
      };
    });
    if (item.name) persist("/api/directions", item);
  }

  function hideDirection(name) {
    setDrafts((current) => ({
      ...current,
      hiddenDirectionNames: Array.from(new Set([...current.hiddenDirectionNames, name])),
    }));
  }

  function restoreDirection(name) {
    setDrafts((current) => ({
      ...current,
      hiddenDirectionNames: current.hiddenDirectionNames.filter((item) => item !== name),
    }));
  }

  function addSubTechCard(card) {
    const item = {
      ...card,
      id: `subtech-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setDrafts((current) => ({
      ...current,
      subTechCards: [...current.subTechCards, item],
    }));
    persist("/api/subtech", item);
  }

  function updateSubTechCard(id, updates) {
    setDrafts((current) => {
      const subTechCards = current.subTechCards.map((item) => (
        item.id === id ? { ...item, ...updates } : item
      ));
      const draftExists = subTechCards.some((item) => item.id === id);
      return {
        ...current,
        subTechCards,
        subTechEdits: draftExists
          ? current.subTechEdits
          : { ...current.subTechEdits, [id]: { ...current.subTechEdits[id], ...updates } },
      };
    });
    persist("/api/subtech", { id, ...updates });
  }

  function deleteSubTechCard(id) {
    setDrafts((current) => ({
      ...current,
      subTechCards: current.subTechCards.filter((item) => item.id !== id),
      deletedSubTechIds: Array.from(new Set([...current.deletedSubTechIds, id])),
    }));
  }

  function addResearchCard(card) {
    const item = {
      ...card,
      id: `research-${Date.now()}`,
      source: "draft",
      createdAt: new Date().toISOString(),
    };
    setDrafts((current) => ({
      ...current,
      researchCards: [...current.researchCards, item],
    }));
    persist("/api/research", item);
  }

  function updateResearchCard(id, updates) {
    setDrafts((current) => {
      const researchCards = current.researchCards.map((item) => (
        item.id === id ? { ...item, ...updates } : item
      ));
      const draftExists = researchCards.some((item) => item.id === id);
      return {
        ...current,
        researchCards,
        researchEdits: draftExists
          ? current.researchEdits
          : { ...current.researchEdits, [id]: { ...current.researchEdits[id], ...updates } },
      };
    });
    persist("/api/research", { id, ...updates });
  }

  function deleteResearchCard(id) {
    setDrafts((current) => ({
      ...current,
      researchCards: current.researchCards.filter((item) => item.id !== id),
      deletedResearchIds: Array.from(new Set([...current.deletedResearchIds, id])),
    }));
  }

  function addProjectCard(card) {
    const item = {
      ...card,
      id: `project-${Date.now()}`,
      source: "draft",
      createdAt: new Date().toISOString(),
    };
    setDrafts((current) => ({
      ...current,
      projectCards: [...current.projectCards, item],
    }));
    persist("/api/projects", item);
  }

  function updateProjectCard(id, updates) {
    setDrafts((current) => {
      const projectCards = current.projectCards.map((item) => (
        item.id === id ? { ...item, ...updates } : item
      ));
      const draftExists = projectCards.some((item) => item.id === id);
      return {
        ...current,
        projectCards,
        projectEdits: draftExists
          ? current.projectEdits
          : { ...current.projectEdits, [id]: { ...current.projectEdits[id], ...updates } },
      };
    });
    persist("/api/projects", { id, ...updates });
  }

  function deleteProjectCard(id) {
    setDrafts((current) => ({
      ...current,
      projectCards: current.projectCards.filter((item) => item.id !== id),
      deletedProjectIds: Array.from(new Set([...current.deletedProjectIds, id])),
    }));
  }

  function addDatasetCard(card) {
    const item = {
      ...card,
      id: `dataset-${Date.now()}`,
      source: "draft",
      createdAt: new Date().toISOString(),
    };
    setDrafts((current) => ({
      ...current,
      datasetCards: [...current.datasetCards, item],
    }));
    persist("/api/datasets", item);
  }

  function updateDatasetCard(id, updates) {
    setDrafts((current) => {
      const datasetCards = current.datasetCards.map((item) => (
        item.id === id ? { ...item, ...updates } : item
      ));
      const draftExists = datasetCards.some((item) => item.id === id);
      return {
        ...current,
        datasetCards,
        datasetEdits: draftExists
          ? current.datasetEdits
          : { ...current.datasetEdits, [id]: { ...current.datasetEdits[id], ...updates } },
      };
    });
    persist("/api/datasets", { id, ...updates });
  }

  function deleteDatasetCard(id) {
    setDrafts((current) => ({
      ...current,
      datasetCards: current.datasetCards.filter((item) => item.id !== id),
      deletedDatasetIds: Array.from(new Set([...current.deletedDatasetIds, id])),
    }));
    persistDelete(`/api/datasets/${encodeURIComponent(id)}`);
  }

  return {
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
  };
}
