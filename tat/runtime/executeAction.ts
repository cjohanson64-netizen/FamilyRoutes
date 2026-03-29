import type {
  ActionGuardExprNode,
  ActionPipelineStepNode,
  ActionProjectExprNode,
  ArrayLiteralNode,
  BooleanExprNode,
  BooleanValueNode,
  DeriveBinaryExprNode,
  DeriveCollectExprNode,
  DeriveEdgeCountExprNode,
  DeriveExistsExprNode,
  DerivePathExprNode,
  GraphControlExprNode,
  NodeCaptureNode,
  ObjectLiteralNode,
  PropertyAccessNode,
  StringLiteralNode,
  DeriveSumExprNode,
  ValueExprNode,
} from "../ast/nodeTypes";
import type { ActionRegistry, RuntimeAction } from "./actionRegistry";
import type { Graph, GraphNodeContract, GraphValue } from "./graph";
import {
  addHistoryEntry,
  addBranch,
  addNode,
  addProgress,
  clearEdgeContext,
  cloneGraphValue,
  removeNode,
  setNodeMeta,
  setNodeState,
  setEdgeContext,
  removeBranch,
  removeNodeMeta,
  removeNodeState,
} from "./graph";
import {
  evaluateGraphControlExpr,
  evaluateGraphQuery,
  evaluateLoopCount,
  LOOP_SAFETY_CAP,
} from "./evaluateGraphControl";
import { getAction } from "./actionRegistry";

export interface ActionScope {
  from: string;
  to?: string;
  payload?: Record<string, GraphValue>;
  node?: Record<string, GraphValue>;
}

export interface ActionExecutionResult {
  graph: Graph;
  didRun: boolean;
  project: GraphValue | null;
}

export interface ActionExecutionHooks {
  onGraphMutation?: () => void;
  causedBy?: string;
}

interface ExtractedRuntimeNodeValue {
  semanticId?: string;
  contract?: GraphNodeContract;
  value: GraphValue;
}

export function executeAction(
  graph: Graph,
  action: RuntimeAction,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): ActionExecutionResult {
  if (action.guard) {
    const passes = evaluateActionGuard(action.guard, graph, scope);
    if (!passes) {
      return {
        graph,
        didRun: false,
        project: null,
      };
    }
  }

  for (const step of action.pipeline) {
    executeActionStep(graph, step, scope, actions, hooks);
  }

  const project = action.project
    ? evaluateActionProjectExpr(action.project, graph, scope)
    : null;

  return {
    graph,
    didRun: true,
    project,
  };
}

