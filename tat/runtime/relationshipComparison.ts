import {
  getIncomingEdges,
  getOutgoingEdges,
  type Graph,
  type GraphNode,
} from "./graph";

const PRIMARY_PARENT_RELATION = "parentOf";
const PRIMARY_SPOUSE_RELATION = "spouseOf";

function isBirthParentEdge(edge: Graph["edges"][number]): boolean {
  return (
    edge.relation === "birthParent" ||
    (edge.relation === "parentOf" &&
      (edge.meta.kind === "birth" || edge.meta.kind === undefined))
  );
}

function isStepParentEdge(edge: Graph["edges"][number]): boolean {
  return (
    edge.relation === "stepParent" ||
    (edge.relation === "parentOf" && edge.meta.kind === "step")
  );
}

function isSpouseEdge(edge: Graph["edges"][number]): boolean {
  return (
    edge.relation === "spouse" ||
    (edge.relation === "spouseOf" &&
      (edge.meta.active === true || edge.meta.active === undefined))
  );
}

export interface RuntimeRelationshipComparisonRequest {
  fromId: string;
  toId: string;
  selectedCommonAncestorId?: string;
}

export interface RuntimeCommonAncestorsRequest {
  fromId: string;
  toId: string;
}

export interface RuntimeRelationshipComparisonResult {
  from: {
    id: string;
    label: string;
  };
  to: {
    id: string;
    label: string;
  };
  relationship: {
    type:
      | "ancestor"
      | "auntUncle"
      | "cousin"
      | "childInLaw"
      | "descendant"
      | "stepChild"
      | "stepParent"
      | "nieceNephew"
      | "parentInLaw"
      | "sibling"
      | "spouse"
      | "self"
      | "unknown";
    label: string;
    depth?: number;
  };
  pathNodeIds: string[];
  pathEdges: Array<{
    from: string;
    relation: string;
    to: string;
  }>;
  highlight: {
    selectedPathNodeIds: string[];
    selectedPathEdges: Array<{
      from: string;
      relation: string;
      to: string;
    }>;
    commonNodeIds: string[];
    commonEdges: Array<{
      from: string;
      relation: string;
      to: string;
    }>;
    targetPathNodeIds: string[];
    targetPathEdges: Array<{
      from: string;
      relation: string;
      to: string;
    }>;
  };
  availableCommonAncestors: Array<{
    id: string;
    label: string;
  }>;
  selectedCommonAncestorId?: string;
}

export interface RuntimeCommonAncestorsResult {
  format: "commonAncestors";
  from: {
    id: string;
    label: string;
  };
  to: {
    id: string;
    label: string;
  };
  count: number;
  ancestors: Array<{
    id: string;
    label: string;
    semanticId?: string;
    contract?: GraphNode["contract"];
    value: GraphNode["value"];
    state: GraphNode["state"];
    meta: GraphNode["meta"];
  }>;
}

