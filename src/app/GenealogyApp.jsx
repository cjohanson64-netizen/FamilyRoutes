import { useMemo, useRef, useState } from "react";
import FamilyTreeArena from "./components/FamilyTreeArena";
import AddPersonModal from "./components/AddPersonModal";
import PersonDetailPanel from "./components/PersonDetailPanel";
import QueryPanel from "./components/QueryPanel";
import RelationshipPanel from "./components/RelationshipPanel";
import genealogySource from "./features/genealogy/tat/genealogy-demo.tat?raw";
import { useTatRuntime } from "./hooks/useTatRuntime";
import "./styles/genealogy.css";

const GENEALOGY_STORAGE_KEY = "tat-genealogy-runtime";
const KNOWN_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
function isBirthParentEdge(edge) {
  return (
    edge?.relation === "birthParent" ||
    (edge?.relation === "parentOf" &&
      (edge?.meta?.kind === "birth" || edge?.meta?.kind == null))
  );
}

function isStepParentEdge(edge) {
  return (
    edge?.relation === "stepParent" ||
    (edge?.relation === "parentOf" && edge?.meta?.kind === "step")
  );
}

function isParentEdge(edge) {
  return isBirthParentEdge(edge) || isStepParentEdge(edge);
}

function isSpouseEdge(edge) {
  return (
    edge?.relation === "spouse" ||
    (edge?.relation === "spouseOf" &&
      (edge?.meta?.active === true || edge?.meta?.active == null))
  );
}

function sortNodes(nodes) {
  return [...nodes].sort(
    (a, b) => (a.meta?.order ?? 999) - (b.meta?.order ?? 999),
  );
}

function getSortableNodeLabel(node) {
  const assembledName = [
    node?.value?.firstName,
    node?.value?.middleNames,
    node?.value?.lastName,
    node?.value?.suffix,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    assembledName ||
    node?.value?.fullName ||
    node?.value?.name ||
    node?.meta?.label ||
    node?.label ||
    node?.id ||
    "Unknown"
  );
}

function sortNodesByBirthdateAndName(nodes) {
  return [...(nodes ?? [])].sort((left, right) => {
    const leftBirthdate = String(left?.value?.dateOfBirth ?? "").trim();
    const rightBirthdate = String(right?.value?.dateOfBirth ?? "").trim();

    if (leftBirthdate && rightBirthdate) {
      const birthdateComparison = leftBirthdate.localeCompare(rightBirthdate);
      if (birthdateComparison !== 0) {
        return birthdateComparison;
      }
    } else if (leftBirthdate && !rightBirthdate) {
      return -1;
    } else if (!leftBirthdate && rightBirthdate) {
      return 1;
    }

    const labelComparison = getSortableNodeLabel(left).localeCompare(
      getSortableNodeLabel(right),
    );
    if (labelComparison !== 0) {
      return labelComparison;
    }

    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  });
}

function getUniqueNodes(nodeIds, nodesById) {
  return sortNodes(
    [...new Set(nodeIds)]
      .map((nodeId) => nodesById.get(nodeId))
      .filter(Boolean),
  );
}

function getUniqueSortedNodes(nodeIds, nodesById) {
  return [...new Set(nodeIds)]
    .map((nodeId) => nodesById.get(nodeId))
    .filter(Boolean);
}

function splitFullName(fullName) {
  const parts = `${fullName ?? ""}`.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return {
      firstName: "",
      middleNames: "",
      lastName: "",
      suffix: "",
    };
  }

  let suffix = "";
  const lastToken = parts[parts.length - 1]?.replace(/\./g, "").toLowerCase();
  if (lastToken && KNOWN_SUFFIXES.has(lastToken)) {
    suffix = parts.pop() ?? "";
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      middleNames: "",
      lastName: "",
      suffix,
    };
  }

  return {
    firstName: parts[0] ?? "",
    middleNames: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1] ?? "",
    suffix,
  };
}

