/* global require, module */
"use strict";

const { printAST } = require("./dist/ast/printAST");
const { tokenize } = require("./dist/lexer/tokenize");
const { parse, ParseError } = require("./dist/parser/parse");
const {
  applyRuntimeAction,
  executeProgram,
  reprojectRuntimeState,
  setRuntimeFocus,
} = require("./dist/runtime/executeProgram");
const {
  addBranch,
  addNode,
  addProgress,
  cloneGraph,
  graphToDebugObject,
  removeNode,
} = require("./dist/runtime/graph");
const { validateProgram } = require("./dist/runtime/validateProgram");

function tokenizeTat(source) {
  return tokenize(source);
}

function parseTatToAst(source) {
  return parse(tokenizeTat(source));
}

function printTatAst(source) {
  return printAST(parseTatToAst(source));
}

function parseTat(source) {
  const tokens = tokenizeTat(source);
  const ast = parse(tokens);
  const printedAst = printAST(ast);

  return {
    source,
    tokens,
    ast,
    printedAst,
  };
}

function executeTat(source) {
  return inspectTatRuntimeSession(createTatRuntimeSession(source));
}

function createTatRuntimeSession(source) {
  const parsed = parseTat(source);
  const validation = validateProgram(parsed.ast);
  const errors = validation.filter((issue) => issue.severity === "error");

  if (errors.length > 0) {
    const message = errors
      .map((issue) =>
        issue.span?.line && issue.span?.column
          ? `${issue.message} at ${issue.span.line}:${issue.span.column}`
          : issue.message,
      )
      .join("\n");

    throw new Error(`Validation failed:\n${message}`);
  }

  const execution = executeProgram(parsed.ast);

  return {
    ...parsed,
    validation,
    state: execution.state,
  };
}

function inspectTatRuntimeSession(session, options) {
  const execution = { state: session.state };
  const currentProjections = reprojectRuntimeState(session.ast, session.state, options);
  const graphs = {};

  for (const [name, graph] of session.state.graphs.entries()) {
    graphs[name] = graphToDebugObject(graph);
  }

  const projections = {};
  for (const [name, projection] of currentProjections.entries()) {
    projections[name] = structuredCloneSafe(projection);
  }

  const graphInteractions = {};
  for (const [name, interaction] of session.state.graphInteractions.entries()) {
    graphInteractions[name] = structuredCloneSafe(interaction);
  }

  const interactionHistory = structuredCloneSafe(session.state.interactionHistory);
  const values = {};

  for (const [name, value] of session.state.bindings.values.entries()) {
    values[name] = structuredCloneSafe(value);
  }

  const nodes = {};
  for (const [name, node] of session.state.bindings.nodes.entries()) {
    nodes[name] = {
      id: node.id,
      value: structuredCloneSafe(node.value),
      state: structuredCloneSafe(node.state),
      meta: structuredCloneSafe(node.meta),
    };
  }

  return {
    ...session,
    execution,
    debug: {
      graphs,
      projections,
      graphInteractions,
      interactionHistory,
      systemRelations: session.state.systemRelations,
      queryResults: session.state.queryResults,
      bindings: {
        values,
        nodes,
      },
    },
  };
}

function applyTatAction(session, request, options) {
  return {
    ...session,
    state: applyRuntimeAction(session.ast, session.state, request, options),
  };
}

function setTatFocus(session, request) {
  return {
    ...session,
    state: setRuntimeFocus(session.ast, session.state, request),
  };
}

function addTatNode(session, request, options) {
  return {
    ...session,
    state: addRuntimeNode(session.ast, session.state, request, options),
  };
}

function addTatEdge(session, request, options) {
  return {
    ...session,
    state: addRuntimeEdge(session.ast, session.state, request, options),
  };
}

function updateTatNodeValue(session, request, options) {
  return {
    ...session,
    state: updateRuntimeNodeValue(session.ast, session.state, request, options),
  };
}