export function compareGenealogyRelationship(
  graph: Graph,
  request: RuntimeRelationshipComparisonRequest,
): RuntimeRelationshipComparisonResult {
  const fromNode = graph.nodes.get(request.fromId);
  const toNode = graph.nodes.get(request.toId);

  if (!fromNode || !toNode) {
    throw new Error("Relationship comparison requires valid fromId and toId");
  }

  const from = {
    id: fromNode.id,
    label: computeNodeLabel(fromNode),
  };
  const to = {
    id: toNode.id,
    label: computeNodeLabel(toNode),
  };
  const sharedAncestors = collectSharedAncestors(graph, from.id, to.id);
  const availableCommonAncestors = sharedAncestors.map((ancestor) => ({
    id: ancestor.id,
    label: ancestor.label,
  }));
  const selectedCommonAncestorId = sharedAncestors.some(
    (ancestor) => ancestor.id === request.selectedCommonAncestorId,
  )
    ? request.selectedCommonAncestorId
    : undefined;

  if (from.id === to.id) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "self",
        label: "self",
      },
      [from.id],
      [],
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  if (areSpouses(graph, from.id, to.id)) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "spouse",
        label: "spouse",
      },
      [from.id, to.id],
      [
        {
          from: from.id,
          relation: PRIMARY_SPOUSE_RELATION,
          to: to.id,
        },
      ],
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  const stepParentPath =
    findStepParentBridgePath(graph, from.id, to.id) ??
    findDirectParentChildPath(
      graph,
      from.id,
      to.id,
      null,
      PRIMARY_PARENT_RELATION,
      isStepParentEdge,
    );
  if (stepParentPath) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "stepParent",
        label: "step-parent",
      },
      stepParentPath.nodeIds,
      stepParentPath.edges,
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  const stepChildPath =
    findStepChildBridgePath(graph, from.id, to.id) ??
    findDirectParentChildPath(
      graph,
      to.id,
      from.id,
      null,
      PRIMARY_PARENT_RELATION,
      isStepParentEdge,
    );
  if (stepChildPath) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "stepChild",
        label: "step-child",
      },
      stepChildPath.nodeIds,
      stepChildPath.edges,
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  const ancestorPath = findShortestRelationshipPath(
    graph,
    to.id,
    from.id,
    "incoming",
  );
  if (ancestorPath) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "ancestor",
        label: formatAncestorLabel(ancestorPath.depth),
        depth: ancestorPath.depth,
      },
      ancestorPath.nodeIds,
      ancestorPath.edges,
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  const descendantPath = findShortestRelationshipPath(
    graph,
    to.id,
    from.id,
    "outgoing",
  );
  if (descendantPath) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "descendant",
        label: formatDescendantLabel(descendantPath.depth),
        depth: descendantPath.depth,
      },
      descendantPath.nodeIds,
      descendantPath.edges,
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  const siblingPath = findSiblingPath(graph, from.id, to.id);
  if (siblingPath) {
    return maybeOverrideWithSelectedCommonAncestor(
      graph,
      {
        from,
        to,
        relationship: {
        type: "sibling",
        label: "sibling",
        },
        pathNodeIds: siblingPath.nodeIds,
        pathEdges: siblingPath.edges,
        highlight: buildSplitHighlight(
          [from.id],
          [siblingPath.edges[0]].filter(Boolean),
          [siblingPath.nodeIds[1]].filter(Boolean),
          [to.id],
          [siblingPath.edges[1]].filter(Boolean),
        ),
      },
      selectedCommonAncestorId,
      availableCommonAncestors,
    );
  }

  const auntUnclePath = findAuntUnclePath(graph, from.id, to.id);
  if (auntUnclePath) {
    return maybeOverrideWithSelectedCommonAncestor(
      graph,
      {
        from,
        to,
        relationship: {
        type: "auntUncle",
        label: "aunt/uncle",
        },
        pathNodeIds: auntUnclePath.nodeIds,
        pathEdges: auntUnclePath.edges,
        highlight: buildSplitHighlight(
          [from.id],
          [auntUnclePath.edges[0]].filter(Boolean),
          auntUnclePath.nodeIds[1] ? [auntUnclePath.nodeIds[1]] : [],
          auntUnclePath.nodeIds.slice(2),
          auntUnclePath.edges.slice(1),
        ),
      },
      selectedCommonAncestorId,
      availableCommonAncestors,
    );
  }

  const nieceNephewPath = findNieceNephewPath(graph, from.id, to.id);
  if (nieceNephewPath) {
    return maybeOverrideWithSelectedCommonAncestor(
      graph,
      {
        from,
        to,
        relationship: {
        type: "nieceNephew",
        label: formatNieceNephewLabel(fromNode),
        },
        pathNodeIds: nieceNephewPath.nodeIds,
        pathEdges: nieceNephewPath.edges,
        highlight: buildSplitHighlight(
          [from.id, nieceNephewPath.nodeIds[1]].filter(Boolean),
          nieceNephewPath.edges.slice(0, 2),
          nieceNephewPath.nodeIds[2] ? [nieceNephewPath.nodeIds[2]] : [],
          nieceNephewPath.nodeIds.slice(3, 4),
          nieceNephewPath.edges.slice(2),
        ),
      },
      selectedCommonAncestorId,
      availableCommonAncestors,
    );
  }

  const cousinPath = findCousinPath(graph, from.id, to.id);
  if (cousinPath) {
    return maybeOverrideWithSelectedCommonAncestor(
      graph,
      {
        from,
        to,
        relationship: {
        type: "cousin",
        label: "cousin",
        },
        pathNodeIds: cousinPath.nodeIds,
        pathEdges: cousinPath.edges,
        highlight: buildSplitHighlight(
          cousinPath.nodeIds.slice(0, 2),
          cousinPath.edges.slice(0, 2),
          cousinPath.nodeIds[2] ? [cousinPath.nodeIds[2]] : [],
          cousinPath.nodeIds.slice(3),
          cousinPath.edges.slice(2),
        ),
      },
      selectedCommonAncestorId,
      availableCommonAncestors,
    );
  }

  const parentInLawPath = findParentInLawPath(graph, from.id, to.id);
  if (parentInLawPath) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "parentInLaw",
        label: "parent-in-law",
      },
      parentInLawPath.nodeIds,
      parentInLawPath.edges,
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  const childInLawPath = findParentInLawPath(graph, to.id, from.id);
  if (childInLawPath) {
    return buildComparisonResult(
      from,
      to,
      {
        type: "childInLaw",
        label: "child-in-law",
      },
      [from.id, childInLawPath.nodeIds[1], to.id],
      childInLawPath.edges,
      emptyHighlight(),
      availableCommonAncestors,
      selectedCommonAncestorId,
    );
  }

  return buildComparisonResult(
    from,
    to,
    {
      type: "unknown",
      label: "of unknown relationship",
    },
    [],
    [],
    emptyHighlight(),
    availableCommonAncestors,
    selectedCommonAncestorId,
  );
}

