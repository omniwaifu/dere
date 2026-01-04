export type ComparisonOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "greater_than_equal"
  | "less_than_equal"
  | "is_null"
  | "is_not_null";

export type DateFilter = {
  operator: ComparisonOperator;
  value?: Date | null;
};

export type SearchFilters = {
  valid_at?: DateFilter | null;
  invalid_at?: DateFilter | null;
  created_at?: DateFilter | null;
  expired_at?: DateFilter | null;
  node_labels?: string[] | null;
  edge_types?: string[] | null;
  node_attributes?: Record<string, string | number | boolean> | null;
  edge_attributes?: Record<string, string | number | boolean> | null;
};

function dateFilterCondition(
  filter: DateFilter,
  fieldName: string,
  paramName: string,
): { condition: string; params: Record<string, unknown> } {
  if (filter.operator === "is_null") {
    return { condition: `${fieldName} IS NULL`, params: {} };
  }
  if (filter.operator === "is_not_null") {
    return { condition: `${fieldName} IS NOT NULL`, params: {} };
  }

  const value = filter.value;
  if (!value) {
    throw new Error(`Value required for operator ${filter.operator}`);
  }

  const iso = value.toISOString();
  const operatorMap: Record<ComparisonOperator, string> = {
    equals: "=",
    not_equals: "<>",
    greater_than: ">",
    less_than: "<",
    greater_than_equal: ">=",
    less_than_equal: "<=",
    is_null: "IS NULL",
    is_not_null: "IS NOT NULL",
  };

  return {
    condition: `${fieldName} ${operatorMap[filter.operator]} $${paramName}`,
    params: { [paramName]: iso },
  };
}

export function buildTemporalQueryClause(
  filters: SearchFilters | null | undefined,
  nodeAlias: string = "n",
  edgeAlias: string | null = "r",
): { clause: string; params: Record<string, unknown> } {
  if (!filters) {
    return { clause: "", params: {} };
  }

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (edgeAlias) {
    if (filters.valid_at) {
      const { condition, params: p } = dateFilterCondition(
        filters.valid_at,
        `${edgeAlias}.valid_at`,
        "filter_valid_at",
      );
      conditions.push(condition);
      Object.assign(params, p);
    }
    if (filters.invalid_at) {
      const { condition, params: p } = dateFilterCondition(
        filters.invalid_at,
        `${edgeAlias}.invalid_at`,
        "filter_invalid_at",
      );
      conditions.push(condition);
      Object.assign(params, p);
    }
  }

  if (filters.created_at) {
    const { condition, params: p } = dateFilterCondition(
      filters.created_at,
      `${nodeAlias}.created_at`,
      "filter_created_at",
    );
    conditions.push(condition);
    Object.assign(params, p);
  }

  if (filters.expired_at) {
    const { condition, params: p } = dateFilterCondition(
      filters.expired_at,
      `${nodeAlias}.expired_at`,
      "filter_expired_at",
    );
    conditions.push(condition);
    Object.assign(params, p);
  }

  if (filters.node_labels && filters.node_labels.length > 0) {
    const labelConditions = filters.node_labels.map(
      (label) => `'${label}' IN labels(${nodeAlias})`,
    );
    conditions.push(`(${labelConditions.join(" OR ")})`);
  }

  if (filters.edge_types && filters.edge_types.length > 0 && edgeAlias) {
    conditions.push(`${edgeAlias}.name IN $filter_edge_types`);
    params.filter_edge_types = filters.edge_types;
  }

  if (filters.node_attributes) {
    for (const [key, value] of Object.entries(filters.node_attributes)) {
      const paramName = `node_attr_${key}`;
      conditions.push(`${nodeAlias}.${key} = $${paramName}`);
      params[paramName] = value;
    }
  }

  if (filters.edge_attributes && edgeAlias) {
    for (const [key, value] of Object.entries(filters.edge_attributes)) {
      const paramName = `edge_attr_${key}`;
      conditions.push(`${edgeAlias}.${key} = $${paramName}`);
      params[paramName] = value;
    }
  }

  if (conditions.length === 0) {
    return { clause: "", params: {} };
  }

  return { clause: `WHERE ${conditions.join(" AND ")}`, params };
}
