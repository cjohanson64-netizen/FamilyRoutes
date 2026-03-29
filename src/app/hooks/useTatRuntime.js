import { useEffect, useMemo, useState } from "react";
import {
  deleteTatNode,
  addTatEdge,
  addTatNode,
  applyTatMutationTransaction,
  prepareTatMutationTransaction,
  createTatRuntimeSession,
  inspectTatRuntimeSession,
  applyTatAction,
  compareTatRelationship,
  queryTatCommonAncestors,
  setTatFocus,
  updateTatNodeValue,
} from "../../../tat/browser.ts";

const STORAGE_VERSION = 3;

function createRuntimePayload(
  sourceCode,
  doneActions,
  undoneActions,
  focus,
) {
  return {
    version: STORAGE_VERSION,
    sourceCode,
    doneActions,
    undoneActions,
    focus,
  };
}

function isFocusAction(action) {
  return action?.type === "focus";
}

function isPrimitiveRuntimeAction(action) {
  return [
    "addNode",
    "addEdge",
    "updateNodeValue",
    "deleteNode",
    "action",
  ].includes(action?.type);
}

function isTransactionEntry(entry) {
  return (
    !!entry &&
    typeof entry === "object" &&
    entry.type === "transaction" &&
    typeof entry.label === "string" &&
    Array.isArray(entry.actions)
  );
}

function wrapPrimitiveAction(action, label = "Runtime Action") {
  return {
    type: "transaction",
    label,
    actions: [action],
  };
}

function normalizeHistoryEntries(entries, defaultLabel = "Runtime Action") {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      if (isTransactionEntry(entry)) {
        return {
          type: "transaction",
          label: entry.label,
          actions: (entry.actions ?? []).filter(isPrimitiveRuntimeAction),
        };
      }

      if (isPrimitiveRuntimeAction(entry)) {
        return wrapPrimitiveAction(entry, defaultLabel);
      }

      return null;
    })
    .filter((entry) => entry && entry.actions.length > 0);
}

function isValidFocusPayload(focus) {
  return (
    !!focus &&
    typeof focus === "object" &&
    typeof focus.graphBinding === "string" &&
    typeof focus.nodeId === "string"
  );
}

function extractLatestFocus(actions) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];

    if (isTransactionEntry(action)) {
      const nestedFocus = extractLatestFocus(action.actions ?? []);
      if (nestedFocus) {
        return nestedFocus;
      }
    }

    if (isFocusAction(action) && isValidFocusPayload(action.payload)) {
      return action.payload;
    }
  }

  return null;
}

function stripFocusActions(actions) {
  return actions
    .map((action) => {
      if (isTransactionEntry(action)) {
        return {
          ...action,
          actions: stripFocusActions(action.actions ?? []),
        };
      }

      return action;
    })
    .filter((action) => {
      if (isTransactionEntry(action)) {
        return action.actions.length > 0;
      }

      return !isFocusAction(action);
    });
}

function normalizeHistoryPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: "Imported file must contain a JSON object.",
    };
  }

  if (typeof payload.sourceCode !== "string") {
    return {
      ok: false,
      error: "Imported payload is missing a string sourceCode field.",
    };
  }

  if (payload.version === 1) {
    if (!Array.isArray(payload.actions)) {
      return {
        ok: false,
        error: "Imported payload is missing an actions array.",
      };
    }

    return {
      ok: true,
      value: {
        sourceCode: payload.sourceCode,
        doneActions: normalizeHistoryEntries(
          stripFocusActions(payload.actions),
          "Imported Runtime Action",
        ),
        undoneActions: [],
        focus: extractLatestFocus(payload.actions),
      },
    };
  }

  if (payload.version === 2) {
    if (!Array.isArray(payload.doneActions)) {
      return {
        ok: false,
        error: "Imported payload is missing a doneActions array.",
      };
    }

    if (!Array.isArray(payload.undoneActions)) {
      return {
        ok: false,
        error: "Imported payload is missing an undoneActions array.",
      };
    }

    return {
      ok: true,
      value: {
        sourceCode: payload.sourceCode,
        doneActions: normalizeHistoryEntries(
          stripFocusActions(payload.doneActions),
          "Imported Runtime Action",
        ),
        undoneActions: normalizeHistoryEntries(
          stripFocusActions(payload.undoneActions),
          "Imported Runtime Action",
        ),
        focus: extractLatestFocus(payload.doneActions),
      },
    };
  }

  if (payload.version !== STORAGE_VERSION) {
    return {
      ok: false,
      error: `Unsupported runtime payload version: ${String(payload.version)}`,
    };
  }

  if (!Array.isArray(payload.doneActions)) {
    return {
      ok: false,
      error: "Imported payload is missing a doneActions array.",
    };
  }

  if (!Array.isArray(payload.undoneActions)) {
    return {
      ok: false,
      error: "Imported payload is missing an undoneActions array.",
    };
  }

  if (payload.focus !== null && payload.focus !== undefined && !isValidFocusPayload(payload.focus)) {
    return {
      ok: false,
      error: "Imported payload has an invalid focus object.",
    };
  }

  return {
    ok: true,
    value: {
      sourceCode: payload.sourceCode,
      doneActions: normalizeHistoryEntries(
        stripFocusActions(payload.doneActions),
        "Imported Runtime Action",
      ),
      undoneActions: normalizeHistoryEntries(
        stripFocusActions(payload.undoneActions),
        "Imported Runtime Action",
      ),
      focus: payload.focus ?? null,
    },
  };
}

