import type {
  ArrayLiteralNode,
  BinaryBooleanExprNode,
  BooleanExprNode,
  BooleanValueNode,
  ComparisonExprNode,
  DeriveBinaryExprNode,
  DeriveCollectExprNode,
  DeriveEdgeCountExprNode,
  DeriveExprNode,
  DeriveExistsExprNode,
  DerivePathExprNode,
  GroupedBooleanExprNode,
  PropertyAccessNode,
  StringLiteralNode,
  DeriveSumExprNode,
  UnaryBooleanExprNode,
} from "../ast/nodeTypes";
import type { RuntimeBindings } from "./evaluateNodeCapture";
import type { Graph, GraphEdge, GraphNode, GraphValue } from "./graph";
import type { MatchResult, MatchResultSet } from "./executeQuery";

export interface FilteredResultSet {
  kind: "FilteredResultSet";
  sourceKind: "MatchResultSet";
  condition: string;
  items: MatchResult[];
}

export interface WhereResultSet {
  kind: "WhereResultSet";
  sourceKind: "node" | "edge";
  condition: string;
  items: GraphNode[] | GraphEdge[];
}

type WhereReferenceKind = "node" | "edge" | "mixed" | "unknown";

export function executeWhere(
  graph: Graph,
  source: MatchResultSet,
  condition: BooleanExprNode,
): FilteredResultSet {
  const items = source.items.filter((item) =>
    evaluateBooleanExpr(condition, graph, item.bindings),
  );

  return {
    kind: "FilteredResultSet",
    sourceKind: "MatchResultSet",
    condition: printBooleanExpr(condition),
    items,
  };
}

export function executeWhereQuery(
  graph: Graph,
  condition: BooleanExprNode,
  bindings: RuntimeBindings,
): WhereResultSet {
  const sourceKind = inferWhereReferenceKind(condition);

  if (sourceKind === "unknown") {
    throw new Error(`@where must reference either node.* or edge.*`);
  }

  if (sourceKind === "mixed") {
    throw new Error(`@where cannot mix node.* and edge.* references`);
  }

  if (sourceKind === "node") {
    return {
      kind: "WhereResultSet",
      sourceKind,
      condition: printBooleanExpr(condition),
      items: Array.from(graph.nodes.values())
        .filter((node) => evaluateWhereTargetExpr(condition, graph, "node", node, bindings))
        .map(cloneNode),
    };
  }

  return {
    kind: "WhereResultSet",
    sourceKind,
    condition: printBooleanExpr(condition),
    items: graph.edges
      .filter((edge) => evaluateWhereTargetExpr(condition, graph, "edge", edge, bindings))
      .map(cloneEdge),
  };
}

