// Swarm dependency detection and condition evaluation

import type { AgentSpec, SwarmAgentRow } from "./types.js";

export function detectDependencyCycle(agents: AgentSpec[]): string[] | null {
  const agentNames = new Set(agents.map((agent) => agent.name));
  const adjacency = new Map<string, string[]>();

  for (const agent of agents) {
    const deps = (agent.depends_on ?? [])
      .map((dep) => dep.agent)
      .filter((dep) => agentNames.has(dep));
    adjacency.set(agent.name, deps);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): string[] | null => {
    visiting.add(node);
    path.push(node);
    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (visiting.has(neighbor)) {
        const idx = path.indexOf(neighbor);
        return path.slice(idx).concat([neighbor]);
      }
      if (!visited.has(neighbor)) {
        const result = dfs(neighbor);
        if (result) {
          return result;
        }
      }
    }
    visiting.delete(node);
    visited.add(node);
    path.pop();
    return null;
  };

  for (const agent of agents) {
    if (!visited.has(agent.name)) {
      const result = dfs(agent.name);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

/**
 * Safe expression evaluator for condition strings.
 * Supports: property access, comparisons, len(), boolean/string/number literals, logical operators.
 * Does NOT use new Function() to prevent arbitrary code execution.
 */
export function evaluateCondition(
  condition: string,
  outputText: string | null,
): { result: boolean; error: string | null } {
  if (!outputText) {
    return { result: false, error: "Dependency has no output" };
  }

  let parsed: unknown = null;
  try {
    let jsonText = outputText;
    const jsonBlock = outputText.match(/```json\s*([\s\S]*?)```/i);
    if (jsonBlock?.[1]) {
      jsonText = jsonBlock[1].trim();
    } else {
      const codeBlock = outputText.match(/```\s*([\s\S]*?)```/);
      if (codeBlock?.[1]) {
        jsonText = codeBlock[1].trim();
      }
    }
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = { text: outputText, raw: outputText };
  }

  const context: Record<string, unknown> = {
    output: parsed && typeof parsed === "object" ? parsed : { text: outputText },
  };

  try {
    const result = evaluateExpression(condition.trim(), context);
    return { result: Boolean(result), error: null };
  } catch (error) {
    return { result: false, error: `Condition evaluation error: ${String(error)}` };
  }
}

/**
 * Safe expression evaluator - parses and evaluates simple expressions without using eval/Function.
 * Supports: property access, comparisons (==, !=, <, >, <=, >=), len(), literals, logical ops (&&, ||, and, or)
 */
function evaluateExpression(expr: string, context: Record<string, unknown>): unknown {
  expr = expr.trim();

  // Handle logical operators (lowest precedence)
  // Split on && or 'and', then || or 'or'
  const orParts = splitLogical(expr, ["||", " or "]);
  if (orParts.length > 1) {
    return orParts.some((part) => Boolean(evaluateExpression(part, context)));
  }

  const andParts = splitLogical(expr, ["&&", " and "]);
  if (andParts.length > 1) {
    return andParts.every((part) => Boolean(evaluateExpression(part, context)));
  }

  // Handle negation
  if (expr.startsWith("!") || expr.toLowerCase().startsWith("not ")) {
    const inner = expr.startsWith("!") ? expr.slice(1) : expr.slice(4);
    return !evaluateExpression(inner.trim(), context);
  }

  // Handle parentheses
  if (expr.startsWith("(") && expr.endsWith(")")) {
    return evaluateExpression(expr.slice(1, -1), context);
  }

  // Handle comparison operators
  const compOps = ["===", "!==", "==", "!=", "<=", ">=", "<", ">"];
  for (const op of compOps) {
    const idx = findOperator(expr, op);
    if (idx !== -1) {
      const left = evaluateExpression(expr.slice(0, idx), context);
      const right = evaluateExpression(expr.slice(idx + op.length), context);
      switch (op) {
        case "===":
        case "==":
          return left === right || String(left) === String(right);
        case "!==":
        case "!=":
          return left !== right && String(left) !== String(right);
        case "<":
          return Number(left) < Number(right);
        case ">":
          return Number(left) > Number(right);
        case "<=":
          return Number(left) <= Number(right);
        case ">=":
          return Number(left) >= Number(right);
      }
    }
  }

  // Handle function calls: len(expr), bool(expr), str(expr), int(expr)
  const funcMatch = expr.match(/^(len|bool|str|int|float)\s*\(\s*(.*)\s*\)$/);
  if (funcMatch && funcMatch[1] && funcMatch[2] !== undefined) {
    const func = funcMatch[1];
    const arg = funcMatch[2];
    const value = evaluateExpression(arg, context);
    switch (func) {
      case "len":
        if (Array.isArray(value)) return value.length;
        if (typeof value === "string") return value.length;
        if (value && typeof value === "object") return Object.keys(value).length;
        return 0;
      case "bool":
        return Boolean(value);
      case "str":
        return String(value ?? "");
      case "int":
        return Number.parseInt(String(value), 10);
      case "float":
        return Number(value);
    }
  }

  // Handle string literals
  if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
    return expr.slice(1, -1);
  }

  // Handle number literals
  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return Number(expr);
  }

  // Handle boolean literals
  const lowerExpr = expr.toLowerCase();
  if (lowerExpr === "true") return true;
  if (lowerExpr === "false") return false;
  if (lowerExpr === "null" || lowerExpr === "none") return null;

  // Handle property access: output.field.nested
  if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(expr)) {
    const parts = expr.split(".");
    let value: unknown = context;
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  }

  // Handle array access: output.items[0]
  const arrayMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\[(\d+)\]$/);
  if (arrayMatch && arrayMatch[1] && arrayMatch[2]) {
    const path = arrayMatch[1];
    const indexStr = arrayMatch[2];
    const array = evaluateExpression(path, context);
    if (Array.isArray(array)) {
      return array[Number(indexStr)];
    }
    return undefined;
  }

  // Unknown expression - return as-is for debugging
  throw new Error(`Unsupported expression: ${expr}`);
}