function executeActionStep(
  graph: Graph,
  step: ActionPipelineStepNode,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  if (step.type === "LoopExpr") {
    executeLoopExpr(graph, step, scope, actions, hooks);
    return;
  }

  if (step.type === "IfExpr") {
    executeIfExpr(graph, step.condition, step.then, step.else, scope, actions, hooks);
    return;
  }

  if (step.type === "WhenExpr") {
    throw new Error("@when is not supported inside @action pipelines");
  }

  switch (step.type) {
    case "RuntimeAddNodeExpr": {
      const nodeId = resolveRuntimeAddNodeTarget(graph, step.node, scope);
      const value = evaluateActionProjectExpr(step.value, graph, scope);
      const extractedValue = extractRuntimeNodeValue(value);
      const stateValue = evaluateActionProjectExpr(step.state, graph, scope);
      const metaValue = evaluateActionProjectExpr(step.meta, graph, scope);

      if (!isRecord(stateValue)) {
        throw new Error("@runtime.addNode state must evaluate to an object");
      }

      if (!isRecord(metaValue)) {
        throw new Error("@runtime.addNode meta must evaluate to an object");
      }

      addNode(graph, {
        id: nodeId,
        semanticId: extractedValue.semanticId,
        contract: cloneNodeContract(extractedValue.contract),
        value: extractedValue.value,
        state: stateValue,
        meta: metaValue,
      });
      addHistoryEntry(
        graph,
        {
          op: "@runtime.addNode",
          payload: {
            nodeId,
            semanticId: extractedValue.semanticId ?? null,
            contract: extractedValue.contract
              ? contractToGraphValue(extractedValue.contract)
              : null,
            value: cloneGraphValue(extractedValue.value),
            state: cloneGraphValue(stateValue),
            meta: cloneGraphValue(metaValue),
          },
        },
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;
    }

    case "RuntimeUpdateNodeValueExpr": {
      const nodeId = resolveScopedIdentifier(step.node.name, scope);
      const patch = evaluateActionProjectExpr(step.patch, graph, scope);

      if (!isRecord(patch)) {
        throw new Error("@runtime.updateNodeValue patch must evaluate to an object");
      }

      const node = graph.nodes.get(nodeId);
      if (!node) {
        throw new Error(`Graph node "${nodeId}" does not exist`);
      }

      if (!isRecord(node.value)) {
        throw new Error(`Graph node "${nodeId}" does not have an object value to update`);
      }

      const beforeValue = cloneGraphValue(node.value);
      node.value = {
        ...node.value,
        ...patch,
      };

      addHistoryEntry(
        graph,
        {
          op: "@runtime.updateNodeValue",
          payload: {
            nodeId,
            patch: cloneGraphValue(patch),
            beforeValue,
            afterValue: cloneGraphValue(node.value),
          },
        },
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;
    }

    case "RuntimeDeleteNodeExpr": {
      const nodeId = resolveScopedIdentifier(step.node.name, scope);
      const node = graph.nodes.get(nodeId);

      if (!node) {
        return;
      }

      const removedEdges = graph.edges
        .filter((edge) => edge.subject === nodeId || edge.object === nodeId)
        .map((edge) => ({
          subject: edge.subject,
          relation: edge.relation,
          object: edge.object,
          kind: edge.kind,
          meta: cloneGraphValue(edge.meta),
        }));

      addHistoryEntry(
        graph,
        {
          op: "@runtime.deleteNode",
          payload: {
            nodeId,
            value: cloneGraphValue(node.value),
            state: cloneGraphValue(node.state),
            meta: cloneGraphValue(node.meta),
            removedEdges: cloneGraphValue(removedEdges),
          },
        },
        { causedBy: hooks?.causedBy },
      );
      removeNode(graph, nodeId);
      hooks?.onGraphMutation?.();
      return;
    }

    case "GraftBranchExpr":
      {
      const metadataValue = step.metadata
        ? evaluateActionProjectExpr(step.metadata, graph, scope)
        : null;
      if (metadataValue !== null && !isRecord(metadataValue)) {
        throw new Error("@graft.branch metadata must evaluate to an object");
      }
      addBranch(
        graph,
        resolveScopedIdentifier(step.subject.name, scope),
        step.relation.value,
        resolveScopedIdentifier(step.object.name, scope),
        {
          causedBy: hooks?.causedBy,
          metadata: metadataValue ?? undefined,
        },
      );
      hooks?.onGraphMutation?.();
      return;
      }

    case "GraftStateExpr":
      setNodeState(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        evaluateActionProjectExpr(step.value, graph, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "GraftMetaExpr":
      setNodeMeta(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        evaluateActionProjectExpr(step.value, graph, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "GraftProgressExpr":
      addProgress(
        graph,
        resolveScopedIdentifier(step.from.name, scope),
        step.relation.value,
        resolveScopedIdentifier(step.to.name, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "PruneBranchExpr":
      {
      const metadataValue = step.metadata
        ? evaluateActionProjectExpr(step.metadata, graph, scope)
        : null;
      if (metadataValue !== null && !isRecord(metadataValue)) {
        throw new Error("@prune.branch metadata must evaluate to an object");
      }
      removeBranch(
        graph,
        resolveScopedIdentifier(step.subject.name, scope),
        step.relation.value,
        resolveScopedIdentifier(step.object.name, scope),
        {
          causedBy: hooks?.causedBy,
          metadata: metadataValue ?? undefined,
        },
      );
      hooks?.onGraphMutation?.();
      return;
      }

    case "PruneStateExpr":
      removeNodeState(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "PruneMetaExpr":
      removeNodeMeta(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "CtxSetExpr":
      setEdgeContext(graph, resolveScopedIdentifier(step.edge.name, scope), evaluateActionProjectExpr(step.context, graph, scope), {
        causedBy: hooks?.causedBy,
      });
      hooks?.onGraphMutation?.();
      return;

    case "CtxClearExpr":
      clearEdgeContext(graph, resolveScopedIdentifier(step.edge.name, scope), {
        causedBy: hooks?.causedBy,
      });
      hooks?.onGraphMutation?.();
      return;

    case "ApplyExpr":
      executeActionApply(graph, step, scope, actions, hooks);
      return;

    case "PruneNodesExpr":
    case "PruneEdgesExpr":
      throw new Error(`${step.name} is not supported inside @action pipelines`);
  }
}

function executeIfExpr(
  graph: Graph,
  condition: GraphControlExprNode | null,
  thenPipeline: Extract<ActionPipelineStepNode, { type: "LoopExpr" }>["pipeline"] | ActionPipelineStepNode[],
  elsePipeline: Extract<ActionPipelineStepNode, { type: "LoopExpr" }>["pipeline"] | ActionPipelineStepNode[] | null,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  if (!condition) {
    throw new Error("@if requires a condition");
  }

  if (!thenPipeline.length) {
    throw new Error("@if requires a then pipeline");
  }

  const branch = evaluateGraphControlExpr(graph, condition, { scope })
    ? thenPipeline
    : elsePipeline;

  if (!branch) {
    return;
  }

  for (const step of branch) {
    executeActionStep(graph, step, scope, actions, hooks);
  }
}

export function evaluateActionGuard(
  expr: ActionGuardExprNode,
  graph: Graph,
  scope: ActionScope,
): boolean {
  if (expr.type === "GraphQueryExpr") {
    return evaluateGraphQuery(graph, expr, { scope });
  }

  switch (expr.type) {
    case "BinaryBooleanExpr":
      if (expr.operator === "&&") {
        return (
          evaluateActionGuard(expr.left, graph, scope) &&
          evaluateActionGuard(expr.right, graph, scope)
        );
      }
      return (
        evaluateActionGuard(expr.left, graph, scope) ||
        evaluateActionGuard(expr.right, graph, scope)
      );

    case "UnaryBooleanExpr":
      return !evaluateActionGuard(expr.argument, graph, scope);

    case "GroupedBooleanExpr":
      return evaluateActionGuard(expr.expression, graph, scope);

    case "ComparisonExpr": {
      const left = evaluateBooleanValue(expr.left, graph, scope);
      const right = evaluateBooleanValue(expr.right, graph, scope);

      switch (expr.operator) {
        case "==":
          return compareCaseInsensitive(left, right);
        case "===":
          return compareStrict(left, right);
        case "!=":
          return !compareCaseInsensitive(left, right);
        case "!==":
          return !compareStrict(left, right);
        case "<":
          return compareNumeric("<", left, right);
        case "<=":
          return compareNumeric("<=", left, right);
        case ">":
          return compareNumeric(">", left, right);
        case ">=":
          return compareNumeric(">=", left, right);
      }
    }

    case "Identifier":
      return truthy(resolveIdentifierValue(expr.name, graph, scope));

    case "PropertyAccess":
      return truthy(resolvePropertyAccess(expr, graph, scope));

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
      return truthy(evaluateActionDeriveExpr(graph, expr, scope));
    default:
      return exhaustiveNever(expr);
  }
}

function executeLoopExpr(
  graph: Graph,
  loop: Extract<ActionPipelineStepNode, { type: "LoopExpr" }>,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  if (!loop.pipeline.length) {
    throw new Error("@loop requires a pipeline section");
  }

  if (!loop.until && !loop.count) {
    throw new Error("@loop requires at least one of count or until");
  }

  const count = loop.count
    ? evaluateLoopCount(graph, loop.count, { scope })
    : null;

  let iterations = 0;

  while (true) {
    if (loop.until && evaluateGraphQuery(graph, loop.until, { scope })) {
      return;
    }

    if (count !== null && iterations >= count) {
      return;
    }

    if (iterations >= LOOP_SAFETY_CAP) {
      throw new Error(`@loop exceeded safety cap of ${LOOP_SAFETY_CAP} iterations`);
    }

    for (const step of loop.pipeline) {
      executeActionStep(graph, step, scope, actions, hooks);
    }

    iterations += 1;
  }
}

function executeActionApply(
  graph: Graph,
  mutation: Extract<ActionPipelineStepNode, { type: "ApplyExpr" }>,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  const targetValue = evaluateActionApplyTarget(mutation.target, scope, actions);

  if (!isRecord(targetValue) || targetValue.kind !== "traversal") {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  if (!Array.isArray(targetValue.steps)) {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  if (targetValue.steps.length === 0) {
    throw new Error(`@apply traversal must contain at least one step`);
  }

  const firstStep = targetValue.steps[0];

  if (!isRecord(firstStep) || typeof firstStep.binding !== "string") {
    throw new Error(`@apply traversal step is missing an action binding`);
  }

  if (typeof firstStep.fromRef !== "string") {
    throw new Error(`@apply traversal step is missing fromRef`);
  }

  if (typeof firstStep.toRef !== "string") {
    throw new Error(`@apply traversal step is missing toRef`);
  }

  const action = getAction(actions, firstStep.binding);

  if (!action) {
    throw new Error(`@apply could not find action "${firstStep.binding}"`);
  }

  const applyEvent = addHistoryEntry(
    graph,
    {
      op: "@apply",
      payload: {
        from: firstStep.fromRef,
        action: firstStep.binding,
        to: firstStep.toRef,
      },
    },
    { causedBy: hooks?.causedBy },
  );

  executeAction(
    graph,
    action,
    { from: firstStep.fromRef, to: firstStep.toRef, payload: scope.payload },
    actions,
    {
      ...hooks,
      causedBy: applyEvent.id,
    },
  );
}

function evaluateBooleanValue(
  value: BooleanValueNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  switch (value.type) {
    case "Identifier":
      return resolveIdentifierValue(value.name, graph, scope);
    case "PropertyAccess":
      return resolvePropertyAccess(value, graph, scope);
    case "StringLiteral":
      return value.value;
    case "NumberLiteral":
      return value.value;
    case "BooleanLiteral":
      return value.value;
    case "RegexLiteral":
      return value.raw;
    case "DeriveStateExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DeriveMetaExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DeriveCountExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DeriveEdgeCountExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DeriveExistsExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DerivePathExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DeriveCollectExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DeriveSumExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    case "DeriveBinaryExpr":
      return evaluateActionDeriveExpr(graph, value, scope);
    default:
      return exhaustiveNever(value);
  }
}

function evaluateActionDeriveExpr(
  graph: Graph,
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
  scope: ActionScope,
): GraphValue {
  switch (expr.type) {
    case "DeriveStateExpr": {
      if (!expr.node || !expr.key) {
        throw new Error("@derive.state requires node and key");
      }
      const nodeId = resolveScopedIdentifier(expr.node.name, scope);
      const node = graph.nodes.get(nodeId);
      if (!node) {
        throw new Error(`Graph node "${nodeId}" does not exist`);
      }
      if (!Object.prototype.hasOwnProperty.call(node.state, expr.key.value)) {
        throw new Error(
          `@derive.state could not find state key "${expr.key.value}" on node "${nodeId}"`,
        );
      }
      return node.state[expr.key.value];
    }

    case "DeriveMetaExpr": {
      if (!expr.node || !expr.key) {
        throw new Error("@derive.meta requires node and key");
      }
      const nodeId = resolveScopedIdentifier(expr.node.name, scope);
      const node = graph.nodes.get(nodeId);
      if (!node) {
        throw new Error(`Graph node "${nodeId}" does not exist`);
      }
      if (!Object.prototype.hasOwnProperty.call(node.meta, expr.key.value)) {
        throw new Error(
          `@derive.meta could not find meta key "${expr.key.value}" on node "${nodeId}"`,
        );
      }
      return node.meta[expr.key.value];
    }

    case "DeriveCountExpr": {
      if (!expr.nodes) {
        throw new Error("@derive.count requires a nodes field");
      }
      return evaluateActionDerivePath(graph, expr.nodes, scope).length;
    }

    case "DeriveEdgeCountExpr": {
      if (!expr.node || !expr.relation || !expr.direction) {
        throw new Error("@derive.edgeCount requires node, relation, and direction");
      }
      const nodeId = resolveScopedIdentifier(expr.node.name, scope);
      const relation = expr.relation.value;
      const matchingEdges = graph.edges.filter((edge) => {
        if (edge.relation !== relation) {
          return false;
        }
        if (expr.direction?.value === "incoming" && edge.object !== nodeId) {
          return false;
        }
        if (expr.direction?.value === "outgoing" && edge.subject !== nodeId) {
          return false;
        }
        if (!expr.where) {
          return true;
        }
        return evaluateActionEdgeWhereExpr(graph, edge, expr.where, scope);
      });
      if (expr.direction.value === "incoming" || expr.direction.value === "outgoing") {
        return matchingEdges.length;
      }
      throw new Error('@derive.edgeCount direction must be "incoming" or "outgoing"');
    }

    case "DeriveExistsExpr":
      if (!expr.path) {
        throw new Error("@derive.exists requires a path field");
      }
      return evaluateActionDerivePath(graph, expr.path, scope).length > 0;

    case "DerivePathExpr":
      return evaluateActionDerivePath(graph, expr, scope);

    case "DeriveCollectExpr":
      return evaluateActionDeriveCollect(graph, expr, scope);

    case "DeriveSumExpr":
      return evaluateActionDeriveSum(graph, expr, scope);

    case "DeriveBinaryExpr": {
      const left = evaluateActionDeriveOperand(graph, expr.left, scope);
      const right = evaluateActionDeriveOperand(graph, expr.right, scope);

      if (expr.operator === "+") {
        if (typeof left === "number" && typeof right === "number") {
          return left + right;
        }
        if (typeof left === "string" || typeof right === "string") {
          return `${stringifyGraphValue(left)}${stringifyGraphValue(right)}`;
        }
        throw new Error('Derive operator "+" requires number or string operands');
      }

      return evaluateActionNumericBinary(expr.operator, left, right);
    }
  }

  return exhaustiveNever(expr);
}

function evaluateActionDerivePath(
  graph: Graph,
  expr: DerivePathExprNode,
  scope: ActionScope,
): string[] {
  if (!expr.node || !expr.relation || !expr.direction || !expr.depth) {
    throw new Error("@derive.path requires node, relation, direction, and depth");
  }

  const startNodeId = resolveScopedIdentifier(expr.node.name, scope);
  const relations = resolveActionPathRelations(expr.relation);
  const direction = expr.direction.value;
  const maxDepth = expr.depth.value;

  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error("@derive.path depth must be an integer >= 1");
  }

  if (direction !== "incoming" && direction !== "outgoing" && direction !== "both") {
    throw new Error('@derive.path direction must be "incoming", "outgoing", or "both"');
  }

  const visited = new Set<string>([startNodeId]);
  const results = new Set<string>();
  let frontier = [startNodeId];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const nextFrontier: string[] = [];

    for (const currentNodeId of frontier) {
      for (const nextNodeId of collectActionPathNeighbors(graph, currentNodeId, relations, direction)) {
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
    evaluateActionPathWhereExpr(graph, candidateId, expr.where!, scope),
  );
}

function evaluateActionDeriveCollect(
  graph: Graph,
  expr: DeriveCollectExprNode,
  scope: ActionScope,
): GraphValue[] {
  if (!expr.path || !expr.layer || !expr.key) {
    throw new Error("@derive.collect requires path, layer, and key");
  }

  const layer = expr.layer.value;
  if (layer !== "value" && layer !== "state" && layer !== "meta") {
    throw new Error('@derive.collect layer must be "value", "state", or "meta"');
  }

  const values: GraphValue[] = [];
  for (const nodeId of evaluateActionDerivePath(graph, expr.path, scope)) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    const source =
      layer === "value" ? node.value : layer === "state" ? node.state : node.meta;
    if (!isRecord(source) || !Object.prototype.hasOwnProperty.call(source, expr.key.value)) {
      continue;
    }
    values.push(source[expr.key.value]);
  }

  return values;
}

function evaluateActionDeriveSum(
  graph: Graph,
  expr: DeriveSumExprNode,
  scope: ActionScope,
): number {
  if (!expr.collect) {
    throw new Error("@derive.sum requires a collect field");
  }

  let total = 0;
  for (const value of evaluateActionDeriveCollect(graph, expr.collect, scope)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("@derive.sum requires all collected values to be numeric");
    }
    total += value;
  }

  return total;
}

function evaluateActionDeriveOperand(
  graph: Graph,
  expr: DeriveBinaryExprNode["left"],
  scope: ActionScope,
): GraphValue {
  switch (expr.type) {
    case "CurrentValue":
      throw new Error('"current" is only available inside effect derive expressions');
    case "PreviousValue":
      throw new Error('"previous" is only available inside effect derive expressions');
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
      return evaluateActionDeriveExpr(graph, expr, scope);
    default:
      return exhaustiveNever(expr);
  }
}

function evaluateActionNumericBinary(
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

function resolveActionPathRelations(
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

function collectActionPathNeighbors(
  graph: Graph,
  nodeId: string,
  relations: string[],
  direction: "incoming" | "outgoing" | "both",
): string[] {
  const relationSet = new Set(relations);
  const neighbors = new Set<string>();

  if (direction === "outgoing" || direction === "both") {
    for (const edge of graph.edges) {
      if (edge.subject === nodeId && relationSet.has(edge.relation)) {
        neighbors.add(edge.object);
      }
    }
  }

  if (direction === "incoming" || direction === "both") {
    for (const edge of graph.edges) {
      if (edge.object === nodeId && relationSet.has(edge.relation)) {
        neighbors.add(edge.subject);
      }
    }
  }

  return [...neighbors];
}

function evaluateActionPathWhereExpr(
  graph: Graph,
  nodeId: string,
  where: BooleanExprNode,
  scope: ActionScope,
): boolean {
  const node = graph.nodes.get(nodeId);
  if (!node) {
    return false;
  }

  const localScope: ActionScope = {
    ...scope,
    node: {
      id: node.id,
      value: node.value,
      state: node.state,
      meta: node.meta,
    },
  };

  switch (where.type) {
    case "BinaryBooleanExpr":
    case "UnaryBooleanExpr":
    case "GroupedBooleanExpr":
    case "ComparisonExpr":
      return evaluateActionGuard(where, graph, localScope);
    default: {
      const result = evaluateBooleanValue(where, graph, localScope);
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

function evaluateActionProjectExpr(
  expr: ActionProjectExprNode | ValueExprNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  switch (expr.type) {
    case "Identifier":
      return resolveIdentifierValue(expr.name, graph, scope);

    case "PropertyAccess":
      return resolvePropertyAccess(expr, graph, scope);

    case "StringLiteral":
      return expr.value;

    case "NumberLiteral":
      return expr.value;

    case "BooleanLiteral":
      return expr.value;

    case "RuntimeGenerateValueIdExpr":
      return generateRuntimeValueId(expr, scope);

    case "RuntimeNextOrderExpr":
      return getNextRuntimeOrder(graph);

    case "NodeCapture":
      return printNodeCapture(expr);

    case "ObjectLiteral":
      return evaluateObjectLiteralProject(expr, graph, scope);

    case "ArrayLiteral":
      return evaluateArrayLiteralProject(expr, graph, scope);

    case "RuntimeGenerateNodeIdExpr":
      return `@runtime.generateNodeId(${expr.prefix?.raw ?? ""})`;

    case "WhereExpr":
      throw new Error(`@where is not supported inside @action project expressions`);

    default:
      return exhaustiveNever(expr);
  }
}

function evaluateArrayLiteralProject(
  expr: ArrayLiteralNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  return expr.elements.map((el) => evaluateActionProjectExpr(el, graph, scope));
}

function evaluateObjectLiteralProject(
  expr: ObjectLiteralNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  const out: Record<string, GraphValue> = {};

  for (const prop of expr.properties) {
    out[prop.key] = evaluateActionProjectExpr(prop.value, graph, scope);
  }

  return out;
}

function resolveIdentifierValue(
  name: string,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  if (name === "node" && scope.node) {
    return scope.node;
  }
  if (name === "payload") {
    return scope.payload ?? {};
  }
  const resolved = resolveScopedIdentifier(name, scope);
  return resolved;
}

function generateRuntimeValueId(
  expr: Extract<ActionProjectExprNode, { type: "RuntimeGenerateValueIdExpr" }>,
  scope: ActionScope,
): string {
  const prefix = expr.prefix?.value?.trim() || "value";
  const sanitizedTarget = resolveScopedIdentifier("to", scope)
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${prefix}_${sanitizedTarget || "node"}`;
}

function generateRuntimeNodeId(
  graph: Graph,
  expr: { prefix: { value: string } | null },
): string {
  const prefix = expr.prefix?.value?.trim() || "node";
  const counter = graph.history.length + 1;
  return `${prefix}Node_${counter}`;
}

function getNextRuntimeOrder(graph: Graph): number {
  const highest = Array.from(graph.nodes.values()).reduce((max, node) => {
    const order = node.meta?.order;
    return typeof order === "number" && Number.isFinite(order)
      ? Math.max(max, order)
      : max;
  }, 0);

  return highest + 1;
}

function resolveScopedIdentifier(name: string, scope: ActionScope): string {
  if (name === "from") return scope.from;
  if (name === "to") {
    if (!scope.to) {
      throw new Error('Action scope is missing "to"');
    }
    return scope.to;
  }
  if (name === "node" && scope.node) {
    const nodeId = scope.node.id;
    if (typeof nodeId === "string") {
      return nodeId;
    }
    throw new Error('Action scope "node" is missing a string id');
  }
  return name;
}

function evaluateActionEdgeWhereExpr(
  graph: Graph,
  edge: Graph["edges"][number],
  where: BooleanExprNode,
  scope: ActionScope,
): boolean {
  const result = evaluateGraphControlExpr(graph, where, {
    scope,
    bindings: {
      values: new Map([
        [
          "edge",
          {
            id: edge.id,
            from: edge.subject,
            to: edge.object,
            relation: edge.relation,
            kind: edge.kind,
            meta: cloneGraphValue(edge.meta),
            context: edge.context === null ? null : cloneGraphValue(edge.context),
          },
        ],
      ]),
      nodes: new Map(),
    },
  });

  if (typeof result !== "boolean") {
    throw new Error("@derive.edgeCount where must evaluate to a boolean");
  }

  return result;
}

function resolveRuntimeAddNodeTarget(
  graph: Graph,
  target: Extract<ActionPipelineStepNode, { type: "RuntimeAddNodeExpr" }>["node"],
  scope: ActionScope,
): string {
  if (target.type === "Identifier") {
    return resolveScopedIdentifier(target.name, scope);
  }

  if (scope.to) {
    return scope.to;
  }

  const generatedNodeId = generateRuntimeNodeId(graph, target);
  scope.to = generatedNodeId;
  return generatedNodeId;
}

function resolvePropertyAccess(
  access: PropertyAccessNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  const base = resolveIdentifierValue(access.object.name, graph, scope);

  if (isRecord(base)) {
    return dig(base, access.chain.map((part) => part.name));
  }

  if (typeof base === "string" && graph.nodes.has(base)) {
    const node = graph.nodes.get(base)!;
    const first = access.chain[0]?.name;
    if (!first) return null;

    if (first === "state") {
      return dig(node.state, access.chain.slice(1).map((p) => p.name));
    }

    if (first === "meta") {
      return dig(node.meta, access.chain.slice(1).map((p) => p.name));
    }

    if (first === "value") {
      return dig(node.value, access.chain.slice(1).map((p) => p.name));
    }

    if (first in node.state) {
      return dig(node.state, access.chain.map((p) => p.name));
    }

    if (first in node.meta) {
      return dig(node.meta, access.chain.map((p) => p.name));
    }

    if (isRecord(node.value) && first in node.value) {
      return dig(node.value, access.chain.map((p) => p.name));
    }
  }

  return null;
}

function evaluateActionValue(
  value: ValueExprNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  switch (value.type) {
    case "Identifier":
      return resolveIdentifierValue(value.name, graph, scope);
    case "PropertyAccess":
      return resolvePropertyAccess(value, graph, scope);
    case "StringLiteral":
    case "NumberLiteral":
    case "BooleanLiteral":
      return value.value;
    case "ObjectLiteral": {
      const out: Record<string, GraphValue> = {};
      for (const property of value.properties) {
        out[property.key] = evaluateActionValue(property.value, graph, scope);
      }
      return out;
    }
    case "ArrayLiteral":
      return value.elements.map((element) => evaluateActionValue(element, graph, scope));
    default:
      throw new Error(`Unsupported value expression "${value.type}" in action derive filter`);
  }
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

function evaluateActionApplyTarget(
  target: Extract<ActionPipelineStepNode, { type: "ApplyExpr" }>["target"],
  scope: ActionScope,
  actions: ActionRegistry,
): GraphValue {
  if (target.type === "Identifier") {
    return resolveScopedIdentifier(target.name, scope);
  }

  if (target.shape.type !== "TraversalExpr") {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  return {
    kind: "traversal",
    source: printScopedTraversal(target.shape, scope),
    steps: target.shape.segments.map((segment) => {
      const actionSegment =
        segment.type === "ActionSegment" ? segment : segment.segment;
      const binding = actionSegment.operator.name;
      const action = getAction(actions, binding);
      const fromRef = resolveTraversalRef(actionSegment.from, scope);
      const toRef = resolveTraversalRef(actionSegment.to, scope);

      return {
        kind: segment.type === "ActionSegment" ? "action" : "context",
        ...(segment.type === "ContextLift" ? { context: segment.context.name } : {}),
        binding,
        callee: action ? action.bindingName : binding,
        fromRef,
        toRef,
        from: evaluateScopedActionValue(actionSegment.from, scope),
        to: evaluateScopedActionValue(actionSegment.to, scope),
        action: action ? runtimeActionToValue(action) : null,
      };
    }),
  };
}

function evaluateScopedActionValue(
  expr: ValueExprNode,
  scope: ActionScope,
): GraphValue {
  switch (expr.type) {
    case "Identifier":
      return resolveScopedIdentifier(expr.name, scope);
    case "StringLiteral":
      return expr.value;
    case "NumberLiteral":
      return expr.value;
    case "BooleanLiteral":
      return expr.value;
    case "PropertyAccess":
      return printPropertyAccess(expr);
    case "RuntimeGenerateNodeIdExpr":
      return `@runtime.generateNodeId(${expr.prefix?.raw ?? ""})`;
    case "RuntimeGenerateValueIdExpr":
      return `@runtime.generateValueId(${expr.prefix?.raw ?? ""})`;
    case "RuntimeNextOrderExpr":
      return "@runtime.nextOrder()";
    case "NodeCapture":
      return printNodeCapture(expr);
    case "ObjectLiteral": {
      const out: Record<string, GraphValue> = {};
      for (const prop of expr.properties) {
        out[prop.key] = evaluateScopedActionValue(prop.value, scope);
      }
      return out;
    }
    case "ArrayLiteral":
      return expr.elements.map((item) => evaluateScopedActionValue(item, scope));
    case "WhereExpr":
      throw new Error(`@where is not supported inside @apply traversal values`);
    default:
      return exhaustiveNever(expr);
  }
}

function resolveTraversalRef(expr: ValueExprNode, scope: ActionScope): string | null {
  if (expr.type === "Identifier") {
    return resolveScopedIdentifier(expr.name, scope);
  }

  return null;
}

function printScopedTraversal(
  expr: NodeCaptureNode["shape"] & { type: "TraversalExpr" },
  scope: ActionScope,
): string {
  return expr.segments
    .map((segment) => {
      const actionSegment =
        segment.type === "ActionSegment" ? segment : segment.segment;
      const chunk = `${printScopedTraversalValue(actionSegment.from, scope)}.${actionSegment.operator.name}.${printScopedTraversalValue(actionSegment.to, scope)}`;

      if (segment.type === "ContextLift") {
        return `..${segment.context.name}..${chunk}`;
      }

      return chunk;
    })
    .join("");
}

function printPropertyAccess(expr: PropertyAccessNode): string {
  return `${expr.object.name}.${expr.chain.map((part) => part.name).join(".")}`;
}

function printScopedTraversalValue(expr: ValueExprNode, scope: ActionScope): string {
  switch (expr.type) {
    case "Identifier":
      return resolveScopedIdentifier(expr.name, scope);
    case "StringLiteral":
      return expr.raw;
    case "NumberLiteral":
      return expr.raw;
    case "BooleanLiteral":
      return expr.raw;
    case "PropertyAccess":
      return printPropertyAccess(expr);
    case "RuntimeGenerateNodeIdExpr":
      return `@runtime.generateNodeId(${expr.prefix?.raw ?? ""})`;
    case "RuntimeGenerateValueIdExpr":
      return `@runtime.generateValueId(${expr.prefix?.raw ?? ""})`;
    case "RuntimeNextOrderExpr":
      return "@runtime.nextOrder()";
    case "NodeCapture":
      return printNodeCapture(expr);
    case "ObjectLiteral":
      return "<{...}>";
    case "ArrayLiteral":
      return "[...]";
    case "WhereExpr":
      return "@where(...)";
    default:
      return exhaustiveNever(expr);
  }
}

function runtimeActionToValue(action: RuntimeAction): GraphValue {
  return {
    bindingName: action.bindingName,
    guard: action.guard ? astNodeToValue(action.guard) : null,
    pipeline: action.pipeline.map((step) => astNodeToValue(step)),
    project: action.project ? astNodeToValue(action.project) : null,
  };
}

function astNodeToValue(node: unknown): GraphValue {
  if (node === null) return null;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => astNodeToValue(item));
  }
  if (typeof node !== "object") {
    return null;
  }

  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "span") continue;
    out[key] = astNodeToValue(value);
  }
  return out;
}

function compareStrict(a: GraphValue, b: GraphValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compareCaseInsensitive(a: GraphValue, b: GraphValue): boolean {
  return JSON.stringify(normalizeCaseInsensitive(a)) === JSON.stringify(normalizeCaseInsensitive(b));
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
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map((item) => normalizeCaseInsensitive(item));
  if (isRecord(value)) {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = normalizeCaseInsensitive(v);
    }
    return out;
  }
  return value;
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

function graphValueEquals(left: GraphValue, right: GraphValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: GraphValue): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRuntimeNodeValue(value: GraphValue): ExtractedRuntimeNodeValue {
  if (!isRecord(value)) {
    return { value };
  }

  const nextValue = cloneGraphValue(value);
  const semanticIdValue = nextValue.semanticId;
  const contractValue = nextValue.contract;

  if (semanticIdValue !== undefined && typeof semanticIdValue !== "string") {
    throw new Error("semanticId must be a string when present on a runtime node value");
  }

  if (contractValue !== undefined && !isNodeContractValue(contractValue)) {
    throw new Error("contract must be an object with optional string-array in/out fields");
  }

  delete nextValue.semanticId;
  delete nextValue.contract;

  return {
    ...(typeof semanticIdValue === "string" ? { semanticId: semanticIdValue } : {}),
    ...(contractValue ? { contract: normalizeNodeContract(contractValue) } : {}),
    value: nextValue,
  };
}

function isNodeContractValue(value: GraphValue): value is Record<string, GraphValue> {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.in !== undefined &&
    (!Array.isArray(value.in) || value.in.some((item) => typeof item !== "string"))
  ) {
    return false;
  }

  if (
    value.out !== undefined &&
    (!Array.isArray(value.out) || value.out.some((item) => typeof item !== "string"))
  ) {
    return false;
  }

  return true;
}

function normalizeNodeContract(value: Record<string, GraphValue>): GraphNodeContract {
  return {
    ...(Array.isArray(value.in) ? { in: [...value.in] as string[] } : {}),
    ...(Array.isArray(value.out) ? { out: [...value.out] as string[] } : {}),
  };
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

function contractToGraphValue(contract: GraphNodeContract): GraphValue {
  return {
    ...(contract.in ? { in: [...contract.in] } : {}),
    ...(contract.out ? { out: [...contract.out] } : {}),
  };
}

function printNodeCapture(node: NodeCaptureNode): string {
  switch (node.shape.type) {
    case "Identifier":
      return `<${node.shape.name}>`;
    case "StringLiteral":
      return `<${node.shape.raw}>`;
    case "NumberLiteral":
      return `<${node.shape.raw}>`;
    case "BooleanLiteral":
      return `<${node.shape.raw}>`;
    case "ObjectLiteral":
      return "<{...}>";
    case "TraversalExpr":
      return "<traversal>";
    default:
      return exhaustiveNever(node.shape);
  }
}

function exhaustiveNever(value: never): never {
  throw new Error(`Unexpected node shape: ${String(value)}`);
}