function evaluateBooleanExpr(
  expr: BooleanExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): boolean {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return evaluateBinaryBoolean(expr, graph, bindings);

    case "UnaryBooleanExpr":
      return !evaluateBooleanExpr(expr.argument, graph, bindings);

    case "GroupedBooleanExpr":
      return evaluateBooleanExpr(expr.expression, graph, bindings);

    case "ComparisonExpr":
      return evaluateComparison(expr, graph, bindings);

    case "Identifier": {
      const value = resolveIdentifier(expr.name, bindings);
      return truthy(value);
    }

    case "PropertyAccess": {
      const value = resolvePropertyAccess(expr, graph, bindings);
      return truthy(value);
    }

    case "StringLiteral":
      return truthy(expr.value);

    case "NumberLiteral":
      return truthy(expr.value);

    case "BooleanLiteral":
      return expr.value;

    case "RegexLiteral":
      return truthy(expr.raw);

    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return truthy(evaluateWhereDeriveValue(expr, graph, bindings));

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unsupported boolean expression: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function evaluateWhereTargetExpr(
  expr: BooleanExprNode,
  graph: Graph,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return evaluateWhereBinaryBoolean(expr, graph, context, item, bindings);

    case "UnaryBooleanExpr":
      return !evaluateWhereTargetExpr(expr.argument, graph, context, item, bindings);

    case "GroupedBooleanExpr":
      return evaluateWhereTargetExpr(expr.expression, graph, context, item, bindings);

    case "ComparisonExpr":
      return evaluateWhereComparison(expr, graph, context, item, bindings);

    case "Identifier":
      return truthy(resolveWhereIdentifier(expr.name, context, item, bindings));

    case "PropertyAccess":
      return truthy(resolveWherePropertyAccess(expr, context, item, bindings));

    case "StringLiteral":
      return truthy(expr.value);

    case "NumberLiteral":
      return truthy(expr.value);

    case "BooleanLiteral":
      return expr.value;

    case "RegexLiteral":
      return truthy(expr.raw);

    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return truthy(evaluateWhereTargetDeriveValue(expr, graph, context, item, bindings));

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unsupported boolean expression: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function evaluateBinaryBoolean(
  expr: BinaryBooleanExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): boolean {
  if (expr.operator === "&&") {
    return (
      evaluateBooleanExpr(expr.left, graph, bindings) &&
      evaluateBooleanExpr(expr.right, graph, bindings)
    );
  }

  if (expr.operator === "||") {
    return (
      evaluateBooleanExpr(expr.left, graph, bindings) ||
      evaluateBooleanExpr(expr.right, graph, bindings)
    );
  }

  throw new Error(`Unsupported boolean operator "${expr.operator}"`);
}

function evaluateWhereBinaryBoolean(
  expr: BinaryBooleanExprNode,
  graph: Graph,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  if (expr.operator === "&&") {
    return (
      evaluateWhereTargetExpr(expr.left, graph, context, item, bindings) &&
      evaluateWhereTargetExpr(expr.right, graph, context, item, bindings)
    );
  }

  if (expr.operator === "||") {
    return (
      evaluateWhereTargetExpr(expr.left, graph, context, item, bindings) ||
      evaluateWhereTargetExpr(expr.right, graph, context, item, bindings)
    );
  }

  throw new Error(`Unsupported boolean operator "${expr.operator}"`);
}

function evaluateComparison(
  expr: ComparisonExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): boolean {
  const left = resolveBooleanValue(expr.left, graph, bindings);
  const right = resolveBooleanValue(expr.right, graph, bindings);
  return applyComparisonOperator(expr.operator, left, right);
}

function evaluateWhereComparison(
  expr: ComparisonExprNode,
  graph: Graph,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  const left = resolveWhereBooleanValue(expr.left, graph, context, item, bindings);
  const right = resolveWhereBooleanValue(expr.right, graph, context, item, bindings);
  return applyComparisonOperator(expr.operator, left, right);
}

function applyComparisonOperator(
  operator: ComparisonExprNode["operator"],
  left: GraphValue,
  right: GraphValue,
): boolean {
  switch (operator) {
    case "==":
      return compareCaseInsensitive(left, right);

    case "===":
      return compareStrict(left, right);

    case "!=":
      return !compareCaseInsensitive(left, right);

    case "!==":
      return !compareStrict(left, right);

    case "<":
    case "<=":
    case ">":
    case ">=":
      return compareNumeric(operator, left, right);

    default: {
      const _exhaustive: never = operator;
      throw new Error(`Unsupported comparison operator "${_exhaustive}"`);
    }
  }
}

function resolveBooleanValue(
  value: BooleanValueNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): GraphValue {
  switch (value.type) {
    case "Identifier":
      return resolveIdentifier(value.name, bindings);

    case "PropertyAccess":
      return resolvePropertyAccess(value, graph, bindings);

    case "StringLiteral":
      return value.value;

    case "NumberLiteral":
      return value.value;

    case "BooleanLiteral":
      return value.value;

    case "RegexLiteral":
      return value.raw;

    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return evaluateWhereDeriveValue(value, graph, bindings);

    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported boolean value: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function resolveWhereBooleanValue(
  value: BooleanValueNode,
  graph: Graph,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue {
  switch (value.type) {
    case "Identifier":
      return resolveWhereIdentifier(value.name, context, item, bindings);

    case "PropertyAccess":
      return resolveWherePropertyAccess(value, context, item, bindings);

    case "StringLiteral":
      return value.value;

    case "NumberLiteral":
      return value.value;

    case "BooleanLiteral":
      return value.value;

    case "RegexLiteral":
      return value.raw;

    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return evaluateWhereTargetDeriveValue(value, graph, context, item, bindings);

    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported boolean value: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function resolveIdentifier(
  name: string,
  bindings: Record<string, GraphValue>,
): GraphValue {
  if (name in bindings) {
    return bindings[name];
  }

  return name;
}

function evaluateWhereDeriveValue(
  expr: Extract<
    BooleanValueNode,
    {
      type:
        | "DeriveStateExpr"
        | "DeriveMetaExpr"
        | "DeriveCountExpr"
        | "DeriveEdgeCountExpr"
        | "DeriveExistsExpr"
        | "DerivePathExpr"
        | "DeriveCollectExpr"
        | "DeriveSumExpr"
        | "DeriveBinaryExpr";
    }
  >,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): GraphValue {
  switch (expr.type) {
    case "DeriveStateExpr":
      return readDerivedLayer(graph, bindings, expr.node?.name, "state", expr.key?.value);
    case "DeriveMetaExpr":
      return readDerivedLayer(graph, bindings, expr.node?.name, "meta", expr.key?.value);
    case "DeriveCountExpr":
      if (!expr.nodes) {
        throw new Error("@derive.count requires a nodes field");
      }
      return evaluateWhereDerivePath(expr.nodes, graph, bindings).length;
    case "DeriveEdgeCountExpr":
      return countDerivedEdges(graph, bindings, expr.node?.name, expr.relation?.value, expr.direction?.value, expr.where);
    case "DeriveExistsExpr":
      if (!expr.path) {
        throw new Error("@derive.exists requires a path field");
      }
      return evaluateWhereDerivePath(expr.path, graph, bindings).length > 0;
    case "DerivePathExpr":
      return evaluateWhereDerivePath(expr, graph, bindings);
    case "DeriveCollectExpr":
      return evaluateWhereDeriveCollect(expr, graph, bindings);
    case "DeriveSumExpr":
      return evaluateWhereDeriveSum(expr, graph, bindings);
    case "DeriveBinaryExpr": {
      const left = evaluateWhereDeriveOperand(expr.left, graph, bindings);
      const right = evaluateWhereDeriveOperand(expr.right, graph, bindings);
      if (expr.operator === "+") {
        if (typeof left === "number" && typeof right === "number") return left + right;
        if (typeof left === "string" || typeof right === "string") {
          return `${stringifyGraphValue(left)}${stringifyGraphValue(right)}`;
        }
        throw new Error('Derive operator "+" requires number or string operands');
      }
      return evaluateWhereNumericBinary(expr.operator, left, right);
    }
  }
}

function evaluateWhereTargetDeriveValue(
  expr: Extract<
    BooleanValueNode,
    {
      type:
        | "DeriveStateExpr"
        | "DeriveMetaExpr"
        | "DeriveCountExpr"
        | "DeriveEdgeCountExpr"
        | "DeriveExistsExpr"
        | "DerivePathExpr"
        | "DeriveCollectExpr"
        | "DeriveSumExpr"
        | "DeriveBinaryExpr";
    }
  >,
  graph: Graph,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue {
  const asBindings: Record<string, GraphValue> = {};
  for (const [key, value] of bindings.values.entries()) {
    asBindings[key] = value;
  }
  for (const [key, node] of bindings.nodes.entries()) {
    asBindings[key] = node.id;
  }

  if (context === "node") {
    asBindings.node = whereNodeToValue(item as GraphNode);
  } else {
    asBindings.edge = whereEdgeToValue(item as GraphEdge);
  }

  return evaluateWhereDeriveValue(expr, graph, asBindings);
}

function evaluateWhereDeriveOperand(
  expr: DeriveBinaryExprNode["left"],
  graph: Graph,
  bindings: Record<string, GraphValue>,
): GraphValue {
  switch (expr.type) {
    case "StringLiteral":
      return expr.value;
    case "NumberLiteral":
      return expr.value;
    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return evaluateWhereDeriveValue(expr, graph, bindings);
    default:
      throw new Error(`Unsupported derive operand "${expr.type}"`);
  }
}

function readDerivedLayer(
  graph: Graph,
  bindings: Record<string, GraphValue>,
  nodeRef: string | undefined,
  layer: "state" | "meta",
  key: string | undefined,
): GraphValue {
  if (!nodeRef || !key) {
    throw new Error(`@derive.${layer} requires node and key`);
  }
  const nodeId = resolveIdentifier(nodeRef, bindings);
  if (typeof nodeId !== "string" || !graph.nodes.has(nodeId)) {
    throw new Error(`@derive.${layer} could not find node "${String(nodeId)}"`);
  }
  const node = graph.nodes.get(nodeId)!;
  const record = layer === "state" ? node.state : node.meta;
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new Error(`@derive.${layer} could not find key "${key}" on node "${nodeId}"`);
  }
  return record[key];
}

function evaluateWhereDerivePath(
  expr: DerivePathExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): string[] {
  if (!expr.node || !expr.relation || !expr.direction || !expr.depth) {
    throw new Error("@derive.path requires node, relation, direction, and depth");
  }

  const startNodeId = resolveIdentifier(expr.node.name, bindings);
  if (typeof startNodeId !== "string" || !graph.nodes.has(startNodeId)) {
    throw new Error(`@derive.path could not find node "${String(startNodeId)}"`);
  }

  const maxDepth = expr.depth.value;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error("@derive.path depth must be an integer >= 1");
  }

  const direction = expr.direction.value;
  if (direction !== "incoming" && direction !== "outgoing" && direction !== "both") {
    throw new Error('@derive.path direction must be "incoming", "outgoing", or "both"');
  }

  const relations = resolveWherePathRelations(expr.relation);
  const visited = new Set<string>([startNodeId]);
  const results = new Set<string>();
  let frontier = [startNodeId];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const nextFrontier: string[] = [];

    for (const currentNodeId of frontier) {
      for (const nextNodeId of collectWherePathNeighbors(
        graph,
        currentNodeId,
        relations,
        direction,
      )) {
        if (visited.has(nextNodeId)) {
          continue;
        }

        visited.add(nextNodeId);
        results.add(nextNodeId);
        nextFrontier.push(nextNodeId);
      }
    }

    if (nextFrontier.length === 0) {
      break;
    }

    frontier = nextFrontier;
  }

  const nodeIds = [...results];
  if (!expr.where) {
    return nodeIds;
  }

  return nodeIds.filter((candidateId) =>
    evaluateWherePathWhereExpr(graph, candidateId, expr.where!, bindings),
  );
}

function evaluateWhereDeriveCollect(
  expr: DeriveCollectExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): GraphValue[] {
  if (!expr.path || !expr.layer || !expr.key) {
    throw new Error("@derive.collect requires path, layer, and key");
  }
  const layer = expr.layer.value;
  if (layer !== "value" && layer !== "state" && layer !== "meta") {
    throw new Error('@derive.collect layer must be "value", "state", or "meta"');
  }
  const out: GraphValue[] = [];
  for (const nodeId of evaluateWhereDerivePath(expr.path, graph, bindings)) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    const source =
      layer === "value" ? node.value : layer === "state" ? node.state : node.meta;
    if (!isRecord(source) || !Object.prototype.hasOwnProperty.call(source, expr.key.value)) {
      continue;
    }
    out.push(source[expr.key.value]);
  }
  return out;
}

function evaluateWhereDeriveSum(
  expr: DeriveSumExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): number {
  if (!expr.collect) {
    throw new Error("@derive.sum requires a collect field");
  }
  let total = 0;
  for (const value of evaluateWhereDeriveCollect(expr.collect, graph, bindings)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("@derive.sum requires all collected values to be numeric");
    }
    total += value;
  }
  return total;
}

function resolveWherePathRelations(
  relation: StringLiteralNode | ArrayLiteralNode,
): string[] {
  if (relation.type === "StringLiteral") {
    return [relation.value];
  }

  return relation.elements.map((element) => {
    if (element.type !== "StringLiteral") {
      throw new Error("@derive.path relation arrays must contain only string literals");
    }

    return element.value;
  });
}

function collectWherePathNeighbors(
  graph: Graph,
  nodeId: string,
  relations: string[],
  direction: "incoming" | "outgoing" | "both",
): string[] {
  const neighbors = new Set<string>();

  for (const edge of graph.edges) {
    if (!relations.includes(edge.relation)) {
      continue;
    }

    if ((direction === "outgoing" || direction === "both") && edge.subject === nodeId) {
      neighbors.add(edge.object);
    }

    if ((direction === "incoming" || direction === "both") && edge.object === nodeId) {
      neighbors.add(edge.subject);
    }
  }

  return [...neighbors];
}

function countDerivedEdges(
  graph: Graph,
  bindings: Record<string, GraphValue>,
  nodeRef: string | undefined,
  relation: string | undefined,
  direction: string | undefined,
  where: BooleanExprNode | null = null,
): number {
  if (!nodeRef || !relation || !direction) {
    throw new Error("@derive.edgeCount requires node, relation, and direction");
  }
  const nodeId = resolveIdentifier(nodeRef, bindings);
  if (typeof nodeId !== "string") {
    throw new Error(`@derive.edgeCount could not resolve node "${String(nodeId)}"`);
  }
  const matchingEdges = graph.edges.filter((edge) => {
    if (edge.relation !== relation) return false;
    if (direction === "incoming" && edge.object !== nodeId) return false;
    if (direction === "outgoing" && edge.subject !== nodeId) return false;
    if (!where) return true;
    return evaluateWhereTargetExpr(where, graph, "edge", edge, {
      values: new Map(Object.entries(bindings)),
      nodes: new Map(),
    });
  });
  if (direction === "incoming" || direction === "outgoing") {
    return matchingEdges.length;
  }
  throw new Error('@derive.edgeCount direction must be "incoming" or "outgoing"');
}

function evaluateWhereNumericBinary(
  operator: DeriveBinaryExprNode["operator"],
  left: GraphValue,
  right: GraphValue,
): number {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new Error(`Numeric derive expressions require number operands`);
  }

  switch (operator) {
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "%":
      return left % right;
    default:
      throw new Error(`Unsupported numeric derive operator "${operator}"`);
  }
}

function resolveWhereIdentifier(
  name: string,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue {
  if (name === "node") {
    return context === "node" ? whereNodeToValue(item as GraphNode) : null;
  }

  if (name === "edge") {
    return context === "edge" ? whereEdgeToValue(item as GraphEdge) : null;
  }

  if (bindings.values.has(name)) {
    return bindings.values.get(name)!;
  }

  if (bindings.nodes.has(name)) {
    return bindings.nodes.get(name)!.id;
  }

  return name;
}

function resolvePropertyAccess(
  access: PropertyAccessNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): GraphValue {
  const base = resolveIdentifier(access.object.name, bindings);

  if (typeof base === "string" && graph.nodes.has(base)) {
    const node = graph.nodes.get(base)!;
    const first = access.chain[0]?.name;
    if (!first) return null;

    if (first === "state") {
      return dig(node.state, access.chain.slice(1).map((part) => part.name));
    }

    if (first === "meta") {
      return dig(node.meta, access.chain.slice(1).map((part) => part.name));
    }

    if (first === "value") {
      return dig(node.value, access.chain.slice(1).map((part) => part.name));
    }

    if (first in node.state) {
      return dig(node.state, access.chain.map((part) => part.name));
    }

    if (first in node.meta) {
      return dig(node.meta, access.chain.map((part) => part.name));
    }

    if (isRecord(node.value) && first in node.value) {
      return dig(node.value, access.chain.map((part) => part.name));
    }

    return null;
  }

  if (isRecord(base)) {
    return dig(base, access.chain.map((part) => part.name));
  }

  return null;
}

function resolveWherePropertyAccess(
  access: PropertyAccessNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue {
  const objectName = access.object.name;
  const path = access.chain.map((part) => part.name);

  if (objectName === "node") {
    if (context !== "node") return null;
    return dig(whereNodeToValue(item as GraphNode), path);
  }

  if (objectName === "edge") {
    if (context !== "edge") return null;
    return dig(whereEdgeToValue(item as GraphEdge), path);
  }

  const base = resolveWhereIdentifier(objectName, context, item, bindings);
  if (isRecord(base)) {
    return dig(base, path);
  }

  return null;
}

function dig(value: GraphValue, path: string[]): GraphValue {
  let current: GraphValue = value;

  for (const key of path) {
    if (!isRecord(current)) return null;
    if (!(key in current)) return null;
    current = current[key];
  }

  return current;
}

function whereNodeToValue(node: GraphNode): Record<string, GraphValue> {
  return {
    id: node.id,
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function whereEdgeToValue(edge: GraphEdge): Record<string, GraphValue> {
  return {
    id: edge.id,
    from: edge.subject,
    to: edge.object,
    rel: edge.relation,
    subject: edge.subject,
    object: edge.object,
    relation: edge.relation,
    kind: edge.kind,
    meta: deepCloneRecord(edge.meta),
    context: edge.context,
  };
}

function compareStrict(a: GraphValue, b: GraphValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compareCaseInsensitive(a: GraphValue, b: GraphValue): boolean {
  const aNorm = normalizeCaseInsensitive(a);
  const bNorm = normalizeCaseInsensitive(b);
  return JSON.stringify(aNorm) === JSON.stringify(bNorm);
}

function compareNumeric(
  operator: "<" | "<=" | ">" | ">=",
  left: GraphValue,
  right: GraphValue,
): boolean {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new Error(`Numeric comparison "${operator}" requires number operands`);
  }

  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
  }
}

function normalizeCaseInsensitive(value: GraphValue): GraphValue {
  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCaseInsensitive(item));
  }

  if (isRecord(value)) {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = normalizeCaseInsensitive(v);
    }
    return out;
  }

  return value;
}

function inferWhereReferenceKind(expr: BooleanExprNode): WhereReferenceKind {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return mergeWhereReferenceKinds(
        inferWhereReferenceKind(expr.left),
        inferWhereReferenceKind(expr.right),
      );

    case "UnaryBooleanExpr":
      return inferWhereReferenceKind(expr.argument);

    case "GroupedBooleanExpr":
      return inferWhereReferenceKind(expr.expression);

    case "ComparisonExpr":
      return mergeWhereReferenceKinds(
        inferWhereValueReferenceKind(expr.left),
        inferWhereValueReferenceKind(expr.right),
      );

    case "Identifier":
      if (expr.name === "node") return "node";
      if (expr.name === "edge") return "edge";
      return "unknown";

    case "PropertyAccess":
      if (expr.object.name === "node") return "node";
      if (expr.object.name === "edge") return "edge";
      return "unknown";

    default:
      return "unknown";
  }
}

function inferWhereValueReferenceKind(value: BooleanValueNode): WhereReferenceKind {
  switch (value.type) {
    case "Identifier":
      if (value.name === "node") return "node";
      if (value.name === "edge") return "edge";
      return "unknown";

    case "PropertyAccess":
      if (value.object.name === "node") return "node";
      if (value.object.name === "edge") return "edge";
      return "unknown";

    default:
      return "unknown";
  }
}

function mergeWhereReferenceKinds(
  left: WhereReferenceKind,
  right: WhereReferenceKind,
): WhereReferenceKind {
  if (left === "mixed" || right === "mixed") {
    return "mixed";
  }

  if (left === "unknown") {
    return right;
  }

  if (right === "unknown") {
    return left;
  }

  if (left !== right) {
    return "mixed";
  }

  return left;
}

function truthy(value: GraphValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return false;
}

function stringifyGraphValue(value: GraphValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isRecord(value: GraphValue): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function cloneEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    meta: deepCloneRecord(edge.meta),
    context: deepClone(edge.context),
  };
}

