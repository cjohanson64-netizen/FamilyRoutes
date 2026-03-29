import type {
  ActionProjectExprNode,
  ArrayLiteralNode,
  BooleanLiteralNode,
  IdentifierNode,
  NodeCaptureNode,
  NumberLiteralNode,
  ObjectLiteralNode,
  StringLiteralNode,
  TraversalExprNode,
  ValueExprNode,
  WhereExprNode,
} from "../ast/nodeTypes";
import type { ActionRegistry, RuntimeAction } from "./actionRegistry";
import { getAction } from "./actionRegistry";
import type { GraphNode, GraphNodeContract, GraphValue, NodeId } from "./graph";

export interface RuntimeBindings {
  values: Map<string, GraphValue>;
  nodes: Map<string, GraphNode>;
}

export interface EvaluatedNodeCapture {
  id: NodeId;
  semanticId?: string;
  contract?: GraphNodeContract;
  value: GraphValue;
  node: GraphNode;
}

export function createRuntimeBindings(): RuntimeBindings {
  return {
    values: new Map<string, GraphValue>(),
    nodes: new Map<string, GraphNode>(),
  };
}

export function registerValueBinding(
  bindings: RuntimeBindings,
  name: string,
  value: GraphValue,
): void {
  bindings.values.set(name, deepClone(value));
}

export function registerNodeBinding(
  bindings: RuntimeBindings,
  name: string,
  node: GraphNode,
): void {
  bindings.nodes.set(name, cloneGraphNode(node));
  bindings.values.set(name, deepClone(node.value));
}

export function evaluateNodeCapture(
  name: string,
  capture: NodeCaptureNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): EvaluatedNodeCapture {
  const evaluatedValue = evaluateCapturedShape(capture, bindings, actions);
  const extracted = extractNodeStructure(evaluatedValue);
  const id = name;

  const node: GraphNode = {
    id,
    semanticId: extracted.semanticId,
    contract: cloneNodeContract(extracted.contract),
    value: deepClone(extracted.value),
    state: {},
    meta: {},
  };

  return {
    id,
    semanticId: extracted.semanticId,
    contract: cloneNodeContract(extracted.contract),
    value: extracted.value,
    node,
  };
}

export function evaluateCapturedShape(
  capture: NodeCaptureNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): GraphValue {
  const shape = capture.shape;

  switch (shape.type) {
    case "Identifier":
      return evaluateIdentifier(shape, bindings);

    case "StringLiteral":
      return shape.value;

    case "NumberLiteral":
      return shape.value;

    case "BooleanLiteral":
      return shape.value;

    case "ObjectLiteral":
      return evaluateObjectLiteral(shape, bindings, actions);

    case "TraversalExpr":
      return evaluateTraversalExpr(shape, bindings, actions);

    default:
      return exhaustiveNever(shape);
  }
}

export function evaluateValueExpr(
  expr: ValueExprNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): GraphValue {
  switch (expr.type) {
    case "Identifier":
      return evaluateIdentifier(expr, bindings);

    case "StringLiteral":
      return expr.value;

    case "NumberLiteral":
      return expr.value;

    case "BooleanLiteral":
      return expr.value;

    case "PropertyAccess":
      return `${expr.object.name}.${expr.chain.map((part) => part.name).join(".")}`;

    case "RuntimeGenerateNodeIdExpr":
      return `@runtime.generateNodeId(${expr.prefix?.raw ?? ""})`;

    case "RuntimeGenerateValueIdExpr":
      return `@runtime.generateValueId(${expr.prefix?.raw ?? ""})`;

    case "RuntimeNextOrderExpr":
      return "@runtime.nextOrder()";

    case "NodeCapture":
      return evaluateCapturedShape(expr, bindings, actions);

    case "WhereExpr":
      throw new Error(`@where cannot be evaluated as a plain value expression; use @bind(...) or a query statement`);

    case "ObjectLiteral":
      return evaluateObjectLiteral(expr, bindings, actions);

    case "ArrayLiteral":
      return expr.elements.map((element) => evaluateValueExpr(element, bindings, actions));

    default:
      return exhaustiveNever(expr);
  }
}

function evaluateIdentifier(
  node: IdentifierNode,
  bindings: RuntimeBindings,
): GraphValue {
  if (bindings.values.has(node.name)) {
    return deepClone(bindings.values.get(node.name)!);
  }

  return node.name;
}

function evaluateObjectLiteral(
  node: ObjectLiteralNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): GraphValue {
  const out: Record<string, GraphValue> = {};

  for (const prop of node.properties) {
    out[prop.key] = evaluateValueExpr(prop.value, bindings, actions);
  }

  return out;
}

function evaluateTraversalExpr(
  node: TraversalExprNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): GraphValue {
  const steps: Array<Record<string, GraphValue>> = [];

  for (const segment of node.segments) {
    if (segment.type === "ActionSegment") {
      const action = getAction(actions, segment.operator.name);
      const fromRef = getValueRef(segment.from, bindings);
      const toRef = getValueRef(segment.to, bindings);

      steps.push({
        kind: "action",
        binding: segment.operator.name,
        callee: action ? action.bindingName : segment.operator.name,
        fromRef,
        toRef,
        from: evaluateValueExpr(segment.from, bindings, actions),
        to: evaluateValueExpr(segment.to, bindings, actions),
        action: action ? runtimeActionToValue(action) : null,
      });
      continue;
    }

    const action = getAction(actions, segment.segment.operator.name);
    const fromRef = getValueRef(segment.segment.from, bindings);
    const toRef = getValueRef(segment.segment.to, bindings);

    steps.push({
      kind: "context",
      context: segment.context.name,
      binding: segment.segment.operator.name,
      callee: action ? action.bindingName : segment.segment.operator.name,
      fromRef,
      toRef,
      from: evaluateValueExpr(segment.segment.from, bindings, actions),
      to: evaluateValueExpr(segment.segment.to, bindings, actions),
      action: action ? runtimeActionToValue(action) : null,
    });
  }

  return {
    kind: "traversal",
    source: printTraversalSource(node),
    steps,
  };
}