function buildComparisonResult(
  from: RuntimeRelationshipComparisonResult["from"],
  to: RuntimeRelationshipComparisonResult["to"],
  relationship: RuntimeRelationshipComparisonResult["relationship"],
  pathNodeIds: string[],
  pathEdges: RuntimeRelationshipComparisonResult["pathEdges"],
  highlight: RuntimeRelationshipComparisonResult["highlight"],
  availableCommonAncestors: RuntimeRelationshipComparisonResult["availableCommonAncestors"],
  selectedCommonAncestorId?: string,
): RuntimeRelationshipComparisonResult {
  return {
    from,
    to,
    relationship,
    pathNodeIds,
    pathEdges,
    highlight,
    availableCommonAncestors,
    ...(selectedCommonAncestorId ? { selectedCommonAncestorId } : {}),
  };
}

function maybeOverrideWithSelectedCommonAncestor(
  graph: Graph,
  baseResult: Omit<
    RuntimeRelationshipComparisonResult,
    "availableCommonAncestors" | "selectedCommonAncestorId"
  >,
  selectedCommonAncestorId: string | undefined,
  availableCommonAncestors: RuntimeRelationshipComparisonResult["availableCommonAncestors"],
): RuntimeRelationshipComparisonResult {
  if (!selectedCommonAncestorId) {
    return buildComparisonResult(
      baseResult.from,
      baseResult.to,
      baseResult.relationship,
      baseResult.pathNodeIds,
      baseResult.pathEdges,
      baseResult.highlight,
      availableCommonAncestors,
      undefined,
    );
  }

  const overridePath = buildCommonAncestorOverridePath(
    graph,
    baseResult.from.id,
    baseResult.to.id,
    selectedCommonAncestorId,
  );

  if (!overridePath) {
    return buildComparisonResult(
      baseResult.from,
      baseResult.to,
      baseResult.relationship,
      baseResult.pathNodeIds,
      baseResult.pathEdges,
      baseResult.highlight,
      availableCommonAncestors,
      undefined,
    );
  }

  return buildComparisonResult(
    baseResult.from,
    baseResult.to,
    baseResult.relationship,
    overridePath.pathNodeIds,
    overridePath.pathEdges,
    overridePath.highlight,
    availableCommonAncestors,
    selectedCommonAncestorId,
  );
}