function buildFullName(parts) {
  return [
    parts.firstName?.trim(),
    parts.middleNames?.trim(),
    parts.lastName?.trim(),
    parts.suffix?.trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

function getPersonFormInitialValues(node) {
  const value = node?.value ?? {};
  const parsedName = splitFullName(value.fullName);

  return {
    firstName: value.firstName ?? parsedName.firstName,
    middleNames: value.middleNames ?? parsedName.middleNames,
    lastName: value.lastName ?? parsedName.lastName,
    suffix: value.suffix ?? parsedName.suffix,
    dateOfBirth: value.dateOfBirth ?? "",
    birthPlace: value.birthPlace ?? "",
    lifeStatus: value.lifeStatus ?? "unknown",
    deathDate: value.deathDate ?? "",
    deathPlace: value.deathPlace ?? "",
    gender: value.gender ?? "",
    biography: value.biography ?? "",
    notes: value.notes ?? "",
  };
}

function getComparisonTreeFocusId(relationshipComparison, fallbackNodeId) {
  if (!relationshipComparison) {
    return fallbackNodeId;
  }

  const { relationship, from, to, pathNodeIds = [] } = relationshipComparison;
  const commonFocusId = relationshipComparison.highlight?.commonNodeIds?.[0] ?? null;

  if (relationship.type === "self") {
    return from.id;
  }

  if (relationship.type === "spouse") {
    return to.id;
  }

  if (relationship.type === "ancestor") {
    return to.id;
  }

  if (relationship.type === "descendant") {
    return from.id;
  }

  if (relationship.type === "stepParent") {
    return pathNodeIds[1] ?? to.id;
  }

  if (relationship.type === "stepChild") {
    return pathNodeIds[1] ?? from.id;
  }

  if (relationship.type === "sibling") {
    return commonFocusId ?? pathNodeIds[1] ?? fallbackNodeId;
  }

  if (relationship.type === "auntUncle") {
    return commonFocusId ?? pathNodeIds[2] ?? fallbackNodeId;
  }

  if (relationship.type === "nieceNephew") {
    return commonFocusId ?? pathNodeIds[2] ?? fallbackNodeId;
  }

  if (relationship.type === "cousin") {
    return commonFocusId ?? pathNodeIds[2] ?? fallbackNodeId;
  }

  if (relationship.type === "parentInLaw") {
    return pathNodeIds[1] ?? fallbackNodeId;
  }

  if (relationship.type === "childInLaw") {
    return pathNodeIds[1] ?? fallbackNodeId;
  }

  return fallbackNodeId;
}

export default function GenealogyApp() {
  const [sourceCode] = useState(genealogySource);
  const [selectedNodeId, setSelectedNodeId] = useState("selfNode");
  const [treeAddIntent, setTreeAddIntent] = useState(null);
  const [viewDepths, setViewDepths] = useState({
    ancestors: 2,
    descendants: 2,
  });
  const [comparisonPair, setComparisonPair] = useState({
    fromId: "selfNode",
    toId: "",
  });
  const [selectedCommonAncestorId, setSelectedCommonAncestorId] = useState("");
  const [treeComparisonFocusId, setTreeComparisonFocusId] = useState(null);
  const [importError, setImportError] = useState(null);
  const importInputRef = useRef(null);

  const projectionOptions = useMemo(() => ({
    argumentOverrides: {
      familyAncestors: { depth: viewDepths.ancestors },
      familyDescendants: { depth: viewDepths.descendants },
      familyGenerations: { focus: treeComparisonFocusId ?? selectedNodeId },
    },
  }), [selectedNodeId, treeComparisonFocusId, viewDepths.ancestors, viewDepths.descendants]);

  const {
    projections,
    executionResult,
    prepareTransaction,
    executeTransaction,
    setFocus,
    resetRuntime,
    exportRuntimeState,
    importRuntimeState,
    undo,
    redo,
    canUndo,
    canRedo,
    compareRelationship,
    queryCommonAncestors,
  } = useTatRuntime(sourceCode, {
    graph: "family",
    detail: "familyDetail",
    relationships: "familyRelationships",
    generations: "familyGenerations",
    siblings: "familySiblings",
    ancestors: "familyAncestors",
    descendants: "familyDescendants",
    summary: "familySummary",
    list: "familyList",
    tree: "familyTree",
  }, {
    storageKey: GENEALOGY_STORAGE_KEY,
    projectionOptions,
  });

  const {
    graph,
    detail,
    relationships,
    generations,
    siblings,
    ancestors,
    descendants,
    summary,
    list,
    tree,
  } = projections;

  const people = useMemo(() => {
    return sortNodes(
      [...(graph?.nodes ?? [])].filter((node) => node.value?.type === "person"),
    );
  }, [graph]);

  const peopleById = useMemo(() => {
    return new Map(people.map((node) => [node.id, node]));
  }, [people]);

  const activeNodeId = detail?.node?.id ?? selectedNodeId;

  const selectedPerson = useMemo(() => {
    return (
      detail?.node ?? people.find((node) => node.id === activeNodeId) ?? null
    );
  }, [activeNodeId, detail, people]);

  const commonAncestorsQuery = useMemo(() => {
    if (!comparisonPair.fromId || !comparisonPair.toId) {
      return {
        format: "commonAncestors",
        from: null,
        to: null,
        count: 0,
        ancestors: [],
      };
    }

    return (
      queryCommonAncestors?.(
        "family",
        comparisonPair.fromId,
        comparisonPair.toId,
      ) ?? {
        format: "commonAncestors",
        from: null,
        to: null,
        count: 0,
        ancestors: [],
      }
    );
  }, [comparisonPair.fromId, comparisonPair.toId, queryCommonAncestors]);

  const validSelectedCommonAncestorId = useMemo(() => {
    const validIds = new Set(
      (commonAncestorsQuery?.ancestors ?? []).map((ancestor) => ancestor.id),
    );

    return selectedCommonAncestorId && validIds.has(selectedCommonAncestorId)
      ? selectedCommonAncestorId
      : "";
  }, [commonAncestorsQuery?.ancestors, selectedCommonAncestorId]);

  const relationshipComparison = useMemo(() => {
    if (!comparisonPair.fromId || !comparisonPair.toId) {
      return null;
    }

    return compareRelationship?.(
      "family",
      comparisonPair.fromId,
      comparisonPair.toId,
      validSelectedCommonAncestorId || undefined,
    ) ?? null;
  }, [compareRelationship, comparisonPair.fromId, comparisonPair.toId, validSelectedCommonAncestorId]);

  const canOverrideCommonAncestor = useMemo(() => {
    return ["sibling", "auntUncle", "nieceNephew", "cousin"].includes(
      relationshipComparison?.relationship?.type,
    );
  }, [relationshipComparison?.relationship?.type]);


  const siblingsProjection = useMemo(() => {
    return (
      siblings ?? {
        format: "siblings",
        focus: relationships?.focus ?? detail?.node ?? null,
        siblings: [],
      }
    );
  }, [detail?.node, relationships?.focus, siblings]);

  const generationsProjection = useMemo(() => {
    return (
      generations ?? {
        format: "generations",
        focus: relationships?.focus ?? detail?.node ?? null,
        generations: {
          "3": [],
          "2": [],
          "1": [],
          "0": [],
          "-1": [],
        },
      }
    );
  }, [detail?.node, generations, relationships?.focus]);

  const ancestorsProjection = useMemo(() => {
    return (
      ancestors ?? {
        format: "ancestors",
        focus: relationships?.focus ?? detail?.node ?? null,
        depth: viewDepths.ancestors,
        ancestors: [],
      }
    );
  }, [ancestors, detail?.node, relationships?.focus, viewDepths.ancestors]);

  const descendantsProjection = useMemo(() => {
    return (
      descendants ?? {
        format: "descendants",
        focus: relationships?.focus ?? detail?.node ?? null,
        depth: viewDepths.descendants,
        descendants: [],
      }
    );
  }, [descendants, detail?.node, relationships?.focus, viewDepths.descendants]);

  const familyRows = useMemo(() => {
    const focusNode = relationships?.focus ?? selectedPerson ?? null;
    const birthParentNodes = relationships?.birthParents ?? relationships?.parents ?? [];
    const stepParentNodes = relationships?.stepParents ?? [];
    const selectedSpouses = relationships?.spouses ?? [];
    const birthChildren = relationships?.birthChildren ?? relationships?.children ?? [];
    const stepChildren = relationships?.stepChildren ?? [];
    const edges = graph?.edges ?? [];

    function getSpouseIds(nodeId) {
      return edges
        .filter(
          (edge) =>
            isSpouseEdge(edge) &&
            (edge.subject === nodeId || edge.object === nodeId),
        )
        .map((edge) => (edge.subject === nodeId ? edge.object : edge.subject));
    }

    const parentSpouseIds = birthParentNodes
      .flatMap((node) => getSpouseIds(node.id));
    const parentRow = getUniqueNodes(
      [
        ...birthParentNodes.map((node) => node.id),
        ...stepParentNodes.map((node) => node.id),
        ...parentSpouseIds,
      ].filter(
        (nodeId) => nodeId !== activeNodeId,
      ),
      peopleById,
    );

    const selectedRow = getUniqueNodes(
      [
        ...(focusNode ? [focusNode.id] : []),
        ...selectedSpouses.map((node) => node.id),
      ],
      peopleById,
    );

    return {
      birthParents: birthParentNodes,
      stepParents: stepParentNodes,
      parents: parentRow,
      selectedAndSpouses: selectedRow,
      birthChildren,
      stepChildren,
      children: getUniqueNodes(
        [...birthChildren.map((node) => node.id), ...stepChildren.map((node) => node.id)],
        peopleById,
      ),
    };
  }, [activeNodeId, graph, peopleById, relationships, selectedPerson]);

  function getRelatedPeople(nodeId) {
    const edges = graph?.edges ?? [];

    function resolve(nodeIds) {
      return getUniqueNodes(nodeIds, peopleById);
    }

    return {
      birthParents: resolve(
        edges
          .filter(
            (edge) =>
              isBirthParentEdge(edge) &&
              edge.object === nodeId,
          )
          .map((edge) => edge.subject),
      ),
      stepParents: resolve(
        edges
          .filter(
            (edge) =>
              isStepParentEdge(edge) &&
              edge.object === nodeId,
          )
          .map((edge) => edge.subject),
      ),
      parents: resolve(
        edges
          .filter(
            (edge) =>
              isParentEdge(edge) &&
              edge.object === nodeId,
          )
          .map((edge) => edge.subject),
      ),
      birthChildren: resolve(
        edges
          .filter(
            (edge) =>
              isBirthParentEdge(edge) &&
              edge.subject === nodeId,
          )
          .map((edge) => edge.object),
      ),
      stepChildren: resolve(
        edges
          .filter(
            (edge) =>
              isStepParentEdge(edge) &&
              edge.subject === nodeId,
          )
          .map((edge) => edge.object),
      ),
      children: resolve(
        edges
          .filter(
            (edge) =>
              isParentEdge(edge) &&
              edge.subject === nodeId,
          )
          .map((edge) => edge.object),
      ),
      spouses: resolve(
        edges
          .filter(
            (edge) =>
              isSpouseEdge(edge) &&
              (edge.subject === nodeId || edge.object === nodeId),
          )
          .map((edge) =>
            edge.subject === nodeId ? edge.object : edge.subject,
          ),
      ),
    };
  }

  const spouseMap = useMemo(() => {
    const spouseIdsByPerson = new Map();

    for (const edge of graph?.edges ?? []) {
      if (!isSpouseEdge(edge)) {
        continue;
      }

      const current = spouseIdsByPerson.get(edge.subject) ?? [];
      current.push(edge.object);
      spouseIdsByPerson.set(edge.subject, current);
    }

    return Object.fromEntries(
      people.map((person) => [
        person.id,
        getUniqueNodes(spouseIdsByPerson.get(person.id) ?? [], peopleById),
      ]),
    );
  }, [graph, people, peopleById]);

  function closeTreeAddModal() {
    setTreeAddIntent(null);
  }

  function handleSelectPerson(nodeId) {
    closeTreeAddModal();
    setSelectedNodeId(nodeId);
    setFocus?.("family", nodeId);
    setComparisonPair((current) => ({
      ...current,
      fromId: current.fromId || nodeId,
    }));
  }

  function handleChangeViewDepth(view, depth) {
    setViewDepths((current) => ({
      ...current,
      [view]: depth,
    }));
  }

  function syncComparisonTreeFocus(nextPair, ancestorOverride = undefined) {
    if (!nextPair?.fromId || !nextPair?.toId) {
      setTreeComparisonFocusId(null);
      return;
    }

    const nextComparison =
      compareRelationship?.(
        "family",
        nextPair.fromId,
        nextPair.toId,
        ancestorOverride,
      ) ?? null;

    setTreeComparisonFocusId(
      getComparisonTreeFocusId(nextComparison, activeNodeId ?? selectedNodeId),
    );
  }

  function handleChangeComparisonPerson(field, value) {
    setComparisonPair((current) => {
      const nextPair = {
        ...current,
        [field]: value,
      };

      syncComparisonTreeFocus(nextPair);
      return nextPair;
    });
    setSelectedCommonAncestorId("");
  }

  function handleSwapComparisonPeople() {
    setComparisonPair((current) => {
      const nextPair = {
        fromId: current.toId,
        toId: current.fromId,
      };

      syncComparisonTreeFocus(nextPair);
      return nextPair;
    });
    setSelectedCommonAncestorId("");
  }

  function handleChangeSelectedCommonAncestor(nodeId) {
    setSelectedCommonAncestorId(nodeId || "");
    syncComparisonTreeFocus(comparisonPair, nodeId || undefined);
  }

  function buildNewPersonDraft(formValues) {
    const fullName = buildFullName(formValues);

    return {
      firstName: formValues.firstName || null,
      middleNames: formValues.middleNames || null,
      lastName: formValues.lastName || null,
      suffix: formValues.suffix || null,
      fullName,
      dateOfBirth: formValues.dateOfBirth || null,
      birthPlace: formValues.birthPlace || null,
      lifeStatus: formValues.lifeStatus || "unknown",
      deathDate: formValues.deathDate || null,
      deathPlace: formValues.deathPlace || null,
      gender: formValues.gender || null,
      biography: formValues.biography || null,
      notes: formValues.notes || null,
    };
  }

  function commitNewPerson(nodeId) {
    closeTreeAddModal();
    setSelectedNodeId(nodeId);
    setFocus?.("family", nodeId);
  }

  function getSpouseNodesForPerson(nodeId) {
    return getRelatedPeople(nodeId).spouses;
  }

  function getChildRelationshipContextForPerson(nodeId) {
    return sortNodesByBirthdateAndName(getRelatedPeople(nodeId).children);
  }

  function getBiologicalSiblingClusterForChild(nodeId) {
    if (!nodeId) {
      return [];
    }

    const edges = graph?.edges ?? [];
    const siblingIds = new Set([nodeId]);
    const birthParentIds = edges
      .filter(
        (edge) =>
          isBirthParentEdge(edge) && edge.object === nodeId,
      )
      .map((edge) => edge.subject);

    for (const parentId of birthParentIds) {
      for (const edge of edges) {
        if (
          isBirthParentEdge(edge) &&
          edge.subject === parentId
        ) {
          siblingIds.add(edge.object);
        }
      }
    }

    return sortNodesByBirthdateAndName(
      getUniqueSortedNodes([...siblingIds], peopleById),
    );
  }

  function getChildAssignmentTypeForPerson(nodeId, childId) {
    const related = getRelatedPeople(nodeId);

    if (related.birthChildren.some((person) => person.id === childId)) {
      return "birthParent";
    }

    if (related.stepChildren.some((person) => person.id === childId)) {
      return "stepParent";
    }

    return "none";
  }

  function getInitialChildAssignments(nodeId, children) {
    return Object.fromEntries(
      (children ?? []).map((child) => [
        child.id,
        getChildAssignmentTypeForPerson(nodeId, child.id),
      ]),
    );
  }

  function getInitialAddParentAssignments(anchorChildId, children) {
    return Object.fromEntries(
      (children ?? []).map((child) => [
        child.id,
        child.id === anchorChildId ? "birthParent" : "none",
      ]),
    );
  }

  function buildChildAssignmentMutationActions(nodeId, desiredAssignments, children) {
    return (children ?? []).flatMap((child) => {
      const nextType = desiredAssignments?.[child.id] ?? "none";
      const currentType = getChildAssignmentTypeForPerson(nodeId, child.id);

      if (nextType === currentType) {
        return [];
      }

      const actions = [];

      if (currentType === "birthParent") {
        actions.push({
          type: "action",
          payload: {
            graphBinding: "family",
            from: nodeId,
            action: "unclaimChild",
            target: child.id,
          },
        });
      }

      if (currentType === "stepParent") {
        actions.push({
          type: "action",
          payload: {
            graphBinding: "family",
            from: nodeId,
            action: "unclaimStepChild",
            target: child.id,
          },
        });
      }

      if (nextType === "birthParent") {
        actions.push({
          type: "action",
          payload: {
            graphBinding: "family",
            from: nodeId,
            action: "claimChild",
            target: child.id,
          },
        });
      }

      if (nextType === "stepParent") {
        actions.push({
          type: "action",
          payload: {
            graphBinding: "family",
            from: nodeId,
            action: "claimStepChild",
            target: child.id,
          },
        });
      }

      return actions;
    });
  }

  function handleAddChildForPerson(nodeId, formValues, transactionLabel = "Add Child") {
    if (!nodeId) {
      return;
    }

    const newPerson = buildNewPersonDraft(formValues);
    if (!newPerson.fullName) {
      return;
    }

    const preparedCreate = prepareTransaction?.(transactionLabel, [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: nodeId,
          action: "addChild",
          payload: {
            ...newPerson,
          },
        },
      },
    ]);

    const createdNodeId = preparedCreate?.actions?.[0]?.payload?.target;
    if (!createdNodeId) {
      return;
    }

    executeTransaction?.(transactionLabel, [
      preparedCreate.actions[0],
      ...getSpouseNodesForPerson(nodeId).map((spouseNode) => ({
        type: "action",
        payload: {
          graphBinding: "family",
          from: spouseNode.id,
          action: "claimChild",
          target: createdNodeId,
        },
      })),
    ]);

    commitNewPerson(createdNodeId);
  }

  function handleAddParentForPerson(nodeId, formValues, transactionLabel = "Add Parent") {
    if (!nodeId) {
      return;
    }

    const newPerson = buildNewPersonDraft(formValues);
    if (!newPerson.fullName) {
      return;
    }

    const transaction = prepareTransaction?.(transactionLabel, [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: nodeId,
          action: "addParent",
          payload: {
            ...newPerson,
          },
        },
      },
    ]);

    const createdNodeId = transaction?.actions?.[0]?.payload?.target;
    if (!createdNodeId) {
      return;
    }

    const assignmentActions = Object.entries(formValues.childAssignments ?? {})
      .flatMap(([childId, relationshipType]) => {
        if (childId === nodeId) {
          return [];
        }

        if (relationshipType === "birthParent") {
          return [{
            type: "action",
            payload: {
              graphBinding: "family",
              from: createdNodeId,
              action: "claimChild",
              target: childId,
            },
          }];
        }

        if (relationshipType === "stepParent") {
          return [{
            type: "action",
            payload: {
              graphBinding: "family",
              from: createdNodeId,
              action: "claimStepChild",
              target: childId,
            },
          }];
        }

        return [];
      });

    executeTransaction?.(transactionLabel, [
      transaction.actions[0],
      ...assignmentActions,
    ]);

    commitNewPerson(createdNodeId);
  }

  function handleAddSpouseForPerson(nodeId, formValues, transactionLabel = "Add Spouse") {
    if (!nodeId) {
      return;
    }

    const newPerson = buildNewPersonDraft(formValues);
    if (!newPerson.fullName) {
      return;
    }

    const preparedCreate = prepareTransaction?.(transactionLabel, [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: nodeId,
          action: "addSpouse",
          payload: {
            ...newPerson,
          },
        },
      },
    ]);

    const createdNodeId = preparedCreate?.actions?.[0]?.payload?.target;
    if (!createdNodeId) {
      return;
    }

    const assignmentActions = Object.entries(formValues.childAssignments ?? {})
      .flatMap(([childId, relationshipType]) => {
        if (relationshipType === "birthParent") {
          return [{
            type: "action",
            payload: {
              graphBinding: "family",
              from: createdNodeId,
              action: "claimChild",
              target: childId,
            },
          }];
        }

        if (relationshipType === "stepParent") {
          return [{
            type: "action",
            payload: {
              graphBinding: "family",
              from: createdNodeId,
              action: "claimStepChild",
              target: childId,
            },
          }];
        }

        return [];
      });

    executeTransaction?.(transactionLabel, [
      preparedCreate.actions[0],
      ...assignmentActions,
    ]);

    if (createdNodeId) {
      commitNewPerson(createdNodeId);
    }
  }

  function handleEditPersonForNode(nodeId, formValues, assignmentChildren = []) {
    if (!nodeId) {
      return;
    }

    const person = peopleById.get(nodeId);
    if (!person) {
      return;
    }

    const nextPerson = buildNewPersonDraft(formValues);
    if (!nextPerson.fullName) {
      return;
    }

    executeTransaction?.("Edit Person", [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: person.id,
          action: "editPerson",
          target: person.id,
          payload: {
            ...nextPerson,
          },
        },
      },
      ...buildChildAssignmentMutationActions(
        person.id,
        formValues.childAssignments,
        assignmentChildren,
      ),
    ]);

    closeTreeAddModal();
    setSelectedNodeId(person.id);
    setFocus?.("family", person.id);
  }

  function handleDeletePerson(node) {
    const label =
      node?.value?.fullName ??
      node?.value?.name ??
      node?.meta?.label ??
      node?.id ??
      "this person";

    if (!window.confirm(`Delete ${label} from the runtime family graph?`)) {
      return;
    }

    const related = getRelatedPeople(node.id);
    const remainingPeople = people.filter((person) => person.id !== node.id);
    const fallbackNode =
      related.parents[0] ??
      related.children[0] ??
      related.spouses[0] ??
      remainingPeople.find((person) => person.id === "selfNode") ??
      remainingPeople[0] ??
      null;

    closeTreeAddModal();
    executeTransaction?.("Delete Person", [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: node.id,
          action: "deletePerson",
          target: node.id,
        },
      },
    ]);

    if (fallbackNode) {
      setSelectedNodeId(fallbackNode.id);
      setFocus?.("family", fallbackNode.id);
    } else {
      setSelectedNodeId(null);
    }
  }

  function handleOpenTreeAddIntent(intent) {
    if (!intent?.actionType || !intent?.anchorId) {
      return;
    }

    setTreeAddIntent(intent);
  }

  function handleOpenTreeEdit(node) {
    if (!node?.id) {
      return;
    }

    setTreeAddIntent({
      actionType: "editPerson",
      anchorId: node.id,
      title: "Edit Person",
      slotLabel: "Selected person",
      description: "Update this person’s details.",
      submitLabel: "Save Person",
      initialValues: getPersonFormInitialValues(node),
    });
  }

  function handleSubmitTreeAdd(formValues) {
    if (!treeAddIntent?.actionType || !treeAddIntent?.anchorId) {
      return { ok: false, error: "No tree action is active." };
    }

    switch (treeAddIntent.actionType) {
      case "addChild":
        handleAddChildForPerson(
          treeAddIntent.anchorId,
          formValues,
          treeAddIntent.title,
        );
        return { ok: true };
      case "addSpouse":
        if ((spouseMap[treeAddIntent.anchorId]?.length ?? 0) > 0) {
          return {
            ok: false,
            error: "This person already has a spouse.",
          };
        }

        handleAddSpouseForPerson(
          treeAddIntent.anchorId,
          formValues,
          treeAddIntent.title,
        );
        return { ok: true };
      case "addParent":
        handleAddParentForPerson(
          treeAddIntent.anchorId,
          formValues,
          treeAddIntent.title,
        );
        return { ok: true };
      case "editPerson":
        handleEditPersonForNode(
          treeAddIntent.anchorId,
          formValues,
          getChildRelationshipContextForPerson(treeAddIntent.anchorId),
        );
        return { ok: true };
      default:
        return { ok: false, error: "Unsupported tree action." };
    }
  }

  function handleResetTree() {
    if (
      !window.confirm(
        "Reset the runtime family tree to the original authored seed?",
      )
    ) {
      return;
    }

    closeTreeAddModal();
    resetRuntime?.();
    setSelectedNodeId("selfNode");
    setImportError(null);
  }

  function handleExportJson() {
    try {
      const payload = exportRuntimeState?.();
      if (!payload || typeof window === "undefined") {
        return;
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "tat-genealogy-runtime.json";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(objectUrl);
      setImportError(null);
    } catch (err) {
      console.error(err);
      setImportError("Failed to export the current genealogy runtime JSON.");
    }
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportJson(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      const payload = JSON.parse(rawText);

      if (
        !window.confirm(
          "Replace the current runtime family tree with the imported JSON?",
        )
      ) {
        return;
      }

      const result = importRuntimeState?.(payload);
      if (!result?.ok) {
        setImportError(result?.error ?? "Invalid genealogy runtime JSON.");
        return;
      }

      closeTreeAddModal();
      setSelectedNodeId("selfNode");
      setImportError(null);
    } catch (err) {
      console.error(err);
      setImportError("Import failed. Please choose a valid genealogy runtime JSON file.");
    }
  }

  return (
    <main className="genealogy-root">
      <header className="genealogy-header">
        <div className="genealogy-header-row">
          <div>
            <h1>RootLine</h1>
            <p>A family tree and genealogy graph powered by TAT.</p>
          </div>

          <div className="genealogy-header-actions">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="genealogy-hidden-input"
              onChange={handleImportJson}
            />

            <button
              type="button"
              className="genealogy-button genealogy-button-secondary"
              onClick={undo}
              disabled={!canUndo}
            >
              Undo
            </button>

            <button
              type="button"
              className="genealogy-button genealogy-button-secondary"
              onClick={redo}
              disabled={!canRedo}
            >
              Redo
            </button>

            <button
              type="button"
              className="genealogy-button genealogy-button-secondary"
              onClick={handleExportJson}
            >
              Export JSON
            </button>

            <button
              type="button"
              className="genealogy-button genealogy-button-secondary"
              onClick={handleImportClick}
            >
              Import JSON
            </button>

            <button
              type="button"
              className="genealogy-button genealogy-button-secondary"
              onClick={handleResetTree}
            >
              Reset Tree
            </button>
          </div>
        </div>
      </header>

      {importError && (
        <section className="genealogy-error">
          <strong>Import Error</strong>
          <pre>{importError}</pre>
        </section>
      )}

      {!executionResult.ok && (
        <section className="genealogy-error">
          <strong>TAT Error</strong>
          <pre>{executionResult.error}</pre>
        </section>
      )}

      <section className="genealogy-layout">
        <div className="genealogy-main-column">
          <FamilyTreeArena
            generations={generationsProjection}
            selectedNodeId={activeNodeId}
            relationshipComparison={relationshipComparison}
            onSelectPerson={handleSelectPerson}
            onEditPerson={handleOpenTreeEdit}
            onDeletePerson={handleDeletePerson}
            onAddSlot={handleOpenTreeAddIntent}
          />

          <div className="genealogy-bottom-panels">
            <PersonDetailPanel
              selectedPerson={selectedPerson}
            />

            <QueryPanel
              people={people}
              comparisonPair={comparisonPair}
              relationshipComparison={relationshipComparison}
              commonAncestorsQuery={commonAncestorsQuery}
              selectedCommonAncestorId={validSelectedCommonAncestorId}
              canOverrideCommonAncestor={canOverrideCommonAncestor}
              onChangeComparisonPerson={handleChangeComparisonPerson}
              onSwapComparisonPeople={handleSwapComparisonPeople}
              onChangeSelectedCommonAncestor={handleChangeSelectedCommonAncestor}
            />
          </div>
        </div>

        <div className="genealogy-view-column">
          <RelationshipPanel
            familyRows={familyRows}
            selectedNodeId={activeNodeId}
            siblings={siblingsProjection}
            ancestors={ancestorsProjection}
            descendants={descendantsProjection}
            viewDepths={viewDepths}
            summary={summary}
            list={list}
            tree={tree}
            onSelectPerson={handleSelectPerson}
            onChangeViewDepth={handleChangeViewDepth}
          />
        </div>
      </section>

      <AddPersonModal
        key={`${treeAddIntent?.actionType ?? "closed"}-${treeAddIntent?.anchorId ?? "none"}`}
        intent={treeAddIntent}
        isOpen={!!treeAddIntent}
        onClose={closeTreeAddModal}
        onSubmit={handleSubmitTreeAdd}
        anchorPerson={peopleById.get(treeAddIntent?.anchorId) ?? null}
        relationshipAssignments={
          treeAddIntent?.actionType === "addSpouse" ||
          treeAddIntent?.actionType === "editPerson"
            ? getChildRelationshipContextForPerson(treeAddIntent.anchorId)
            : treeAddIntent?.actionType === "addParent"
              ? getBiologicalSiblingClusterForChild(treeAddIntent.anchorId)
              : []
        }
        initialAssignmentValues={
          treeAddIntent?.actionType === "editPerson"
            ? getInitialChildAssignments(
                treeAddIntent.anchorId,
                getChildRelationshipContextForPerson(treeAddIntent.anchorId),
              )
            : treeAddIntent?.actionType === "addParent"
              ? getInitialAddParentAssignments(
                  treeAddIntent.anchorId,
                  getBiologicalSiblingClusterForChild(treeAddIntent.anchorId),
                )
              : {}
        }
        submitDisabled={
          treeAddIntent?.actionType === "addSpouse" &&
          (spouseMap[treeAddIntent?.anchorId]?.length ?? 0) > 0
        }
        submitDisabledMessage={
          treeAddIntent?.actionType === "addSpouse" &&
          (spouseMap[treeAddIntent?.anchorId]?.length ?? 0) > 0
            ? "This person already has a spouse."
            : ""
        }
      />
    </main>
  );
}
