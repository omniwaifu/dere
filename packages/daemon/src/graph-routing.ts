import type { SearchFilters } from "./graph-filters.js";

type DomainRoute = {
  name: string;
  keywords: string[];
  node_labels?: string[];
  edge_types?: string[];
};

export const DEFAULT_DOMAIN_ROUTES: DomainRoute[] = [
  {
    name: "code",
    keywords: [
      "bug",
      "error",
      "stacktrace",
      "traceback",
      "function",
      "method",
      "class",
      "module",
      "package",
      "file",
      "repo",
      "repository",
      "commit",
      "branch",
      "pr",
      "issue",
      "test",
      "build",
      "deploy",
    ],
    node_labels: [
      "Repo",
      "File",
      "Symbol",
      "Function",
      "Class",
      "Method",
      "Module",
      "Package",
      "Commit",
      "Issue",
      "PullRequest",
      "Branch",
      "Test",
    ],
  },
  {
    name: "people",
    keywords: [
      "who",
      "person",
      "people",
      "team",
      "user",
      "feel",
      "feeling",
      "prefer",
      "preference",
      "likes",
      "dislikes",
      "relationship",
    ],
    node_labels: ["Person", "User", "Team", "Organization", "Preference"],
  },
  {
    name: "work",
    keywords: [
      "project",
      "task",
      "todo",
      "deadline",
      "milestone",
      "plan",
      "goal",
      "roadmap",
      "deliverable",
      "status",
    ],
    node_labels: ["Project", "Task", "Milestone", "Goal"],
  },
  {
    name: "docs",
    keywords: ["doc", "docs", "document", "spec", "design", "readme"],
    node_labels: ["Doc", "Document", "Spec", "Note"],
  },
];

function scoreRoute(query: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => (query.includes(keyword) ? score + 1 : score), 0);
}

export function selectDomainFilters(
  query: string,
  routes: DomainRoute[] = DEFAULT_DOMAIN_ROUTES,
  maxRoutes = 2,
): SearchFilters[] {
  if (!query.trim() || maxRoutes <= 0) {
    return [];
  }

  const queryLower = query.toLowerCase();
  const scored = routes
    .map((route) => ({
      route,
      score: scoreRoute(queryLower, route.keywords),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRoutes);

  return scored.map((entry) => ({
    node_labels: entry.route.node_labels ?? null,
    edge_types: entry.route.edge_types ?? null,
  }));
}

export function mergeFilters(
  base: SearchFilters | null | undefined,
  extra: SearchFilters | null | undefined,
): SearchFilters | null {
  if (!base) {
    return extra ?? null;
  }
  if (!extra) {
    return base;
  }

  const merged: SearchFilters = { ...base };

  if (extra.node_labels && extra.node_labels.length > 0) {
    merged.node_labels = Array.from(new Set([...(merged.node_labels ?? []), ...extra.node_labels]));
  }
  if (extra.edge_types && extra.edge_types.length > 0) {
    merged.edge_types = Array.from(new Set([...(merged.edge_types ?? []), ...extra.edge_types]));
  }

  return merged;
}