function emptyHighlight(): RuntimeRelationshipComparisonResult["highlight"] {
  return {
    selectedPathNodeIds: [],
    selectedPathEdges: [],
    commonNodeIds: [],
    commonEdges: [],
    targetPathNodeIds: [],
    targetPathEdges: [],
  };
}

function buildSplitHighlight(
  selectedPathNodeIds: string[],
  selectedPathEdges: Array<{ from: string; relation: string; to: string }>,
  commonNodeIds: string[],
  targetPathNodeIds: string[],
  targetPathEdges: Array<{ from: string; relation: string; to: string }>,
): RuntimeRelationshipComparisonResult["highlight"] {
  const commonNodeIdSet = new Set(commonNodeIds);
  const selectedNodeIdSet = new Set(
    selectedPathNodeIds.filter((nodeId) => !commonNodeIdSet.has(nodeId)),
  );
  const targetNodeIdSet = new Set(
    targetPathNodeIds.filter(
      (nodeId) =>
        !commonNodeIdSet.has(nodeId) && !selectedNodeIdSet.has(nodeId),
    ),
  );

  const selectedEdges = uniqueEdges(selectedPathEdges);
  const targetEdges = uniqueEdges(targetPathEdges).filter(
    (edge) => !selectedEdges.some((selectedEdge) => sameEdge(selectedEdge, edge)),
  );

  return {
    selectedPathNodeIds: [...selectedNodeIdSet],
    selectedPathEdges: selectedEdges,
    commonNodeIds: [...commonNodeIdSet],
    commonEdges: [],
    targetPathNodeIds: [...targetNodeIdSet],
    targetPathEdges: targetEdges,
  };
}

function uniqueEdges(
  edges: Array<{ from: string; relation: string; to: string }>,
): Array<{ from: string; relation: string; to: string }> {
  const seen = new Set<string>();
  const result = [];

  for (const edge of edges) {
    const key = getEdgeKey(edge);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(edge);
  }

  return result;
}

function getEdgeKey(edge: { from: string; relation: string; to: string }): string {
  return `${edge.from}|${edge.relation}|${edge.to}`;
}

function sameEdge(
  left: { from: string; relation: string; to: string },
  right: { from: string; relation: string; to: string },
): boolean {
  return getEdgeKey(left) === getEdgeKey(right);
}

function findDirectParentChildPath(
  graph: Graph,
  parentId: string,
  childId: string,
  relations: Set<string> | null,
  relationLabel: string,
  predicate?: (edge: Graph["edges"][number]) => boolean,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  const matchingEdge = getOutgoingEdges(graph, parentId, "branch").find(
    (edge) =>
      edge.object === childId &&
      (predicate
        ? predicate(edge)
        : relations
          ? relations.has(edge.relation)
          : false),
  );

  if (!matchingEdge) {
    return null;
  }

  return {
    nodeIds: [parentId, childId],
    edges: [
      {
        from: parentId,
        relation: relationLabel,
        to: childId,
      },
    ],
  };
}