function getValueRef(
  expr: ValueExprNode,
  bindings: RuntimeBindings,
): string | null {
  switch (expr.type) {
    case "Identifier":
      if (bindings.nodes.has(expr.name)) {
        return expr.name;
      }
      return null;

    case "NodeCapture":
      return null;

    case "WhereExpr":
      return null;

    case "StringLiteral":
    case "NumberLiteral":
    case "BooleanLiteral":
    case "ObjectLiteral":
    case "ArrayLiteral":
    case "PropertyAccess":
    case "RuntimeGenerateNodeIdExpr":
    case "RuntimeGenerateValueIdExpr":
    case "RuntimeNextOrderExpr":
      return null;

    default:
      return exhaustiveNever(expr);
  }
}

function runtimeActionToValue(action: RuntimeAction): GraphValue {
  return {
    bindingName: action.bindingName,
    guard: action.guard ? astNodeToValue(action.guard) : null,
    pipeline: action.pipeline.map((step) => astNodeToValue(step)),
    project: action.project ? astProjectToValue(action.project) : null,
  };
}

function astProjectToValue(node: ActionProjectExprNode): GraphValue {
  return astNodeToValue(node);
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

function printTraversalSource(node: TraversalExprNode): string {
  const parts: string[] = [];

  for (const segment of node.segments) {
    if (segment.type === "ActionSegment") {
      parts.push(
        `${printTraversalValue(segment.from)}.${segment.operator.name}.${printTraversalValue(segment.to)}`,
      );
      continue;
    }

    parts.push(
      `..${segment.context.name}..${printTraversalValue(segment.segment.from)}.${segment.segment.operator.name}.${printTraversalValue(segment.segment.to)}`,
    );
  }

  return parts.join("");
}

function printTraversalValue(expr: ValueExprNode): string {
  switch (expr.type) {
    case "Identifier":
      return expr.name;
    case "StringLiteral":
      return expr.raw;
    case "NumberLiteral":
      return expr.raw;
    case "BooleanLiteral":
      return expr.raw;
    case "NodeCapture":
      return printNodeCapture(expr);
    case "ObjectLiteral":
      return printObjectLiteral(expr);
    case "ArrayLiteral":
      return printArrayLiteral(expr);
    default:
      return "[value]";
  }
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
      return `<${printObjectLiteral(node.shape)}>`;
    case "TraversalExpr":
      return `<${printTraversalSource(node.shape)}>`;
    default:
      return "<capture>";
  }
}

function printObjectLiteral(node: ObjectLiteralNode): string {
  return `{${node.properties
    .map((prop) => `${prop.key}: ${printTraversalValue(prop.value)}`)
    .join(", ")}}`;
}

function printArrayLiteral(node: ArrayLiteralNode): string {
  return `[${node.elements.map((el) => printTraversalValue(el)).join(", ")}]`;
}

function cloneGraphNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    semanticId: node.semanticId,
    contract: cloneNodeContract(node.contract),
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function extractNodeStructure(value: GraphValue): {
  semanticId?: string;
  contract?: GraphNodeContract;
  value: GraphValue;
} {
  if (!isRecordValue(value)) {
    return { value };
  }

  const semanticIdValue = value.semanticId;
  const contractValue = value.contract;

  if (semanticIdValue !== undefined && typeof semanticIdValue !== "string") {
    throw new Error("semanticId must be a string when present on a node capture");
  }

  if (contractValue !== undefined && !isValidNodeContractValue(contractValue)) {
    throw new Error("contract must be an object with optional string-array in/out fields");
  }

  const nextValue = deepCloneRecord(value);
  delete nextValue.semanticId;
  delete nextValue.contract;

  return {
    ...(typeof semanticIdValue === "string" ? { semanticId: semanticIdValue } : {}),
    ...(contractValue ? { contract: normalizeNodeContractValue(contractValue) } : {}),
    value: nextValue,
  };
}

function deepClone<T extends GraphValue>(value: T): T {
  if (value === null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (typeof value === "object") {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = deepClone(v);
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

function isRecordValue(value: GraphValue): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidNodeContractValue(value: GraphValue): boolean {
  if (!isRecordValue(value)) {
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

function normalizeNodeContractValue(value: GraphValue): GraphNodeContract {
  const contractValue = value as Record<string, GraphValue>;

  return {
    ...(Array.isArray(contractValue.in)
      ? { in: contractValue.in.map((item) => String(item)) }
      : {}),
    ...(Array.isArray(contractValue.out)
      ? { out: contractValue.out.map((item) => String(item)) }
      : {}),
  };
}

function exhaustiveNever(value: never): never {
  throw new Error(`Unexpected node: ${JSON.stringify(value)}`);
}