function loadPersistedRuntimeState(storageKey, sourceCode) {
  if (!storageKey || typeof window === "undefined") {
    return {
      sourceCode,
      doneActions: [],
      undoneActions: [],
      focus: null,
    };
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return {
        sourceCode,
        doneActions: [],
        undoneActions: [],
        focus: null,
      };
    }

    const parsed = JSON.parse(rawValue);
    const validation = normalizeHistoryPayload(parsed);

    if (!validation.ok) {
      return {
        sourceCode,
        doneActions: [],
        undoneActions: [],
        focus: null,
      };
    }

    return validation.value;
  } catch (err) {
    console.error(err);
    return {
      sourceCode,
      doneActions: [],
      undoneActions: [],
      focus: null,
    };
  }
}

function normalizeProjectionSet(projectionBindings, debug) {
  const graphs = debug.graphs ?? {};
  const projections = debug.projections ?? {};

  function getBindingValue(key, bindingName) {
    if (!bindingName) return null;

    if (key === "graph") {
      return graphs[bindingName] ?? projections[bindingName] ?? null;
    }

    return projections[bindingName] ?? graphs[bindingName] ?? null;
  }

  return Object.fromEntries(
    Object.entries(projectionBindings).map(([key, binding]) => [
      key,
      getBindingValue(key, binding),
    ]),
  );
}

function hasAllProjectionBindings(projectionBindings, debug) {
  const normalized = normalizeProjectionSet(projectionBindings, debug);
  return Object.values(normalized).every((value) => value !== null);
}