function findStepParentBridgePath(
  graph: Graph,
  stepParentId: string,
  childId: string,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  const explicitStepEdge = getOutgoingEdges(graph, stepParentId, "branch").find(
    (edge) => isStepParentEdge(edge) && edge.object === childId,
  );
  if (!explicitStepEdge) {
    return null;
  }

  const spouseBridgeId = getSpouseIds(graph, stepParentId).find((spouseId) =>
    getOutgoingEdges(graph, spouseId, "branch").some(
      (edge) => isBirthParentEdge(edge) && edge.object === childId,
    ),
  );

  if (!spouseBridgeId) {
    return null;
  }

  return {
    nodeIds: [stepParentId, spouseBridgeId, childId],
    edges: [
      {
        from: stepParentId,
        relation: PRIMARY_SPOUSE_RELATION,
        to: spouseBridgeId,
      },
      {
        from: spouseBridgeId,
        relation: PRIMARY_PARENT_RELATION,
        to: childId,
      },
    ],
  };
}

function findStepChildBridgePath(
  graph: Graph,
  childId: string,
  stepParentId: string,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  const stepParentPath = findStepParentBridgePath(graph, stepParentId, childId);
  if (!stepParentPath) {
    return null;
  }

  return {
    nodeIds: [childId, stepParentPath.nodeIds[1], stepParentId],
    edges: [
      {
        from: stepParentPath.nodeIds[1],
        relation: PRIMARY_PARENT_RELATION,
        to: childId,
      },
      {
        from: stepParentId,
        relation: PRIMARY_SPOUSE_RELATION,
        to: stepParentPath.nodeIds[1],
      },
    ],
  };
}

export function queryGenealogyCommonAncestors(
  graph: Graph,
  request: RuntimeCommonAncestorsRequest,
): RuntimeCommonAncestorsResult {
  const fromNode = graph.nodes.get(request.fromId);
  const toNode = graph.nodes.get(request.toId);

  if (!fromNode || !toNode) {
    throw new Error("Common ancestor query requires valid fromId and toId");
  }

  const sharedAncestors = collectSharedAncestors(graph, request.fromId, request.toId);

  return {
    format: "commonAncestors",
    from: {
      id: fromNode.id,
      label: computeNodeLabel(fromNode),
    },
    to: {
      id: toNode.id,
      label: computeNodeLabel(toNode),
    },
    count: sharedAncestors.length,
    ancestors: sharedAncestors.map(
      ({ fromDepth: _fromDepth, toDepth: _toDepth, ...ancestor }) => ancestor,
    ),
  };
}