/**
 * Split expression on logical operators, respecting parentheses and quotes.
 */
function splitLogical(expr: string, operators: string[]): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let current = "";

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];

    // Handle string boundaries
    if ((char === '"' || char === "'") && (i === 0 || expr[i - 1] !== "\\")) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
    }

    // Handle parentheses depth
    if (!inString) {
      if (char === "(") depth++;
      if (char === ")") depth--;
    }

    // Check for operator at current position
    if (depth === 0 && !inString) {
      let matched = false;
      for (const op of operators) {
        if (expr.slice(i, i + op.length).toLowerCase() === op.toLowerCase()) {
          if (current.trim()) {
            parts.push(current.trim());
          }
          current = "";
          i += op.length - 1;
          matched = true;
          break;
        }
      }
      if (!matched) {
        current += char;
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Find operator position in expression, respecting parentheses and quotes.
 */
function findOperator(expr: string, operator: string): number {
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];

    if ((char === '"' || char === "'") && (i === 0 || expr[i - 1] !== "\\")) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
    }

    if (!inString) {
      if (char === "(") depth++;
      if (char === ")") depth--;
    }

    if (depth === 0 && !inString && expr.slice(i, i + operator.length) === operator) {
      return i;
    }
  }

  return -1;
}

export function computeCriticalPath(agents: SwarmAgentRow[]): string[] | null {
  if (agents.length === 0) {
    return null;
  }

  const idToAgent = new Map<number, SwarmAgentRow>();
  const nameToAgent = new Map<string, SwarmAgentRow>();
  agents.forEach((agent) => {
    idToAgent.set(agent.id, agent);
    nameToAgent.set(agent.name, agent);
  });

  const levels = new Map<string, number>();
  const computeLevel = (name: string): number => {
    if (levels.has(name)) {
      return levels.get(name) as number;
    }
    const agent = nameToAgent.get(name);
    if (!agent || !agent.depends_on || agent.depends_on.length === 0) {
      levels.set(name, 0);
      return 0;
    }
    let maxDep = -1;
    for (const dep of agent.depends_on) {
      const depAgent = idToAgent.get(dep.agent_id);
      if (depAgent) {
        maxDep = Math.max(maxDep, computeLevel(depAgent.name));
      }
    }
    levels.set(name, maxDep + 1);
    return maxDep + 1;
  };

  agents.forEach((agent) => computeLevel(agent.name));
  const maxLevel = Math.max(...Array.from(levels.values()));
  if (maxLevel === 0) {
    return null;
  }

  const pathTo = new Map<string, string[]>();
  agents.forEach((agent) => pathTo.set(agent.name, [agent.name]));

  for (let level = 1; level <= maxLevel; level += 1) {
    for (const agent of agents) {
      if (levels.get(agent.name) !== level || !agent.depends_on) {
        continue;
      }
      let longest: string[] = [];
      for (const dep of agent.depends_on) {
        const depAgent = idToAgent.get(dep.agent_id);
        if (depAgent) {
          const path = pathTo.get(depAgent.name) ?? [];
          if (path.length > longest.length) {
            longest = path;
          }
        }
      }
      pathTo.set(agent.name, [...longest, agent.name]);
    }
  }

  let best: string[] = [];
  for (const path of pathTo.values()) {
    if (path.length > best.length) {
      best = path;
    }
  }
  return best.length > 0 ? best : null;
}
