export type Primitive = string | number | boolean | null;

export type GraphValue =
  | Primitive
  | GraphValue[]
  | { [key: string]: GraphValue };

export type NodeId = string;

export interface GraphNodeContract {
  in?: string[];
  out?: string[];
}

export interface GraphNode {
  id: NodeId;
  semanticId?: string;
  contract?: GraphNodeContract;
  value: GraphValue;
  state: Record<string, GraphValue>;
  meta: Record<string, GraphValue>;
}

export interface GraphEdge {
  id: string;
  subject: NodeId;
  relation: string;
  object: NodeId;
  kind: "branch" | "progress";
  meta: Record<string, GraphValue>;
  context: GraphValue | null;
}

export interface GraphHistoryEntry {
  id: string;
  op:
    | "@runtime.transaction"
    | "@runtime.addNode"
    | "@runtime.addEdge"
    | "@runtime.updateNodeValue"
    | "@runtime.deleteNode"
    | "@apply"
    | "@graft.branch"
    | "@graft.state"
    | "@derive.state"
    | "@graft.meta"
    | "@derive.meta"
    | "@graft.progress"
    | "@prune.branch"
    | "@prune.state"
    | "@prune.meta"
    | "@ctx.set"
    | "@ctx.clear";
  payload: Record<string, GraphValue>;
  causedBy?: string;
}

export interface GraphHistoryOptions {
  causedBy?: string;
  historyOp?: GraphHistoryEntry["op"];
}

export interface GraphBranchOptions extends GraphHistoryOptions {
  metadata?: Record<string, GraphValue>;
}

export interface Graph {
  nodes: Map<NodeId, GraphNode>;
  edges: GraphEdge[];
  root: NodeId | null;
  state: Record<string, GraphValue>;
  meta: Record<string, GraphValue>;
  history: GraphHistoryEntry[];
}

export function createGraph(
  root: NodeId | null = null,
  state: Record<string, GraphValue> = {},
  meta: Record<string, GraphValue> = {},
): Graph {
  return {
    nodes: new Map<NodeId, GraphNode>(),
    edges: [],
    root,
    state: deepCloneRecord(state),
    meta: deepCloneRecord(meta),
    history: [],
  };
}

export function cloneGraph(graph: Graph): Graph {
  return {
    nodes: new Map(
      Array.from(graph.nodes.entries()).map(([id, node]) => [
        id,
        {
          id: node.id,
          semanticId: node.semanticId,
          contract: cloneNodeContract(node.contract),
          value: cloneGraphValue(node.value),
          state: deepCloneRecord(node.state),
          meta: deepCloneRecord(node.meta),
        },
      ]),
    ),
    edges: graph.edges.map((edge) => ({
      ...edge,
      meta: deepCloneRecord(edge.meta),
      context: cloneGraphValue(edge.context),
    })),
    root: graph.root,
    state: deepCloneRecord(graph.state),
    meta: deepCloneRecord(graph.meta),
    history: graph.history.map((entry) => ({
      id: entry.id,
      op: entry.op,
      payload: deepCloneRecord(entry.payload),
      causedBy: entry.causedBy,
    })),
  };
}

export function hasNode(graph: Graph, id: NodeId): boolean {
  return graph.nodes.has(id);
}

export function getNode(graph: Graph, id: NodeId): GraphNode {
  const node = graph.nodes.get(id);
  if (!node) {
    throw new Error(`Graph node "${id}" does not exist`);
  }
  return node;
}