export function useTatRuntime(sourceCode, projectionBindings, options = {}) {
  const { storageKey = null, projectionOptions = undefined } = options;
  const [interactionState, setInteractionState] = useState(() =>
    loadPersistedRuntimeState(storageKey, sourceCode),
  );
  const runtimeSourceCode = interactionState.sourceCode ?? sourceCode;

  const doneActions = useMemo(() => {
    return interactionState.doneActions ?? [];
  }, [interactionState.doneActions]);

  const undoneActions = useMemo(() => {
    return interactionState.undoneActions ?? [];
  }, [interactionState.undoneActions]);

  const focus = interactionState.focus ?? null;

  const runtimeSnapshot = useMemo(() => {
    function buildSnapshot(candidateSourceCode) {
      let session = createTatRuntimeSession(candidateSourceCode);

      for (const entry of doneActions) {
        if (isTransactionEntry(entry)) {
          session = applyTatMutationTransaction(session, {
            label: entry.label,
            actions: entry.actions,
          });
          continue;
        }

        if (entry.type === "addNode") {
          session = addTatNode(session, entry.payload);
          continue;
        }

        if (entry.type === "addEdge") {
          session = addTatEdge(session, entry.payload);
          continue;
        }

        if (entry.type === "updateNodeValue") {
          session = updateTatNodeValue(session, entry.payload);
          continue;
        }

        if (entry.type === "deleteNode") {
          session = deleteTatNode(session, entry.payload);
          continue;
        }

        if (entry.type === "action") {
          session = applyTatAction(session, entry.payload);
          continue;
        }
      }

      if (isValidFocusPayload(focus)) {
        session = setTatFocus(session, focus);
      }

      const result = inspectTatRuntimeSession(session, projectionOptions);
      return {
        session,
        debug: result?.debug ?? {},
        sourceCode: candidateSourceCode,
      };
    }

    function shouldFallbackToCurrentSource(error) {
      if (runtimeSourceCode === sourceCode) {
        return false;
      }

      const message = String(error ?? "");
      return (
        message.includes("@apply could not find action") ||
        message.includes("Graph \"") ||
        message.includes("@project could not determine a focus node") ||
        message.includes("@project focus") ||
        message.includes('@derive.meta could not find meta key "role"')
      );
    }

    try {
      let primarySnapshot;

      try {
        primarySnapshot = buildSnapshot(runtimeSourceCode);
      } catch (err) {
        if (!shouldFallbackToCurrentSource(err)) {
          throw err;
        }

        const fallbackSnapshot = buildSnapshot(sourceCode);
        return {
          session: fallbackSnapshot.session,
          executionResult: { ok: true, error: null },
          debug: fallbackSnapshot.debug,
          sourceCode: fallbackSnapshot.sourceCode,
        };
      }

      const shouldFallbackToAuthoredSource =
        runtimeSourceCode !== sourceCode &&
        !hasAllProjectionBindings(projectionBindings, primarySnapshot.debug);

      const resolvedSnapshot = shouldFallbackToAuthoredSource
        ? buildSnapshot(sourceCode)
        : primarySnapshot;

      return {
        session: resolvedSnapshot.session,
        executionResult: { ok: true, error: null },
        debug: resolvedSnapshot.debug,
        sourceCode: resolvedSnapshot.sourceCode,
      };
    } catch (err) {
      console.error(err);
      return {
        session: null,
        executionResult: { ok: false, error: String(err) },
        debug: {},
        sourceCode,
      };
    }
  }, [doneActions, focus, projectionBindings, projectionOptions, runtimeSourceCode, sourceCode]);

  const projections = useMemo(() => {
    return normalizeProjectionSet(projectionBindings, runtimeSnapshot.debug);
  }, [projectionBindings, runtimeSnapshot.debug]);

  const executionResult = runtimeSnapshot.executionResult;

  useEffect(() => {
    if (!runtimeSnapshot.sourceCode) {
      return;
    }

    if (interactionState.sourceCode === runtimeSnapshot.sourceCode) {
      return;
    }

    setInteractionState((current) => ({
      ...current,
      sourceCode: runtimeSnapshot.sourceCode,
    }));
  }, [interactionState.sourceCode, runtimeSnapshot.sourceCode]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(
          createRuntimePayload(
            runtimeSnapshot.sourceCode,
            doneActions,
            undoneActions,
            focus,
          ),
        ),
      );
    } catch (err) {
      console.error(err);
    }
  }, [doneActions, undoneActions, focus, runtimeSnapshot.sourceCode, storageKey]);

  function appendHistoryEntry(entry) {
    setInteractionState((current) => ({
      sourceCode: runtimeSnapshot.sourceCode ?? current.sourceCode ?? sourceCode,
      doneActions: [...(current.doneActions ?? []), entry],
      undoneActions: [],
      focus: current.focus ?? null,
    }));
  }

  function prepareTransaction(label, actions) {
    if (!runtimeSnapshot.session) return;

    const normalizedActions = (actions ?? []).filter(isPrimitiveRuntimeAction);
    if (normalizedActions.length === 0) {
      return;
    }

    try {
      return prepareTatMutationTransaction(
        runtimeSnapshot.session,
        {
          label,
          actions: normalizedActions,
        },
      );
    } catch (err) {
      const message = String(err ?? "");
      const canRetryOnAuthoredSource =
        runtimeSnapshot.sourceCode !== sourceCode &&
        message.includes("@apply could not find action");

      if (!canRetryOnAuthoredSource) {
        throw err;
      }

      const fallbackSession = createTatRuntimeSession(sourceCode);
      const rebuiltSession = doneActions.reduce((session, entry) => {
        if (isTransactionEntry(entry)) {
          return applyTatMutationTransaction(session, {
            label: entry.label,
            actions: entry.actions,
          });
        }

        if (entry.type === "addNode") {
          return addTatNode(session, entry.payload);
        }

        if (entry.type === "addEdge") {
          return addTatEdge(session, entry.payload);
        }

        if (entry.type === "updateNodeValue") {
          return updateTatNodeValue(session, entry.payload);
        }

        if (entry.type === "deleteNode") {
          return deleteTatNode(session, entry.payload);
        }

        if (entry.type === "action") {
          return applyTatAction(session, entry.payload);
        }

        return session;
      }, fallbackSession);

      const focusedSession = isValidFocusPayload(focus)
        ? setTatFocus(rebuiltSession, focus)
        : rebuiltSession;

      setInteractionState((current) => ({
        ...current,
        sourceCode,
      }));

      return prepareTatMutationTransaction(
        focusedSession,
        {
          label,
          actions: normalizedActions,
        },
      );
    }
  }

  function executeTransaction(label, actions) {
    if (!runtimeSnapshot.session) return;

    try {
      const preparedTransaction = prepareTransaction(label, actions);
      if (!preparedTransaction) {
        return;
      }

      appendHistoryEntry({
        type: "transaction",
        label: preparedTransaction.label,
        actions: preparedTransaction.actions,
      });

      return preparedTransaction;
    } catch (err) {
      console.error(err);
    }
  }

  function interact({ graphBinding, from, action, target }) {
    if (!runtimeSnapshot.session) return;

    try {
      executeTransaction("Runtime Action", [
        {
          type: "action",
          payload: { graphBinding, from, action, target },
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  }

  function addNode({ graphBinding, nodeId, value, state, meta }) {
    if (!runtimeSnapshot.session) return;

    try {
      executeTransaction("Add Node", [
        {
          type: "addNode",
          payload: { graphBinding, nodeId, value, state, meta },
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  }

  function addEdge({ graphBinding, subject, relation, object, kind }) {
    if (!runtimeSnapshot.session) return;

    try {
      executeTransaction("Add Edge", [
        {
          type: "addEdge",
          payload: { graphBinding, subject, relation, object, kind },
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  }

  function updateNodeValue({ graphBinding, nodeId, patch }) {
    if (!runtimeSnapshot.session) return;

    try {
      executeTransaction("Update Person", [
        {
          type: "updateNodeValue",
          payload: { graphBinding, nodeId, patch },
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  }

  function deleteNode({ graphBinding, nodeId }) {
    if (!runtimeSnapshot.session) return;

    try {
      executeTransaction("Delete Person", [
        {
          type: "deleteNode",
          payload: { graphBinding, nodeId },
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  }

  function setFocus(graphBinding, nodeId) {
    if (!runtimeSnapshot.session) return;

    try {
      setInteractionState((current) => ({
        sourceCode: runtimeSnapshot.sourceCode ?? current.sourceCode ?? sourceCode,
        doneActions: current.doneActions ?? [],
        undoneActions: current.undoneActions ?? [],
        focus: { graphBinding, nodeId },
      }));
    } catch (err) {
      console.error(err);
    }
  }

  function compareRelationship(
    graphBinding,
    fromId,
    toId,
    selectedCommonAncestorId = undefined,
  ) {
    if (!runtimeSnapshot.session || !fromId || !toId) {
      return null;
    }

    try {
      return compareTatRelationship(runtimeSnapshot.session, {
        graphBinding,
        fromId,
        toId,
        ...(selectedCommonAncestorId
          ? { selectedCommonAncestorId }
          : {}),
      });
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  function queryCommonAncestors(graphBinding, fromId, toId) {
    if (!runtimeSnapshot.session || !fromId || !toId) {
      return null;
    }

    try {
      return queryTatCommonAncestors(runtimeSnapshot.session, {
        graphBinding,
        fromId,
        toId,
      });
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  function resetRuntime() {
    setInteractionState({
      sourceCode,
      doneActions: [],
      undoneActions: [],
      focus: null,
    });

    if (!storageKey || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.removeItem(storageKey);
    } catch (err) {
      console.error(err);
    }
  }

  function exportRuntimeState() {
    return createRuntimePayload(
      runtimeSnapshot.sourceCode,
      doneActions,
      undoneActions,
      focus,
    );
  }

  function importRuntimeState(payload) {
    const validation = normalizeHistoryPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    setInteractionState(validation.value);

    return {
      ok: true,
      value: validation.value,
    };
  }

  function undo() {
    if (doneActions.length === 0) {
      return;
    }

    setInteractionState((current) => {
      const nextDone = [...(current.doneActions ?? [])];
      const lastAction = nextDone.pop();

      if (!lastAction) {
        return current;
      }

      return {
        sourceCode: runtimeSnapshot.sourceCode ?? current.sourceCode ?? sourceCode,
        doneActions: nextDone,
        undoneActions: [lastAction, ...(current.undoneActions ?? [])],
        focus: current.focus ?? null,
      };
    });
  }

  function redo() {
    if (undoneActions.length === 0) {
      return;
    }

    setInteractionState((current) => {
      const nextUndone = [...(current.undoneActions ?? [])];
      const restoredAction = nextUndone.shift();

      if (!restoredAction) {
        return current;
      }

      return {
        sourceCode: runtimeSnapshot.sourceCode ?? current.sourceCode ?? sourceCode,
        doneActions: [...(current.doneActions ?? []), restoredAction],
        undoneActions: nextUndone,
        focus: current.focus ?? null,
      };
    });
  }

  return {
    projections,
    executionResult,
    interact,
    addNode,
    addEdge,
    updateNodeValue,
    deleteNode,
    setFocus,
    resetRuntime,
    exportRuntimeState,
    importRuntimeState,
    prepareTransaction,
    executeTransaction,
    undo,
    redo,
    canUndo: doneActions.length > 0,
    canRedo: undoneActions.length > 0,
    compareRelationship,
    queryCommonAncestors,
  };
}