function collectSharedAncestors(
  graph: Graph,
  fromId: string,
  toId: string,
): Array<{
  id: string;
  label: string;
  semanticId?: string;
  contract?: GraphNode["contract"];
  value: GraphNode["value"];
  state: GraphNode["state"];
  meta: GraphNode["meta"];
  fromDepth: number;
  toDepth: number;
}> {
  const fromAncestorDepths = collectAncestorDepths(graph, fromId);
  const toAncestorDepths = collectAncestorDepths(graph, toId);

  return [...fromAncestorDepths.keys()]
    .filter((ancestorId) => toAncestorDepths.has(ancestorId))
    .map((ancestorId) => {
      const node = graph.nodes.get(ancestorId)!;
      return {
        id: node.id,
        label: computeNodeLabel(node),
        semanticId: node.semanticId,
        contract: node.contract
          ? {
              ...(node.contract.in ? { in: [...node.contract.in] } : {}),
              ...(node.contract.out ? { out: [...node.contract.out] } : {}),
            }
          : undefined,
        value: node.value,
        state: node.state,
        meta: node.meta,
        fromDepth: fromAncestorDepths.get(ancestorId) ?? Number.MAX_SAFE_INTEGER,
        toDepth: toAncestorDepths.get(ancestorId) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      const depthDelta =
        left.fromDepth + left.toDepth - (right.fromDepth + right.toDepth);
      if (depthDelta !== 0) {
        return depthDelta;
      }

      const leftOrder = Number(left.meta?.order ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = Number(right.meta?.order ?? Number.MAX_SAFE_INTEGER);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const labelDelta = left.label.localeCompare(right.label);
      if (labelDelta !== 0) {
        return labelDelta;
      }

      return left.id.localeCompare(right.id);
    });
}

function findShortestRelationshipPath(
  graph: Graph,
  startNodeId: string,
  targetNodeId: string,
  direction: "incoming" | "outgoing",
): {
  depth: number;
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  const visited = new Set<string>([startNodeId]);
  const queue: Array<{
    nodeId: string;
    depth: number;
    nodeIds: string[];
    edges: Array<{ from: string; relation: string; to: string }>;
  }> = [
    { nodeId: startNodeId, depth: 0, nodeIds: [startNodeId], edges: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges =
      direction === "incoming"
        ? getIncomingEdges(graph, current.nodeId, "branch")
        : getOutgoingEdges(graph, current.nodeId, "branch");

    for (const edge of edges) {
      if (!isBirthParentEdge(edge)) {
        continue;
      }

      const nextNodeId =
        direction === "incoming" ? edge.subject : edge.object;

      if (visited.has(nextNodeId)) {
        continue;
      }

      const nextDepth = current.depth + 1;
      const pathEdge =
        direction === "incoming"
          ? {
              from: nextNodeId,
              relation: PRIMARY_PARENT_RELATION,
              to: current.nodeId,
            }
          : {
              from: current.nodeId,
              relation: PRIMARY_PARENT_RELATION,
              to: nextNodeId,
            };

      if (nextNodeId === targetNodeId) {
        return {
          depth: nextDepth,
          nodeIds: [...current.nodeIds, nextNodeId],
          edges: [...current.edges, pathEdge],
        };
      }

      visited.add(nextNodeId);
      queue.push({
        nodeId: nextNodeId,
        depth: nextDepth,
        nodeIds: [...current.nodeIds, nextNodeId],
        edges: [...current.edges, pathEdge],
      });
    }
  }

  return null;
}

function areSpouses(graph: Graph, fromId: string, toId: string): boolean {
  return (
    getOutgoingEdges(graph, fromId, "branch").some(
      (edge) => isSpouseEdge(edge) && edge.object === toId,
    ) ||
    getIncomingEdges(graph, fromId, "branch").some(
      (edge) => isSpouseEdge(edge) && edge.subject === toId,
    )
  );
}

function findSiblingPath(
  graph: Graph,
  fromId: string,
  toId: string,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  if (fromId === toId) {
    return null;
  }

  const fromParents = getIncomingEdges(graph, fromId, "branch")
        .filter((edge) => isBirthParentEdge(edge))
    .map((edge) => edge.subject);

  const toParents = new Set(
    getIncomingEdges(graph, toId, "branch")
        .filter((edge) => isBirthParentEdge(edge))
      .map((edge) => edge.subject),
  );

  const sharedParentId = fromParents.find((parentId) => toParents.has(parentId));
  if (!sharedParentId) {
    return null;
  }

  return {
    nodeIds: [fromId, sharedParentId, toId],
    edges: [
      {
        from: sharedParentId,
        relation: PRIMARY_PARENT_RELATION,
        to: fromId,
      },
      {
        from: sharedParentId,
        relation: PRIMARY_PARENT_RELATION,
        to: toId,
      },
    ],
  };
}

function findAuntUnclePath(
  graph: Graph,
  fromId: string,
  toId: string,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  for (const parentId of getParentIds(graph, toId)) {
    const siblingPath = findSiblingPath(graph, fromId, parentId);
    if (!siblingPath) {
      continue;
    }

    return {
      nodeIds: [...siblingPath.nodeIds, toId],
      edges: [
        ...siblingPath.edges,
        {
          from: parentId,
          relation: PRIMARY_PARENT_RELATION,
          to: toId,
        },
      ],
    };
  }

  return null;
}

function findCousinPath(
  graph: Graph,
  fromId: string,
  toId: string,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  for (const fromParentId of getParentIds(graph, fromId)) {
    for (const toParentId of getParentIds(graph, toId)) {
      const siblingPath = findSiblingPath(graph, fromParentId, toParentId);
      if (!siblingPath) {
        continue;
      }

      return {
        nodeIds: [fromId, ...siblingPath.nodeIds, toId],
        edges: [
          {
            from: fromParentId,
            relation: PRIMARY_PARENT_RELATION,
            to: fromId,
          },
          ...siblingPath.edges,
          {
            from: toParentId,
            relation: PRIMARY_PARENT_RELATION,
            to: toId,
          },
        ],
      };
    }
  }

  return null;
}

function findNieceNephewPath(
  graph: Graph,
  fromId: string,
  toId: string,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  for (const parentId of getParentIds(graph, fromId)) {
    const siblingPath = findSiblingPath(graph, parentId, toId);
    if (!siblingPath) {
      continue;
    }

    return {
      nodeIds: [fromId, ...siblingPath.nodeIds],
      edges: [
        {
          from: parentId,
          relation: PRIMARY_PARENT_RELATION,
          to: fromId,
        },
        ...siblingPath.edges,
      ],
    };
  }

  return null;
}

function findParentInLawPath(
  graph: Graph,
  fromId: string,
  toId: string,
): {
  nodeIds: string[];
  edges: Array<{ from: string; relation: string; to: string }>;
} | null {
  const childIds = getOutgoingEdges(graph, fromId, "branch")
    .filter((edge) => isBirthParentEdge(edge))
    .map((edge) => edge.object);

  for (const childId of childIds) {
    if (!areSpouses(graph, childId, toId)) {
      continue;
    }

    return {
      nodeIds: [fromId, childId, toId],
      edges: [
        {
          from: fromId,
          relation: PRIMARY_PARENT_RELATION,
          to: childId,
        },
        {
          from: childId,
          relation: PRIMARY_SPOUSE_RELATION,
          to: toId,
        },
      ],
    };
  }

  return null;
}

function getSpouseIds(graph: Graph, nodeId: string): string[] {
  return getOutgoingEdges(graph, nodeId, "branch")
    .filter((edge) => isSpouseEdge(edge))
    .map((edge) => edge.object);
}

function getParentIds(graph: Graph, nodeId: string): string[] {
  return getIncomingEdges(graph, nodeId, "branch")
    .filter((edge) => isBirthParentEdge(edge))
    .map((edge) => edge.subject);
}

function collectAncestorDepths(graph: Graph, startNodeId: string): Map<string, number> {
  const visited = new Set<string>([startNodeId]);
  const depths = new Map<string, number>();
  const queue: Array<{ nodeId: string; depth: number }> = [
    { nodeId: startNodeId, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const parentId of getParentIds(graph, current.nodeId)) {
      if (visited.has(parentId)) {
        continue;
      }

      const nextDepth = current.depth + 1;
      visited.add(parentId);
      depths.set(parentId, nextDepth);
      queue.push({ nodeId: parentId, depth: nextDepth });
    }
  }

  return depths;
}

function buildCommonAncestorOverridePath(
  graph: Graph,
  fromId: string,
  toId: string,
  ancestorId: string,
): {
  pathNodeIds: string[];
  pathEdges: Array<{ from: string; relation: string; to: string }>;
  highlight: RuntimeRelationshipComparisonResult["highlight"];
} | null {
  const fromPath = findUpwardBirthAncestorPath(graph, fromId, ancestorId);
  const toPath = findUpwardBirthAncestorPath(graph, toId, ancestorId);

  if (!fromPath || !toPath) {
    return null;
  }

  const fromDescPath = [...fromPath].reverse();
  const toDescPath = [...toPath].reverse();
  let commonLength = 0;

  while (
    commonLength < fromDescPath.length &&
    commonLength < toDescPath.length &&
    fromDescPath[commonLength] === toDescPath[commonLength]
  ) {
    commonLength += 1;
  }

  if (commonLength === 0) {
    return null;
  }

  const commonNodeIds = fromDescPath.slice(0, commonLength);
  const commonEdges = buildDescendantEdges(commonNodeIds);
  const selectedBranchNodeIds = [...fromDescPath.slice(commonLength)].reverse();
  const targetBranchNodeIds = toDescPath.slice(commonLength);
  const selectedPathEdges = buildDescendantEdges([
    ...commonNodeIds.slice(-1),
    ...fromDescPath.slice(commonLength),
  ]);
  const targetPathEdges = buildDescendantEdges([
    ...commonNodeIds.slice(-1),
    ...toDescPath.slice(commonLength),
  ]);

  return {
    pathNodeIds: uniqueNodeIds([
      ...fromPath,
      ...toDescPath.slice(commonLength),
    ]),
    pathEdges: uniqueEdges([
      ...commonEdges,
      ...selectedPathEdges,
      ...targetPathEdges,
    ]),
    highlight: {
      selectedPathNodeIds: selectedBranchNodeIds,
      selectedPathEdges,
      commonNodeIds,
      commonEdges,
      targetPathNodeIds: targetBranchNodeIds,
      targetPathEdges,
    },
  };
}

function findUpwardBirthAncestorPath(
  graph: Graph,
  startNodeId: string,
  ancestorId: string,
): string[] | null {
  if (startNodeId === ancestorId) {
    return [startNodeId];
  }

  const visited = new Set<string>([startNodeId]);
  const queue: Array<{ nodeId: string; path: string[] }> = [
    { nodeId: startNodeId, path: [startNodeId] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const parentId of getParentIds(graph, current.nodeId)) {
      if (visited.has(parentId)) {
        continue;
      }

      const nextPath = [...current.path, parentId];
      if (parentId === ancestorId) {
        return nextPath;
      }

      visited.add(parentId);
      queue.push({ nodeId: parentId, path: nextPath });
    }
  }

  return null;
}

function buildDescendantEdges(
  nodeIds: string[],
): Array<{ from: string; relation: string; to: string }> {
  if (nodeIds.length < 2) {
    return [];
  }

  const result = [];
  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    result.push({
      from: nodeIds[index],
      relation: PRIMARY_PARENT_RELATION,
      to: nodeIds[index + 1],
    });
  }
  return result;
}

function uniqueNodeIds(nodeIds: string[]): string[] {
  const seen = new Set<string>();
  const result = [];

  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) {
      continue;
    }

    seen.add(nodeId);
    result.push(nodeId);
  }

  return result;
}

function formatAncestorLabel(depth: number): string {
  if (depth === 1) return "parent";
  if (depth === 2) return "grandparent";
  if (depth === 3) return "great grandparent";
  return `great x${depth - 2} grandparent`;
}

function formatDescendantLabel(depth: number): string {
  if (depth === 1) return "child";
  if (depth === 2) return "grandchild";
  if (depth === 3) return "great grandchild";
  return `great x${depth - 2} grandchild`;
}

function computeNodeLabel(node: GraphNode): string {
  const value = isRecord(node.value) ? node.value : null;
  const fullName = typeof value?.fullName === "string" ? value.fullName : null;
  const name = typeof value?.name === "string" ? value.name : null;
  const metaLabel = typeof node.meta?.label === "string" ? node.meta.label : null;

  return (
    fullName ??
    name ??
    metaLabel ??
    node.id
  );
}

function formatNieceNephewLabel(node: GraphNode): string {
  const value = isRecord(node.value) ? node.value : null;
  const gender = typeof value?.gender === "string" ? value.gender.toLowerCase() : null;

  if (gender === "female") {
    return "niece";
  }

  if (gender === "male") {
    return "nephew";
  }

  return "niece/nephew";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