export function addNode(graph: Graph, node: GraphNode): Graph {
  if (graph.nodes.has(node.id)) {
    throw new Error(`Graph node "${node.id}" already exists`);
  }

  graph.nodes.set(node.id, {
    id: node.id,
    semanticId: node.semanticId,
    contract: cloneNodeContract(node.contract),
    value: cloneGraphValue(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  });

  return graph;
}

export function upsertNode(graph: Graph, node: GraphNode): Graph {
  graph.nodes.set(node.id, {
    id: node.id,
    semanticId: node.semanticId,
    contract: cloneNodeContract(node.contract),
    value: cloneGraphValue(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  });

  return graph;
}

export function removeNode(graph: Graph, id: NodeId): Graph {
  if (!graph.nodes.has(id)) {
    return graph;
  }

  graph.nodes.delete(id);
  graph.edges = graph.edges.filter(
    (edge) => edge.subject !== id && edge.object !== id,
  );

  if (graph.root === id) {
    graph.root = null;
  }

  return graph;
}

export function addBranch(
  graph: Graph,
  subject: NodeId,
  relation: string,
  object: NodeId,
  options?: GraphBranchOptions,
): Graph {
  assertNodeExists(graph, subject);
  assertNodeExists(graph, object);

  if (hasEdge(graph, subject, relation, object, "branch", options?.metadata)) {
    return graph;
  }

  graph.edges.push({
    id: makeEdgeId(subject, relation, object, "branch"),
    subject,
    relation,
    object,
    kind: "branch",
    meta: deepCloneRecord(options?.metadata ?? {}),
    context: null,
  });

  pushHistoryEntry(
    graph,
    {
      op: options?.historyOp ?? "@graft.branch",
      payload: {
        subject,
        relation,
        object,
        kind: "branch",
        meta: cloneGraphValue(options?.metadata ?? {}),
      },
    },
    options,
  );

  return graph;
}

export function removeBranch(
  graph: Graph,
  subject: NodeId,
  relation: string,
  object: NodeId,
  options?: GraphBranchOptions,
): Graph {
  const before = graph.edges.length;

  graph.edges = graph.edges.filter(
    (edge) =>
      !(
        edge.subject === subject &&
        edge.relation === relation &&
        edge.object === object &&
        edge.kind === "branch" &&
        matchesEdgeMetadata(edge.meta, options?.metadata)
      ),
  );

  if (graph.edges.length !== before) {
    pushHistoryEntry(
      graph,
      {
        op: options?.historyOp ?? "@prune.branch",
        payload: {
          subject,
          relation,
          object,
          kind: "branch",
          meta: cloneGraphValue(options?.metadata ?? {}),
        },
      },
      options,
    );
  }

  return graph;
}

export function addProgress(
  graph: Graph,
  subject: NodeId,
  relation: string,
  object: NodeId,
  options?: GraphHistoryOptions,
): Graph {
  assertNodeExists(graph, subject);
  assertNodeExists(graph, object);

  if (hasEdge(graph, subject, relation, object, "progress")) {
    return graph;
  }

  graph.edges.push({
    id: makeEdgeId(subject, relation, object, "progress"),
    subject,
    relation,
    object,
    kind: "progress",
    meta: {},
    context: null,
  });

  pushHistoryEntry(
    graph,
    {
      op: options?.historyOp ?? "@graft.progress",
      payload: {
        subject,
        relation,
        object,
        kind: "progress",
      },
    },
    options,
  );

  return graph;
}

export function setNodeState(
  graph: Graph,
  nodeId: NodeId,
  key: string,
  value: GraphValue,
  options?: GraphHistoryOptions,
): Graph {
  const node = getNode(graph, nodeId);
  node.state[key] = cloneGraphValue(value);

  pushHistoryEntry(
    graph,
    {
      op: options?.historyOp ?? "@graft.state",
      payload: {
        nodeId,
        key,
        value: cloneGraphValue(value),
      },
    },
    options,
  );

  return graph;
}

export function removeNodeState(
  graph: Graph,
  nodeId: NodeId,
  key: string,
  options?: GraphHistoryOptions,
): Graph {
  const node = getNode(graph, nodeId);

  if (key in node.state) {
    delete node.state[key];

    pushHistoryEntry(
      graph,
      {
        op: options?.historyOp ?? "@prune.state",
        payload: {
          nodeId,
          key,
        },
      },
      options,
    );
  }

  return graph;
}

export function setNodeMeta(
  graph: Graph,
  nodeId: NodeId,
  key: string,
  value: GraphValue,
  options?: GraphHistoryOptions,
): Graph {
  const node = getNode(graph, nodeId);
  node.meta[key] = cloneGraphValue(value);

  pushHistoryEntry(
    graph,
    {
      op: options?.historyOp ?? "@graft.meta",
      payload: {
        nodeId,
        key,
        value: cloneGraphValue(value),
      },
    },
    options,
  );

  return graph;
}

export function removeNodeMeta(
  graph: Graph,
  nodeId: NodeId,
  key: string,
  options?: GraphHistoryOptions,
): Graph {
  const node = getNode(graph, nodeId);

  if (key in node.meta) {
    delete node.meta[key];

    pushHistoryEntry(
      graph,
      {
        op: options?.historyOp ?? "@prune.meta",
        payload: {
          nodeId,
          key,
        },
      },
      options,
    );
  }

  return graph;
}

export function setEdgeContext(
  graph: Graph,
  edgeId: string,
  context: GraphValue,
  options?: GraphHistoryOptions,
): Graph {
  const edge = getEdgeById(graph, edgeId);
  edge.context = cloneGraphValue(context);

  pushHistoryEntry(
    graph,
    {
      op: options?.historyOp ?? "@ctx.set",
      payload: {
        edgeId,
        context: cloneGraphValue(context),
      },
    },
    options,
  );

  return graph;
}

export function clearEdgeContext(
  graph: Graph,
  edgeId: string,
  options?: GraphHistoryOptions,
): Graph {
  const edge = getEdgeById(graph, edgeId);
  edge.context = null;

  pushHistoryEntry(
    graph,
    {
      op: options?.historyOp ?? "@ctx.clear",
      payload: {
        edgeId,
      },
    },
    options,
  );

  return graph;
}

export function getOutgoingEdges(
  graph: Graph,
  nodeId: NodeId,
  kind?: GraphEdge["kind"],
): GraphEdge[] {
  return graph.edges.filter(
    (edge) => edge.subject === nodeId && (!kind || edge.kind === kind),
  );
}

export function getIncomingEdges(
  graph: Graph,
  nodeId: NodeId,
  kind?: GraphEdge["kind"],
): GraphEdge[] {
  return graph.edges.filter(
    (edge) => edge.object === nodeId && (!kind || edge.kind === kind),
  );
}

export function getEdgesByRelation(
  graph: Graph,
  relation: string,
  kind?: GraphEdge["kind"],
): GraphEdge[] {
  return graph.edges.filter(
    (edge) => edge.relation === relation && (!kind || edge.kind === kind),
  );
}

export function hasEdge(
  graph: Graph,
  subject: NodeId,
  relation: string,
  object: NodeId,
  kind?: GraphEdge["kind"],
  metadata?: Record<string, GraphValue>,
): boolean {
  return graph.edges.some(
    (edge) =>
      edge.subject === subject &&
      edge.relation === relation &&
      edge.object === object &&
      (!kind || edge.kind === kind) &&
      matchesEdgeMetadata(edge.meta, metadata),
  );
}

export function hasDirectedContractEligibility(
  fromNode: GraphNode,
  toNode: GraphNode,
  hook?: string,
): boolean {
  return getContractIntersection(fromNode.contract?.out, toNode.contract?.in, hook).length > 0;
}

export function hasHandshakeContractEligibility(
  leftNode: GraphNode,
  rightNode: GraphNode,
  hook?: string,
): boolean {
    return (
      hasDirectedContractEligibility(leftNode, rightNode, hook) &&
      hasDirectedContractEligibility(rightNode, leftNode, hook)
    );
}

export function graphToDebugObject(graph: Graph): {
  root: NodeId | null;
  state: Record<string, GraphValue>;
  meta: Record<string, GraphValue>;
  nodes: Array<{
    id: NodeId;
    semanticId?: string;
    contract?: GraphNodeContract;
    value: GraphValue;
    state: Record<string, GraphValue>;
    meta: Record<string, GraphValue>;
  }>;
  edges: GraphEdge[];
  history: GraphHistoryEntry[];
} {
  return {
    root: graph.root,
    state: deepCloneRecord(graph.state),
    meta: deepCloneRecord(graph.meta),
    nodes: Array.from(graph.nodes.values()).map((node) => ({
      id: node.id,
      semanticId: node.semanticId,
      contract: cloneNodeContract(node.contract),
      value: cloneGraphValue(node.value),
      state: deepCloneRecord(node.state),
      meta: deepCloneRecord(node.meta),
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      meta: deepCloneRecord(edge.meta),
      context: cloneGraphValue(edge.context),
    })),
    history: graph.history.map((entry) => ({
      id: entry.id,
      op: entry.op,
      payload: deepCloneRecord(entry.payload),
      causedBy: entry.causedBy,
    })),
  };
}

/* =========================
   Internal helpers
   ========================= */

function assertNodeExists(graph: Graph, id: NodeId): void {
  if (!graph.nodes.has(id)) {
    throw new Error(`Graph node "${id}" does not exist`);
  }
}

function getEdgeById(graph: Graph, edgeId: string): GraphEdge {
  const edge = graph.edges.find((item) => item.id === edgeId);
  if (!edge) {
    throw new Error(`Graph edge "${edgeId}" does not exist`);
  }
  return edge;
}

function matchesEdgeMetadata(
  edgeMeta: Record<string, GraphValue> | undefined,
  metadata: Record<string, GraphValue> | undefined,
): boolean {
  if (!metadata || Object.keys(metadata).length === 0) {
    return true;
  }

  const actual = edgeMeta ?? {};
  return Object.entries(metadata).every(([key, value]) =>
    JSON.stringify(actual[key] ?? null) === JSON.stringify(value),
  );
}

function getContractIntersection(
  fromValues: string[] | undefined,
  toValues: string[] | undefined,
  hook?: string,
): string[] {
  const fromSet = new Set(fromValues ?? []);
  const toSet = new Set(toValues ?? []);
  const overlap = [...fromSet].filter((value) => toSet.has(value));
  if (!hook) {
    return overlap;
  }
  return overlap.filter((value) => value === hook);
}

function makeEdgeId(
  subject: NodeId,
  relation: string,
  object: NodeId,
  kind: GraphEdge["kind"],
): string {
  return `${kind}:${subject}:${relation}:${object}`;
}

function makeHistoryId(): string {
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneNodeContract(
  contract: GraphNodeContract | undefined,
): GraphNodeContract | undefined {
  if (!contract) {
    return undefined;
  }

  return {
    ...(contract.in ? { in: [...contract.in] } : {}),
    ...(contract.out ? { out: [...contract.out] } : {}),
  };
}

function pushHistoryEntry(
  graph: Graph,
  entry: Omit<GraphHistoryEntry, "id" | "causedBy">,
  options?: GraphHistoryOptions,
): void {
  graph.history.push({
    id: makeHistoryId(),
    op: entry.op,
    payload: deepCloneRecord(entry.payload),
    causedBy: options?.causedBy,
  });
}

export function addHistoryEntry(
  graph: Graph,
  entry: Omit<GraphHistoryEntry, "id" | "causedBy">,
  options?: GraphHistoryOptions,
): GraphHistoryEntry {
  const historyEntry: GraphHistoryEntry = {
    id: makeHistoryId(),
    op: entry.op,
    payload: deepCloneRecord(entry.payload),
    causedBy: options?.causedBy,
  };

  graph.history.push(historyEntry);
  return historyEntry;
}

export function cloneGraphValue<T extends GraphValue>(value: T): T {
  if (value === null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => cloneGraphValue(item)) as T;
  }

  if (typeof value === "object") {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = cloneGraphValue(v);
    }
    return out as T;
  }

  return value;
}

function deepCloneRecord<T extends Record<string, GraphValue>>(record: T): T {
  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = cloneGraphValue(value);
  }
  return out as T;
}