function deepClone<T extends GraphValue>(value: T): T {
  if (value === null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (isRecord(value)) {
    const out: Record<string, GraphValue> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = deepClone(item);
    }
    return out as T;
  }

  return value;
}

function deepCloneRecord<T extends Record<string, GraphValue>>(record: T): T {
  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = deepClone(value);
  }
  return out as T;
}

function printBooleanExpr(expr: BooleanExprNode): string {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return `${printBooleanExpr(expr.left)} ${expr.operator} ${printBooleanExpr(expr.right)}`;

    case "UnaryBooleanExpr":
      return `!${printBooleanExpr(expr.argument)}`;

    case "GroupedBooleanExpr":
      return `(${printBooleanExpr(expr.expression)})`;

    case "ComparisonExpr":
      return `${printBooleanValue(expr.left)} ${expr.operator} ${printBooleanValue(expr.right)}`;

    case "PropertyAccess":
      return `${expr.object.name}.${expr.chain.map((c) => c.name).join(".")}`;

    case "Identifier":
      return expr.name;

    case "StringLiteral":
      return expr.raw;

    case "NumberLiteral":
      return expr.raw;

    case "BooleanLiteral":
      return expr.raw;

    case "RegexLiteral":
      return expr.raw;

    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return printDeriveExpr(expr);

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unsupported boolean print expression: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function printBooleanValue(value: BooleanValueNode): string {
  switch (value.type) {
    case "Identifier":
      return value.name;

    case "PropertyAccess":
      return `${value.object.name}.${value.chain.map((c) => c.name).join(".")}`;

    case "StringLiteral":
      return value.raw;

    case "NumberLiteral":
      return value.raw;

    case "BooleanLiteral":
      return value.raw;

    case "RegexLiteral":
      return value.raw;

    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return printDeriveExpr(value);

    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported boolean print value: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function printDeriveExpr(
  expr: Extract<
    BooleanValueNode,
    {
      type:
        | "DeriveStateExpr"
        | "DeriveMetaExpr"
        | "DeriveCountExpr"
        | "DeriveEdgeCountExpr"
        | "DeriveExistsExpr"
        | "DerivePathExpr"
        | "DeriveCollectExpr"
        | "DeriveSumExpr"
        | "DeriveBinaryExpr";
    }
  >,
): string {
  switch (expr.type) {
    case "DeriveStateExpr":
      return `${expr.name} { node: ${expr.node?.name ?? "?"}, key: ${expr.key?.raw ?? "?"} }`;
    case "DeriveMetaExpr":
      return `${expr.name} { node: ${expr.node?.name ?? "?"}, key: ${expr.key?.raw ?? "?"} }`;
    case "DeriveCountExpr":
      if (expr.nodes) {
        return `${expr.name} { nodes: ${printDeriveExpr(expr.nodes)} }`;
      }
      return `${expr.name} { nodes: ? }`;
    case "DeriveEdgeCountExpr":
      return `${expr.name} { node: ${expr.node?.name ?? "?"}, relation: ${expr.relation?.raw ?? "?"}, direction: ${expr.direction?.raw ?? "?"} }`;
    case "DeriveExistsExpr":
      return `${expr.name} { path: ${expr.path ? printDeriveExpr(expr.path) : "?"} }`;
    case "DerivePathExpr":
      return `${expr.name} { node: ${expr.node?.name ?? "?"}, relation: ${expr.relation ? printDeriveRelation(expr.relation) : "?"}, direction: ${expr.direction?.raw ?? "?"}, depth: ${expr.depth?.raw ?? "?"}${expr.where ? `, where: ${printBooleanExpr(expr.where)}` : ""} }`;
    case "DeriveCollectExpr":
      return `${expr.name} { path: ${expr.path ? printDeriveExpr(expr.path) : "?"}, layer: ${expr.layer?.raw ?? "?"}, key: ${expr.key?.raw ?? "?"} }`;
    case "DeriveSumExpr":
      return `${expr.name} { collect: ${expr.collect ? printDeriveExpr(expr.collect) : "?"} }`;
    case "DeriveBinaryExpr":
      return `${printDeriveOperand(expr.left)} ${expr.operator} ${printDeriveOperand(expr.right)}`;
  }

  throw new Error(`Unsupported derive print expression: ${JSON.stringify(expr)}`);
}

function printDeriveOperand(expr: DeriveExprNode): string {
  switch (expr.type) {
    case "CurrentValue":
      return expr.name;
    case "PreviousValue":
      return expr.name;
    case "NumberLiteral":
      return expr.raw;
    case "StringLiteral":
      return expr.raw;
    case "DeriveStateExpr":
    case "DeriveMetaExpr":
    case "DeriveCountExpr":
    case "DeriveEdgeCountExpr":
    case "DeriveExistsExpr":
    case "DerivePathExpr":
    case "DeriveCollectExpr":
    case "DeriveSumExpr":
    case "DeriveBinaryExpr":
      return printDeriveExpr(expr);
  }

  throw new Error(`Unsupported derive operand: ${JSON.stringify(expr)}`);
}

function printDeriveRelation(value: StringLiteralNode | ArrayLiteralNode): string {
  if (value.type === "StringLiteral") {
    return value.raw;
  }

  return `[${value.elements
    .map((element) =>
      element.type === "StringLiteral" ? element.raw : JSON.stringify(element),
    )
    .join(", ")}]`;
}

function evaluateWherePathWhereExpr(
  graph: Graph,
  nodeId: string,
  where: BooleanExprNode,
  bindings: Record<string, GraphValue>,
): boolean {
  const node = graph.nodes.get(nodeId);
  if (!node) return false;
  const scopedBindings = {
    ...bindings,
    node: whereNodeToValue(node),
  };

  switch (where.type) {
    case "BinaryBooleanExpr":
    case "UnaryBooleanExpr":
    case "GroupedBooleanExpr":
    case "ComparisonExpr":
      return evaluateBooleanExpr(where, graph, scopedBindings);
    default: {
      const result = resolveBooleanValue(where, graph, scopedBindings);
      if (result === null) {
        return false;
      }
      if (typeof result !== "boolean") {
        throw new Error("@derive.path where must evaluate to a boolean");
      }
      return result;
    }
  }
}