function deleteTatNode(session, request, options) {
  return {
    ...session,
    state: deleteRuntimeNode(session.ast, session.state, request, options),
  };
}

function structuredCloneSafe(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function addRuntimeNode(program, state, request, options) {
  const originalGraph = state.graphs.get(request.graphBinding);
  if (!originalGraph) {
    throw new Error(`Graph "${request.graphBinding}" is not available in runtime state`);
  }

  const graph = cloneGraph(originalGraph);
  addNode(graph, {
    id: request.nodeId,
    value: request.value,
    state: request.state ?? {},
    meta: request.meta ?? {},
  });

  const graphs = new Map(state.graphs);
  graphs.set(request.graphBinding, graph);
  const nextState = {
    ...state,
    graphs,
  };

  return {
    ...nextState,
    projections: reprojectRuntimeState(program, nextState, options),
  };
}

function addRuntimeEdge(program, state, request, options) {
  const originalGraph = state.graphs.get(request.graphBinding);
  if (!originalGraph) {
    throw new Error(`Graph "${request.graphBinding}" is not available in runtime state`);
  }

  const graph = cloneGraph(originalGraph);
  if (request.kind === "progress") {
    addProgress(graph, request.subject, request.relation, request.object);
  } else {
    addBranch(graph, request.subject, request.relation, request.object);
  }

  const graphs = new Map(state.graphs);
  graphs.set(request.graphBinding, graph);
  const nextState = {
    ...state,
    graphs,
  };

  return {
    ...nextState,
    projections: reprojectRuntimeState(program, nextState, options),
  };
}

function updateRuntimeNodeValue(program, state, request, options) {
  const originalGraph = state.graphs.get(request.graphBinding);
  if (!originalGraph) {
    throw new Error(`Graph "${request.graphBinding}" is not available in runtime state`);
  }

  const graph = cloneGraph(originalGraph);
  const node = graph.nodes.get(request.nodeId);
  if (!node) {
    throw new Error(`Graph node "${request.nodeId}" does not exist in graph "${request.graphBinding}"`);
  }

  if (!isGraphRecord(node.value)) {
    throw new Error(`Graph node "${request.nodeId}" does not have an object value to update`);
  }

  node.value = {
    ...node.value,
    ...request.patch,
  };

  const graphs = new Map(state.graphs);
  graphs.set(request.graphBinding, graph);
  const nextState = {
    ...state,
    graphs,
  };

  return {
    ...nextState,
    projections: reprojectRuntimeState(program, nextState, options),
  };
}

function deleteRuntimeNode(program, state, request, options) {
  const originalGraph = state.graphs.get(request.graphBinding);
  if (!originalGraph) {
    throw new Error(`Graph "${request.graphBinding}" is not available in runtime state`);
  }

  const graph = cloneGraph(originalGraph);
  removeNode(graph, request.nodeId);

  const graphs = new Map(state.graphs);
  graphs.set(request.graphBinding, graph);

  const graphFocus = new Map(state.graphFocus);
  if (graphFocus.get(request.graphBinding) === request.nodeId) {
    const fallbackFocus =
      graph.root ?? graph.nodes.keys().next().value ?? null;

    if (fallbackFocus) {
      graphFocus.set(request.graphBinding, fallbackFocus);
    } else {
      graphFocus.delete(request.graphBinding);
    }
  }

  const nextState = {
    ...state,
    graphs,
    graphFocus,
  };

  return {
    ...nextState,
    projections: reprojectRuntimeState(program, nextState, options),
  };
}

function isGraphRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

module.exports = {
  tokenizeTat,
  parseTatToAst,
  printTatAst,
  parseTat,
  executeTat,
  createTatRuntimeSession,
  inspectTatRuntimeSession,
  applyTatAction,
  setTatFocus,
  addTatNode,
  addTatEdge,
  updateTatNodeValue,
  deleteTatNode,
  ParseError,
  tokenize,
  parse,
  printAST,
  executeProgram,
  graphToDebugObject,
  validateProgram,
};
