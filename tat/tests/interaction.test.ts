import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { addBranch, addNode, createGraph } from "../runtime/graph";
import {
  addTatEdge,
  addTatNode,
  applyTatMutationTransaction,
  prepareTatMutationTransaction,
  applyTatAction,
  compareTatRelationship,
  createTatRuntimeSession,
  deleteTatNode,
  executeGraphInteraction,
  hasDirectedContractEligibility,
  hasHandshakeContractEligibility,
  inspectTatRuntimeSession,
  parseTatToAst,
  queryTatCommonAncestors,
  setTatFocus,
  updateTatNodeValue,
  executeTat,
  type GraphInteraction,
  type GraphInteractionHistoryEntry,
  type GraphWorkspace,
} from "../runtime/index";
import { executeWhy } from "../runtime/executeWhy";

function loadRuntimeSessionFromImportPayload(jsonPath: string) {
  const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  let session = createTatRuntimeSession(payload.sourceCode);

  for (const entry of payload.doneActions) {
    const actions = entry.type === "transaction" ? entry.actions : [entry];

    for (const action of actions) {
      if (action.type === "addNode") {
        session = addTatNode(session, action.payload);
        continue;
      }

      if (action.type === "addEdge") {
        session = addTatEdge(session, action.payload);
        continue;
      }

      if (action.type === "updateNodeValue") {
        session = updateTatNodeValue(session, action.payload);
        continue;
      }

      if (action.type === "action") {
        session = applyTatAction(session, action.payload);
      }
    }
  }

  return session;
}

function createWorkspaceWithTarget(
  targetState: Record<string, any>,
): GraphWorkspace {
  const hero = createGraph("hero_root");
  addNode(hero, {
    id: "hero_root",
    value: "hero",
    state: {},
    meta: {},
  });

  const enemy = createGraph("enemy_root");
  addNode(enemy, {
    id: "enemy_root",
    value: "enemy",
    state: targetState,
    meta: {},
  });

  return {
    graphs: new Map([
      ["hero", hero],
      ["enemy", enemy],
    ]),
    interactionHistory: [],
  };
}

test("graph interaction definitions are stored and not executed immediately", () => {
  const result = executeTat(`
attack := @graph(hero) : "attacks" : @graph(enemy)
  -> @effect(
    target: root,
    ops: [
      @graft.state("has", "poison"),
      @derive.state("hp", current - 1)
    ]
  )
`);

  assert.deepEqual(Object.keys(result.debug.graphInteractions), ["attack"]);
  assert.equal(result.debug.graphInteractions.attack.objectGraphId, "enemy");
  assert.equal(result.execution.state.graphs.size, 0);
  assert.deepEqual(result.debug.interactionHistory, []);
});

test("applyTatAction updates a live runtime session without mutating source text", () => {
  const source = `
heroNode = <{ id: "hero", type: "character", name: "Hero" }>
goblinNode = <{ id: "goblin", type: "enemy", name: "Goblin" }>
attackNode = <{ id: "attack", type: "action", name: "Attack", actionKey: "attack" }>

attack := @action {
  pipeline:
    -> @graft.state(to, "hp", 0)
    -> @graft.meta(to, "status", defeated)
}

@seed:
  nodes: [heroNode, goblinNode, attackNode]
  edges: [
    [heroNode : "can" : attackNode],
    [heroNode : "targets" : goblinNode]
  ]
  state: {}
  meta: {}
  root: heroNode

battle := @seed
  -> @graft.state(goblinNode, "hp", 3)

battleMenu = battle <> @project {
  format: "menu"
  focus: heroNode
  include: [id, label, action, target, status]
}

battleDetail = battle <> @project {
  format: "detail"
  focus: heroNode
  include: [id, label, type, state, meta, value, actions, relationships, status]
}
`;

  const session = createTatRuntimeSession(source);
  const nextSession = applyTatAction(session, {
    graphBinding: "battle",
    from: "heroNode",
    action: "attack",
    target: "goblinNode",
  });
  const focusedSession = setTatFocus(nextSession, {
    graphBinding: "battle",
    nodeId: "goblinNode",
  });
  const result = inspectTatRuntimeSession(focusedSession);

  assert.equal(source.includes("@apply(<heroNode.attack.goblinNode>)"), false);
  assert.equal(result.debug.graphs.battle.nodes.find((node: any) => node.id === "goblinNode")?.state.hp, 0);
  assert.equal(result.debug.graphs.battle.nodes.find((node: any) => node.id === "goblinNode")?.meta.status, "defeated");
  assert.equal(result.debug.graphs.battle.history.at(-1)?.op, "@graft.meta");
  assert.equal(result.debug.graphs.battle.history.at(-2)?.op, "@graft.state");
  assert.equal(result.debug.graphs.battle.history.at(-3)?.op, "@apply");
  assert.equal((result.debug.projections.battleDetail as any).focus.id, "goblinNode");
});

test("runtime session projections use runtime-owned focus", () => {
  const session = createTatRuntimeSession(`
heroNode = <{ id: "hero", type: "character", name: "Hero" }>
allyNode = <{ id: "ally", type: "character", name: "Ally" }>

@seed:
  nodes: [heroNode, allyNode]
  edges: [[heroNode : "targets" : allyNode]]
  state: {}
  meta: {}
  root: heroNode

battle := @seed

battleList = battle <> @project {
  format: "list"
  focus: heroNode
  include: [id, label, type, status, value, state, meta]
}
`);

  const defaultResult = inspectTatRuntimeSession(session);
  const refocusedResult = inspectTatRuntimeSession(setTatFocus(session, {
    graphBinding: "battle",
    nodeId: "allyNode",
  }));

  assert.equal((defaultResult.debug.projections.battleList as any).focus.id, "heroNode");
  assert.equal((refocusedResult.debug.projections.battleList as any).focus.id, "allyNode");
});

test("runtime add/update/delete mutations append graph history entries", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>
spouseNode = <{ id: "spouse", type: "person", fullName: "Spouse" }>

@seed:
  nodes: [selfNode, spouseNode]
  edges: []
  state: {}
  meta: {}
  root: selfNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const withChild = addTatNode(session, {
    graphBinding: "family",
    nodeId: "childNode",
    value: { id: "child", type: "person", fullName: "Child" },
    state: {},
    meta: { generation: "child" },
  });
  const withEdge = addTatEdge(withChild, {
    graphBinding: "family",
    subject: "selfNode",
    relation: "parentOf",
    object: "childNode",
  });
  const withEdit = updateTatNodeValue(withEdge, {
    graphBinding: "family",
    nodeId: "childNode",
    patch: { fullName: "Child Updated" },
  });
  const withDelete = deleteTatNode(withEdit, {
    graphBinding: "family",
    nodeId: "spouseNode",
  });
  const history = inspectTatRuntimeSession(withDelete).debug.graphs.family.history;

  assert.ok(history.some((entry: any) => entry.op === "@runtime.addNode"));
  assert.ok(history.some((entry: any) => entry.op === "@runtime.addEdge"));
  assert.ok(history.some((entry: any) => entry.op === "@runtime.updateNodeValue"));
  assert.ok(history.some((entry: any) => entry.op === "@runtime.deleteNode"));
});

test("runtime mutation transactions create one causal history group", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>
spouseNode = <{ id: "spouse", type: "person", fullName: "Spouse" }>

@seed:
  nodes: [selfNode, spouseNode]
  edges: [[selfNode : "spouseOf" : spouseNode]]
  state: {}
  meta: {}
  root: selfNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const preparedAddChild = prepareTatMutationTransaction(session, {
    label: "Add Child",
    actions: [
      {
        type: "addNode",
        payload: {
          graphBinding: "family",
          nodeId: "childNode",
          value: { id: "child", type: "person", fullName: "Child" },
          state: {},
          meta: { generation: "child" },
        },
      },
      {
        type: "addEdge",
        payload: {
          graphBinding: "family",
          subject: "selfNode",
          relation: "parentOf",
          object: "childNode",
        },
      },
      {
        type: "addEdge",
        payload: {
          graphBinding: "family",
          subject: "spouseNode",
          relation: "parentOf",
          object: "childNode",
        },
      },
    ],
  });
  const updatedSession = applyTatMutationTransaction(session, preparedAddChild);

  const history = inspectTatRuntimeSession(updatedSession).debug.graphs.family.history;
  const transactionEntry = history.find((entry: any) => entry.op === "@runtime.transaction");

  assert.ok(transactionEntry);
  assert.equal(transactionEntry.payload.label, "Add Child");

  const childEntries = history.filter(
    (entry: any) =>
      entry.op === "@runtime.addNode" || entry.op === "@runtime.addEdge",
  );

  assert.equal(childEntries.length, 3);
  assert.ok(childEntries.every((entry: any) => entry.causedBy === transactionEntry.id));
});

test("genealogy add child can execute through TAT actions with payload data", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>
spouseNode = <{ id: "spouse", type: "person", fullName: "Spouse" }>

addChild := @action {
  pipeline:
    -> @runtime.addNode(@runtime.generateNodeId("person"), { id: @runtime.generateValueId("person"), type: "person", fullName: payload.fullName, dateOfBirth: payload.dateOfBirth, biography: payload.biography }, {}, { generation: "child", order: @runtime.nextOrder(), role: "person" })
    -> @graft.branch(from, "parentOf", to)
}

claimChild := @action {
  pipeline:
    -> @graft.branch(from, "parentOf", to)
}

@seed:
  nodes: [selfNode, spouseNode]
  edges: [
    [selfNode : "spouseOf" : spouseNode],
    [spouseNode : "spouseOf" : selfNode]
  ]
  state: {}
  meta: {}
  root: selfNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const preparedAddChild = prepareTatMutationTransaction(session, {
    label: "Add Child",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "selfNode",
          action: "addChild",
          payload: {
            fullName: "Child Name",
            dateOfBirth: "2020-01-01",
            biography: "A child added through TAT action semantics.",
          },
        },
      },
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "spouseNode",
          action: "claimChild",
          target: undefined,
        },
      },
    ],
  });
  const childTarget = preparedAddChild.actions[0]?.payload?.target;
  assert.ok(childTarget);
  preparedAddChild.actions[1].payload.target = childTarget;

  const updatedSession = applyTatMutationTransaction(session, preparedAddChild);

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  const childNode = graph.nodes.find((node: any) => node.value.fullName === "Child Name");

  assert.ok(childNode);
  assert.match(childNode.id, /^personNode_/);
  assert.equal(childNode.value.id, `person_${childNode.id}`);
  assert.equal(childNode.value.fullName, "Child Name");
  assert.equal(childNode.value.dateOfBirth, "2020-01-01");
  assert.equal(childNode.meta.generation, "child");
  assert.equal(childNode.meta.order, 1);

  assert.ok(
    graph.edges.some(
      (edge: any) =>
        edge.subject === "selfNode" &&
        edge.relation === "parentOf" &&
        edge.object === childNode.id,
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge: any) =>
        edge.subject === "spouseNode" &&
        edge.relation === "parentOf" &&
        edge.object === childNode.id,
    ),
  );

  const transactionEntry = graph.history.find((entry: any) => entry.op === "@runtime.transaction");
  assert.ok(transactionEntry);
  assert.equal(transactionEntry.payload.label, "Add Child");

  const applyEntries = graph.history.filter((entry: any) => entry.op === "@apply");
  assert.equal(applyEntries.length, 2);
  assert.ok(applyEntries.every((entry: any) => entry.causedBy === transactionEntry.id));
  assert.ok(graph.history.some((entry: any) => entry.op === "@runtime.addNode"));
});

test("genealogy spouse parent edit and delete can execute through TAT actions", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>

addSpouse := @action {
  pipeline:
    -> @runtime.addNode(@runtime.generateNodeId("person"), { id: @runtime.generateValueId("person"), type: "person", fullName: payload.fullName, dateOfBirth: payload.dateOfBirth, biography: payload.biography }, {}, { generation: "self", order: @runtime.nextOrder(), role: "person" })
    -> @graft.branch(from, "spouseOf", to)
    -> @graft.branch(to, "spouseOf", from)
}

addParent := @action {
  guard:
    @derive.edgeCount {
      node: from
      relation: "parentOf"
      direction: "incoming"
    } < 2

  pipeline:
    -> @runtime.addNode(@runtime.generateNodeId("person"), { id: @runtime.generateValueId("person"), type: "person", fullName: payload.fullName, dateOfBirth: payload.dateOfBirth, biography: payload.biography }, {}, { generation: "parent", order: @runtime.nextOrder(), role: "person" })
    -> @graft.branch(to, "parentOf", from)
}

editPerson := @action {
  pipeline:
    -> @runtime.updateNodeValue(to, { fullName: payload.fullName, dateOfBirth: payload.dateOfBirth, biography: payload.biography })
}

deletePerson := @action {
  guard:
    @derive.meta {
      node: to
      key: "role"
    } !== "root"

  pipeline:
    -> @runtime.deleteNode(to)
}

@seed:
  nodes: [selfNode]
  edges: []
  state: {}
  meta: {}
  root: selfNode

family := @seed
  -> @graft.meta(selfNode, "role", "root")
`;

  const session = createTatRuntimeSession(source);
  const preparedSpouse = prepareTatMutationTransaction(session, {
    label: "Add Spouse",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "selfNode",
          action: "addSpouse",
          payload: {
            fullName: "Spouse Name",
            dateOfBirth: "1991-04-14",
            biography: "Spouse biography",
          },
        },
      },
    ],
  });
  const spouseTarget = preparedSpouse.actions[0]?.payload?.target;
  assert.ok(spouseTarget);
  const withSpouse = applyTatMutationTransaction(session, preparedSpouse);

  const preparedParent = prepareTatMutationTransaction(withSpouse, {
    label: "Add Parent",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "selfNode",
          action: "addParent",
          payload: {
            fullName: "Parent Name",
            dateOfBirth: "1960-05-01",
            biography: "Parent biography",
          },
        },
      },
    ],
  });
  const parentTarget = preparedParent.actions[0]?.payload?.target;
  assert.ok(parentTarget);
  const withParent = applyTatMutationTransaction(withSpouse, preparedParent);

  const withEdit = applyTatMutationTransaction(withParent, {
    label: "Edit Person",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: spouseTarget,
          action: "editPerson",
          target: spouseTarget,
          payload: {
            fullName: "Spouse Updated",
            dateOfBirth: "1991-04-14",
            biography: "Updated biography",
          },
        },
      },
    ],
  });

  const withDelete = applyTatMutationTransaction(withEdit, {
    label: "Delete Person",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: spouseTarget,
          action: "deletePerson",
          target: spouseTarget,
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(withDelete).debug.graphs.family;

  const parentNode = graph.nodes.find((node: any) => node.value.fullName === "Parent Name");
  assert.ok(parentNode);
  assert.match(parentNode.id, /^personNode_/);
  assert.equal(parentNode.value.id, `person_${parentNode.id}`);
  assert.equal(parentNode.meta.generation, "parent");
  assert.equal(parentNode.meta.order, 2);
  assert.ok(
    graph.edges.some(
      (edge: any) =>
        edge.subject === parentTarget &&
        edge.relation === "parentOf" &&
        edge.object === "selfNode",
    ),
  );

  assert.equal(graph.nodes.some((node: any) => node.id === spouseTarget), false);
  assert.ok(graph.history.some((entry: any) => entry.op === "@runtime.updateNodeValue"));
  assert.ok(graph.history.some((entry: any) => entry.op === "@runtime.deleteNode"));
});

test("@derive.count with arithmetic operators can guard addParent and block a third parent", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>
parentOneNode = <{ id: "parentOne", type: "person", fullName: "Parent One" }>
parentTwoNode = <{ id: "parentTwo", type: "person", fullName: "Parent Two" }>

addParent := @action {
  guard:
    @derive.edgeCount {
      node: from
      relation: "parentOf"
      direction: "incoming"
    } * 2 / 2 % 3 < 2

  pipeline:
    -> @runtime.addNode(@runtime.generateNodeId("person"), { id: @runtime.generateValueId("person"), type: "person", fullName: payload.fullName, dateOfBirth: payload.dateOfBirth, biography: payload.biography }, {}, { generation: "parent", order: @runtime.nextOrder() })
    -> @graft.branch(to, "parentOf", from)
}

@seed:
  nodes: [selfNode, parentOneNode, parentTwoNode]
  edges: [
    [parentOneNode : "parentOf" : selfNode],
    [parentTwoNode : "parentOf" : selfNode]
  ]
  state: {}
  meta: {}
  root: selfNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Add Parent",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "selfNode",
          action: "addParent",
          payload: {
            fullName: "Parent Three",
            dateOfBirth: "1959-02-02",
            biography: "Should not be created",
          },
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;

  assert.equal(graph.nodes.some((node: any) => node.id === "parentThreeNode"), false);
  assert.equal(
    graph.edges.filter(
      (edge: any) => edge.object === "selfNode" && edge.relation === "parentOf",
    ).length,
    2,
  );
  assert.equal(
    graph.history.some(
      (entry: any) => entry.op === "@runtime.addNode" && entry.payload.value?.fullName === "Parent Three",
    ),
    false,
  );
});

test("@derive.path can drive genealogy-style ancestor guards across multiple hops", () => {
  const source = `
childNode = <{ id: "child", type: "person", fullName: "Child" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
grandOneNode = <{ id: "grandOne", type: "person", fullName: "Grand One" }>
grandTwoNode = <{ id: "grandTwo", type: "person", fullName: "Grand Two" }>

markLineage := @action {
  guard:
    @derive.count {
      nodes: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
      }
    } === 3

  pipeline:
    -> @graft.meta(from, "lineageOk", true)
}

@seed:
  nodes: [childNode, parentNode, grandOneNode, grandTwoNode]
  edges: [
    [parentNode : "parentOf" : childNode],
    [grandOneNode : "parentOf" : parentNode],
    [grandTwoNode : "parentOf" : parentNode]
  ]
  state: {}
  meta: {}
  root: childNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Mark Lineage",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "childNode",
          action: "markLineage",
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  const childNode = graph.nodes.find((node: any) => node.id === "childNode");

  assert.equal(childNode?.meta?.lineageOk, true);
});

test("@derive.path handles relation arrays, both-direction traversal, and cycles safely", () => {
  const source = `
rootNode = <{ id: "root", type: "person", fullName: "Root" }>
spouseNode = <{ id: "spouse", type: "person", fullName: "Spouse" }>
childNode = <{ id: "child", type: "person", fullName: "Child" }>

markReachable := @action {
  guard:
    @derive.count {
      nodes: @derive.path {
        node: from
        relation: ["spouseOf", "parentOf"]
        direction: "both"
        depth: 4
      }
    } === 2

  pipeline:
    -> @graft.meta(from, "reachableOk", true)
}

@seed:
  nodes: [rootNode, spouseNode, childNode]
  edges: [
    [rootNode : "spouseOf" : spouseNode],
    [spouseNode : "spouseOf" : rootNode],
    [spouseNode : "parentOf" : childNode]
  ]
  state: {}
  meta: {}
  root: rootNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Mark Reachable",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "rootNode",
          action: "markReachable",
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  const rootNode = graph.nodes.find((node: any) => node.id === "rootNode");

  assert.equal(rootNode?.meta?.reachableOk, true);
  assert.equal(
    graph.history.some(
      (entry: any) =>
        entry.op === "@graft.meta" &&
        entry.payload?.nodeId === "rootNode" &&
        entry.payload?.key === "reachableOk",
    ),
    true,
  );
});

test("@derive.exists returns true for reachable genealogy ancestors and works in guards", () => {
  const source = `
childNode = <{ id: "child", type: "person", fullName: "Child" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
grandNode = <{ id: "grand", type: "person", fullName: "Grand" }>

hasGrandparent := @action {
  guard:
    @derive.exists {
      path: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
      }
    }

  pipeline:
    -> @graft.meta(from, "hasGrandparent", true)
}

@seed:
  nodes: [childNode, parentNode, grandNode]
  edges: [
    [parentNode : "parentOf" : childNode],
    [grandNode : "parentOf" : parentNode]
  ]
  state: {}
  meta: {}
  root: childNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Has Grandparent",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "childNode",
          action: "hasGrandparent",
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  const childNode = graph.nodes.find((node: any) => node.id === "childNode");
  assert.equal(childNode?.meta?.hasGrandparent, true);
});

test("@derive.exists returns false when no matching path exists", () => {
  const source = `
soloNode = <{ id: "solo", type: "person", fullName: "Solo" }>

hasGrandparent := @action {
  guard:
    @derive.exists {
      path: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
      }
    }

  pipeline:
    -> @graft.meta(from, "hasGrandparent", true)
}

@seed:
  nodes: [soloNode]
  edges: []
  state: {}
  meta: {}
  root: soloNode

family := @seed
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Has Grandparent",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "soloNode",
          action: "hasGrandparent",
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  const soloNode = graph.nodes.find((node: any) => node.id === "soloNode");
  assert.equal(soloNode?.meta?.hasGrandparent, undefined);
  assert.equal(
    graph.history.some(
      (entry: any) =>
        entry.op === "@graft.meta" &&
        entry.payload?.nodeId === "soloNode" &&
        entry.payload?.key === "hasGrandparent",
    ),
    false,
  );
});

test("@derive.path can filter results by meta, state, and value layers", () => {
  const source = `
childNode = <{ id: "child", type: "person", fullName: "Child" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
grandAliveNode = <{ id: "grandAlive", type: "person", fullName: "Grand Alive" }>
grandDormantNode = <{ id: "grandDormant", type: "person", fullName: "Grand Dormant" }>

markMeta := @action {
  guard:
    @derive.count {
      nodes: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
        where: node.meta.alive == true
      }
    } === 1

  pipeline:
    -> @graft.meta(from, "metaFilterOk", true)
}

markState := @action {
  guard:
    @derive.count {
      nodes: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
        where: node.state.enrolled == true
      }
    } === 2

  pipeline:
    -> @graft.meta(from, "stateFilterOk", true)
}

markValue := @action {
  guard:
    @derive.count {
      nodes: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
        where: node.value.fullName == "Grand Alive"
      }
    } === 1

  pipeline:
    -> @graft.meta(from, "valueFilterOk", true)
}

@seed:
  nodes: [childNode, parentNode, grandAliveNode, grandDormantNode]
  edges: [
    [parentNode : "parentOf" : childNode],
    [grandAliveNode : "parentOf" : parentNode],
    [grandDormantNode : "parentOf" : parentNode]
  ]
  state: {}
  meta: {}
  root: childNode

family := @seed
  -> @graft.meta(grandAliveNode, "alive", true)
  -> @graft.meta(grandDormantNode, "alive", false)
  -> @graft.state(grandAliveNode, "enrolled", true)
  -> @graft.state(grandDormantNode, "enrolled", true)
`;

  let session = createTatRuntimeSession(source);
  for (const action of ["markMeta", "markState", "markValue"]) {
    session = applyTatMutationTransaction(session, {
      label: action,
      actions: [
        {
          type: "action",
          payload: {
            graphBinding: "family",
            from: "childNode",
            action,
          },
        },
      ],
    });
  }

  const graph = inspectTatRuntimeSession(session).debug.graphs.family;
  const childNode = graph.nodes.find((node: any) => node.id === "childNode");
  assert.equal(childNode?.meta?.metaFilterOk, true);
  assert.equal(childNode?.meta?.stateFilterOk, true);
  assert.equal(childNode?.meta?.valueFilterOk, true);
});

test("@derive.collect and @derive.sum compose over filtered path results", () => {
  const source = `
childNode = <{ id: "child", type: "person", fullName: "Child" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
grandOneNode = <{ id: "grandOne", type: "person", fullName: "Grand One" }>
grandTwoNode = <{ id: "grandTwo", type: "person", fullName: "Grand Two" }>

markScore := @action {
  guard:
    @derive.sum {
      collect: @derive.collect {
        path: @derive.path {
          node: from
          relation: "parentOf"
          direction: "incoming"
          depth: 2
          where: node.meta.alive == true
        }
        layer: "state"
        key: "score"
      }
    } === 10

  pipeline:
    -> @graft.meta(from, "scoreOk", true)
}

@seed:
  nodes: [childNode, parentNode, grandOneNode, grandTwoNode]
  edges: [
    [parentNode : "parentOf" : childNode],
    [grandOneNode : "parentOf" : parentNode],
    [grandTwoNode : "parentOf" : parentNode]
  ]
  state: {}
  meta: {}
  root: childNode

family := @seed
  -> @graft.meta(parentNode, "alive", false)
  -> @graft.meta(grandOneNode, "alive", true)
  -> @graft.meta(grandTwoNode, "alive", true)
  -> @graft.state(grandOneNode, "score", 3)
  -> @graft.state(grandTwoNode, "score", 7)
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Mark Score",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "childNode",
          action: "markScore",
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  const childNode = graph.nodes.find((node: any) => node.id === "childNode");
  assert.equal(childNode?.meta?.scoreOk, true);
});

test("@derive.sum fails cleanly on non-numeric collected values", () => {
  const source = `
childNode = <{ id: "child", type: "person", fullName: "Child" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>

badSum := @action {
  guard:
    @derive.sum {
      collect: @derive.collect {
        path: @derive.path {
          node: from
          relation: "parentOf"
          direction: "incoming"
          depth: 1
        }
        layer: "value"
        key: "fullName"
      }
    } > 0

  pipeline:
    -> @graft.meta(from, "shouldNotRun", true)
}

@seed:
  nodes: [childNode, parentNode]
  edges: [[parentNode : "parentOf" : childNode]]
  state: {}
  meta: {}
  root: childNode

family := @seed
`;

  const session = createTatRuntimeSession(source);

  assert.throws(
    () =>
      applyTatMutationTransaction(session, {
        label: "Bad Sum",
        actions: [
          {
            type: "action",
            payload: {
              graphBinding: "family",
              from: "childNode",
              action: "badSum",
            },
          },
        ],
      }),
    /@derive\.sum requires all collected values to be numeric/,
  );
});

test("@derive.path where supports boolean logic, derived expressions, and missing keys evaluate false", () => {
  const source = `
childNode = <{ id: "child", type: "person", fullName: "Child" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
grandNode = <{ id: "grand", type: "person", fullName: "Grand" }>

markComplex := @action {
  guard:
    @derive.count {
      nodes: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
        where: (node.state.age > 60 && node.meta.alive == true) || @derive.exists { path: @derive.path { node: node relation: "parentOf" direction: "incoming" depth: 1 } }
      }
    } === 2 && @derive.count {
      nodes: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 2
        where: !(node.state.missing == true)
      }
    } === 2

  pipeline:
    -> @graft.meta(from, "complexWhereOk", true)
}

@seed:
  nodes: [childNode, parentNode, grandNode]
  edges: [
    [parentNode : "parentOf" : childNode],
    [grandNode : "parentOf" : parentNode]
  ]
  state: {}
  meta: {}
  root: childNode

family := @seed
  -> @graft.state(parentNode, "age", 40)
  -> @graft.state(grandNode, "age", 70)
  -> @graft.meta(grandNode, "alive", true)
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Mark Complex",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "childNode",
          action: "markComplex",
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  const childNode = graph.nodes.find((node: any) => node.id === "childNode");
  assert.equal(childNode?.meta?.complexWhereOk, true);
});

test("@derive.path where throws on non-boolean expressions", () => {
  const source = `
childNode = <{ id: "child", type: "person", fullName: "Child" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>

badWhere := @action {
  guard:
    @derive.exists {
      path: @derive.path {
        node: from
        relation: "parentOf"
        direction: "incoming"
        depth: 1
        where: node.state.age
      }
    }

  pipeline:
    -> @graft.meta(from, "badWhere", true)
}

@seed:
  nodes: [childNode, parentNode]
  edges: [[parentNode : "parentOf" : childNode]]
  state: {}
  meta: {}
  root: childNode

family := @seed
  -> @graft.state(parentNode, "age", 40)
`;

  const session = createTatRuntimeSession(source);

  assert.throws(
    () =>
      applyTatMutationTransaction(session, {
        label: "Bad Where",
        actions: [
          {
            type: "action",
            payload: {
              graphBinding: "family",
              from: "childNode",
              action: "badWhere",
            },
          },
        ],
      }),
    /@derive\.path where must evaluate to a boolean/,
  );
});

test("deletePerson guard blocks deleting the root person in TAT", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>

deletePerson := @action {
  guard:
    @derive.meta {
      node: to
      key: "role"
    } !== "root"

  pipeline:
    -> @runtime.deleteNode(to)
}

@seed:
  nodes: [selfNode]
  edges: []
  state: {}
  meta: {}
  root: selfNode

family := @seed
  -> @graft.meta(selfNode, "role", "root")
`;

  const session = createTatRuntimeSession(source);
  const updatedSession = applyTatMutationTransaction(session, {
    label: "Delete Person",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "selfNode",
          action: "deletePerson",
          target: "selfNode",
        },
      },
    ],
  });

  const graph = inspectTatRuntimeSession(updatedSession).debug.graphs.family;
  assert.equal(graph.nodes.some((node: any) => node.id === "selfNode"), true);
  assert.equal(
    graph.history.some((entry: any) => entry.op === "@runtime.deleteNode"),
    false,
  );
});

test("node captures extract semanticId and contract as first-class node properties", () => {
  const session = createTatRuntimeSession(`
rootNode = <{ id: "root", semanticId: "person.root", contract: { in: ["person"], out: ["ancestor", "relative"] }, fullName: "Root Person", type: "person" }>

@seed:
  nodes: [rootNode]
  edges: []
  state: {}
  meta: {}
  root: rootNode

family := @seed

familyDetail = family <> @project {
  format: "detail"
  focus: rootNode
  include: [id, label, type, value, state, meta, status]
}
`);

  const inspected = inspectTatRuntimeSession(session);
  const graphNode = inspected.debug.graphs.family.nodes[0];
  const detailNode = (inspected.debug.projections.familyDetail as any).node;
  const bindingNode = inspected.debug.bindings.nodes.rootNode;

  assert.equal(graphNode.semanticId, "person.root");
  assert.deepEqual(graphNode.contract, {
    in: ["person"],
    out: ["ancestor", "relative"],
  });
  assert.deepEqual(graphNode.value, {
    id: "root",
    fullName: "Root Person",
    type: "person",
  });

  assert.equal(detailNode.semanticId, "person.root");
  assert.deepEqual(detailNode.contract, {
    in: ["person"],
    out: ["ancestor", "relative"],
  });
  assert.deepEqual(bindingNode.contract, {
    in: ["person"],
    out: ["ancestor", "relative"],
  });
});

test("node capture validation rejects invalid semanticId and contract shapes", () => {
  assert.throws(
    () =>
      createTatRuntimeSession(`
badNode = <{ semanticId: 123, contract: { in: ["word"], out: [1] }, label: "Bad" }>

@seed:
  nodes: [badNode]
  edges: []
  state: {}
  meta: {}
  root: badNode

graph := @seed
`),
    /semanticId must be a string literal|contract\.out entries must be string literals/,
  );
});

test("runtime addNode actions lift semanticId and contract into first-class node fields", () => {
  const session = createTatRuntimeSession(`
selfNode = <{ id: "self", semanticId: "person.self", contract: { in: ["spouseOf"], out: ["spouseOf", "parentOf"] }, type: "person", fullName: "Self" }>

addChild := @action {
  pipeline:
    -> @runtime.addNode(@runtime.generateNodeId("person"), { semanticId: @runtime.generateValueId("person"), contract: { in: ["parentOf"] }, id: @runtime.generateValueId("person"), type: "person", fullName: payload.fullName }, {}, {})
    -> @graft.branch(from, "parentOf", to, { kind: "birth" })
}

@seed:
  nodes: [selfNode]
  edges: []
  state: {}
  meta: {}
  root: selfNode

family := @seed
`);

  const prepared = prepareTatMutationTransaction(session, {
    label: "Add Child",
    actions: [
      {
        type: "action",
        payload: {
          graphBinding: "family",
          from: "selfNode",
          action: "addChild",
          payload: {
            fullName: "Chris",
          },
        },
      },
    ],
  });

  const updated = applyTatMutationTransaction(session, prepared);
  const graph = inspectTatRuntimeSession(updated).debug.graphs.family;
  const createdNodeId = prepared.actions[0]?.payload?.target;
  const createdNode = graph.nodes.find((node: any) => node.id === createdNodeId);

  assert.ok(createdNode);
  assert.equal(createdNode.semanticId, `person_${createdNodeId}`);
  assert.deepEqual(createdNode.contract, {
    in: ["parentOf"],
  });
  assert.deepEqual(createdNode.value, {
    id: `person_${createdNodeId}`,
    type: "person",
    fullName: "Chris",
  });
});

test("runtime action requests support hook/to intent aliases", () => {
  const session = createTatRuntimeSession(`
selfNode = <{ id: "self", type: "person", fullName: "Self" }>
childNode = <{ id: "child", type: "person", fullName: "Child" }>

claimChild := @action {
  pipeline:
    -> @graft.branch(from, "parentOf", to, { kind: "birth" })
}

@seed:
  nodes: [selfNode, childNode]
  edges: []
  state: {}
  meta: {}
  root: selfNode

family := @seed
`);

  const updated = applyTatAction(session, {
    graphBinding: "family",
    from: "selfNode",
    hook: "claimChild",
    to: "childNode",
  });

  const inspected = inspectTatRuntimeSession(updated).debug.graphs.family;
  assert.ok(
    inspected.edges.some(
      (edge: any) =>
        edge.subject === "selfNode" &&
        edge.relation === "parentOf" &&
        edge.object === "childNode" &&
        edge.meta?.kind === "birth",
    ),
  );
  assert.ok(
    inspected.history.some(
      (entry: any) => entry.op === "@apply" && entry.payload.hook === "claimChild",
    ),
  );
});

test("@prune.branch metadata matches only the targeted typed edge", () => {
  const result = executeTat(`
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
childNode = <{ id: "child", type: "person", fullName: "Child" }>

@seed:
  nodes: [parentNode, childNode]
  edges: []
  state: {}
  meta: {}
  root: parentNode

family := @seed
  -> @graft.branch(parentNode, "parentOf", childNode, { kind: "birth" })
  -> @graft.branch(parentNode, "parentOf", childNode, { kind: "step" })
  -> @prune.branch(parentNode, "parentOf", childNode, { kind: "step" })
`);

  const graph = result.execution.state.graphs.get("family");
  const matchingEdges = graph?.edges.filter(
    (edge) =>
      edge.subject === "parentNode" &&
      edge.object === "childNode" &&
      edge.relation === "parentOf",
  ) ?? [];

  assert.equal(matchingEdges.length, 1);
  assert.equal(matchingEdges[0]?.meta.kind, "birth");
});

test("contract eligibility helpers support directed and handshake semantics", () => {
  const parentNode = {
    id: "parent",
    value: {},
    state: {},
    meta: {},
    contract: { in: ["spouseOf"], out: ["parentOf", "spouseOf"] },
  } as any;
  const childNode = {
    id: "child",
    value: {},
    state: {},
    meta: {},
    contract: { in: ["parentOf"] },
  } as any;
  const spouseNode = {
    id: "spouse",
    value: {},
    state: {},
    meta: {},
    contract: { in: ["spouseOf"], out: ["spouseOf"] },
  } as any;

  assert.equal(
    hasDirectedContractEligibility(parentNode, childNode, "parentOf"),
    true,
  );
  assert.equal(
    hasHandshakeContractEligibility(parentNode, childNode, "parentOf"),
    false,
  );
  assert.equal(
    hasHandshakeContractEligibility(parentNode, spouseNode, "spouseOf"),
    true,
  );
});

test("relationship comparison resolves supported genealogy relationships", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>
spouseNode = <{ id: "spouse", type: "person", fullName: "Spouse" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
grandNode = <{ id: "grand", type: "person", fullName: "Grand" }>
childNode = <{ id: "child", type: "person", fullName: "Child" }>
siblingNode = <{ id: "sibling", type: "person", fullName: "Sibling" }>
auntNode = <{ id: "aunt", type: "person", fullName: "Aunt" }>
cousinNode = <{ id: "cousin", type: "person", fullName: "Cousin" }>
cousinChildNode = <{ id: "cousinChild", type: "person", fullName: "Cousin Child" }>

@seed:
  nodes: [selfNode, spouseNode, parentNode, grandNode, childNode, siblingNode, auntNode, cousinNode, cousinChildNode]
  edges: [
    [selfNode : "spouseOf" : spouseNode],
    [spouseNode : "spouseOf" : selfNode],
    [parentNode : "parentOf" : selfNode],
    [parentNode : "parentOf" : siblingNode],
    [grandNode : "parentOf" : parentNode],
    [grandNode : "parentOf" : auntNode],
    [auntNode : "parentOf" : cousinNode],
    [cousinNode : "parentOf" : cousinChildNode],
    [selfNode : "parentOf" : childNode],
    [spouseNode : "parentOf" : childNode]
  ]
  state: {}
  meta: {}
  root: selfNode

family := @seed
`;

  const session = createTatRuntimeSession(source);

  const selfResult = compareTatRelationship(session, {
    graphBinding: "family",
    fromId: "selfNode",
    toId: "selfNode",
  });
  assert.deepEqual(selfResult.from, { id: "selfNode", label: "Self" });
  assert.deepEqual(selfResult.to, { id: "selfNode", label: "Self" });
  assert.deepEqual(selfResult.relationship, { type: "self", label: "self" });
  assert.deepEqual(selfResult.pathNodeIds, ["selfNode"]);
  assert.deepEqual(selfResult.pathEdges, []);
  assert.deepEqual(selfResult.highlight, {
    selectedPathNodeIds: [],
    selectedPathEdges: [],
    commonNodeIds: [],
    commonEdges: [],
    targetPathNodeIds: [],
    targetPathEdges: [],
  });
  assert.ok(Array.isArray(selfResult.availableCommonAncestors));

  const spouseResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "spouseNode",
      toId: "selfNode",
    });
  assert.deepEqual(spouseResult.relationship, { type: "spouse", label: "spouse" });
  assert.deepEqual(spouseResult.pathNodeIds, ["spouseNode", "selfNode"]);
  assert.deepEqual(spouseResult.pathEdges, [
    { from: "spouseNode", relation: "spouseOf", to: "selfNode" },
  ]);

  const parentResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "parentNode",
      toId: "selfNode",
    });
  assert.deepEqual(parentResult.relationship, {
    type: "ancestor",
    label: "parent",
    depth: 1,
  });
  assert.deepEqual(parentResult.pathNodeIds, ["selfNode", "parentNode"]);
  assert.deepEqual(parentResult.pathEdges, [
    { from: "parentNode", relation: "parentOf", to: "selfNode" },
  ]);

  const grandResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "grandNode",
      toId: "selfNode",
    });
  assert.deepEqual(grandResult.relationship, {
    type: "ancestor",
    label: "grandparent",
    depth: 2,
  });
  assert.deepEqual(grandResult.pathNodeIds, ["selfNode", "parentNode", "grandNode"]);

  const childResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "childNode",
      toId: "selfNode",
    });
  assert.deepEqual(childResult.relationship, {
    type: "descendant",
    label: "child",
    depth: 1,
  });
  assert.deepEqual(childResult.pathNodeIds, ["selfNode", "childNode"]);
  assert.deepEqual(childResult.pathEdges, [
    { from: "selfNode", relation: "parentOf", to: "childNode" },
  ]);

  addBranch(session.state.graphs.get("family")!, "selfNode", "parentOf", "childNode", {
    metadata: { kind: "step" },
  });

  const stepParentResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "selfNode",
      toId: "childNode",
    });
  assert.deepEqual(stepParentResult.relationship, {
    type: "stepParent",
    label: "step-parent",
  });
  assert.deepEqual(stepParentResult.pathNodeIds, ["selfNode", "spouseNode", "childNode"]);
  assert.deepEqual(stepParentResult.pathEdges, [
    { from: "selfNode", relation: "spouseOf", to: "spouseNode" },
    { from: "spouseNode", relation: "parentOf", to: "childNode" },
  ]);

  const stepChildResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "childNode",
      toId: "selfNode",
    });
  assert.deepEqual(stepChildResult.relationship, {
    type: "stepChild",
    label: "step-child",
  });
  assert.deepEqual(stepChildResult.pathNodeIds, ["childNode", "spouseNode", "selfNode"]);
  assert.deepEqual(stepChildResult.pathEdges, [
    { from: "spouseNode", relation: "parentOf", to: "childNode" },
    { from: "selfNode", relation: "spouseOf", to: "spouseNode" },
  ]);

  const siblingResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "siblingNode",
      toId: "selfNode",
    });
  assert.deepEqual(siblingResult.relationship, {
    type: "sibling",
    label: "sibling",
  });
  assert.deepEqual(
    siblingResult.availableCommonAncestors.map((ancestor) => ancestor.id),
    ["parentNode", "grandNode"],
  );
  assert.deepEqual(siblingResult.pathNodeIds, ["siblingNode", "parentNode", "selfNode"]);
  assert.deepEqual(siblingResult.highlight, {
    selectedPathNodeIds: ["siblingNode"],
    selectedPathEdges: [
      { from: "parentNode", relation: "parentOf", to: "siblingNode" },
    ],
    commonNodeIds: ["parentNode"],
    commonEdges: [],
    targetPathNodeIds: ["selfNode"],
    targetPathEdges: [
      { from: "parentNode", relation: "parentOf", to: "selfNode" },
    ],
  });

  const siblingViaGrandResult = compareTatRelationship(session, {
    graphBinding: "family",
    fromId: "siblingNode",
    toId: "selfNode",
    selectedCommonAncestorId: "grandNode",
  });
  assert.equal(siblingViaGrandResult.selectedCommonAncestorId, "grandNode");
  assert.deepEqual(siblingViaGrandResult.pathNodeIds, [
    "siblingNode",
    "parentNode",
    "grandNode",
    "selfNode",
  ]);
  assert.deepEqual(siblingViaGrandResult.pathEdges, [
    { from: "grandNode", relation: "parentOf", to: "parentNode" },
    { from: "parentNode", relation: "parentOf", to: "siblingNode" },
    { from: "parentNode", relation: "parentOf", to: "selfNode" },
  ]);
  assert.deepEqual(siblingViaGrandResult.highlight, {
    selectedPathNodeIds: ["siblingNode"],
    selectedPathEdges: [
      { from: "parentNode", relation: "parentOf", to: "siblingNode" },
    ],
    commonNodeIds: ["grandNode", "parentNode"],
    commonEdges: [
      { from: "grandNode", relation: "parentOf", to: "parentNode" },
    ],
    targetPathNodeIds: ["selfNode"],
    targetPathEdges: [
      { from: "parentNode", relation: "parentOf", to: "selfNode" },
    ],
  });

  const auntResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "auntNode",
      toId: "selfNode",
    });
  assert.deepEqual(auntResult.relationship, {
    type: "auntUncle",
    label: "aunt/uncle",
  });
  assert.deepEqual(auntResult.pathNodeIds, ["auntNode", "grandNode", "parentNode", "selfNode"]);
  assert.deepEqual(auntResult.pathEdges, [
    { from: "grandNode", relation: "parentOf", to: "auntNode" },
    { from: "grandNode", relation: "parentOf", to: "parentNode" },
    { from: "parentNode", relation: "parentOf", to: "selfNode" },
  ]);

  const nieceResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "selfNode",
      toId: "auntNode",
    });
  assert.deepEqual(nieceResult.relationship, {
    type: "nieceNephew",
    label: "niece/nephew",
  });
  assert.deepEqual(nieceResult.pathNodeIds, [
    "selfNode",
    "parentNode",
    "grandNode",
    "auntNode",
  ]);
  assert.deepEqual(nieceResult.pathEdges, [
    { from: "parentNode", relation: "parentOf", to: "selfNode" },
    { from: "grandNode", relation: "parentOf", to: "parentNode" },
    { from: "grandNode", relation: "parentOf", to: "auntNode" },
  ]);

  const cousinResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "cousinNode",
      toId: "selfNode",
    });
  assert.deepEqual(cousinResult.relationship, {
    type: "cousin",
    degree: 1,
    removed: 0,
    label: "first cousin",
  });
  assert.deepEqual(cousinResult.sharedAncestor, {
    id: "grandNode",
    label: "Grand",
  });
  assert.deepEqual(cousinResult.depths, {
    from: 2,
    to: 2,
  });
  assert.deepEqual(cousinResult.pathNodeIds, [
    "cousinNode",
    "auntNode",
    "grandNode",
    "parentNode",
    "selfNode",
  ]);
  assert.deepEqual(cousinResult.pathEdges, [
    { from: "grandNode", relation: "parentOf", to: "auntNode" },
    { from: "auntNode", relation: "parentOf", to: "cousinNode" },
    { from: "grandNode", relation: "parentOf", to: "parentNode" },
    { from: "parentNode", relation: "parentOf", to: "selfNode" },
  ]);
  assert.deepEqual(cousinResult.highlight, {
    selectedPathNodeIds: ["cousinNode", "auntNode"],
    selectedPathEdges: [
      { from: "grandNode", relation: "parentOf", to: "auntNode" },
      { from: "auntNode", relation: "parentOf", to: "cousinNode" },
    ],
    commonNodeIds: ["grandNode"],
    commonEdges: [],
    targetPathNodeIds: ["parentNode", "selfNode"],
    targetPathEdges: [
      { from: "grandNode", relation: "parentOf", to: "parentNode" },
      { from: "parentNode", relation: "parentOf", to: "selfNode" },
    ],
  });

  const cousinRemovedResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "cousinChildNode",
      toId: "selfNode",
    });
  assert.deepEqual(cousinRemovedResult.relationship, {
    type: "cousin",
    degree: 1,
    removed: 1,
    label: "first cousin once removed",
  });
  assert.deepEqual(cousinRemovedResult.sharedAncestor, {
    id: "grandNode",
    label: "Grand",
  });
  assert.deepEqual(cousinRemovedResult.depths, {
    from: 3,
    to: 2,
  });
  assert.deepEqual(cousinRemovedResult.pathNodeIds, [
    "cousinChildNode",
    "cousinNode",
    "auntNode",
    "grandNode",
    "parentNode",
    "selfNode",
  ]);

  assert.deepEqual(nieceResult.highlight, {
    selectedPathNodeIds: ["selfNode", "parentNode"],
    selectedPathEdges: [
      { from: "parentNode", relation: "parentOf", to: "selfNode" },
      { from: "grandNode", relation: "parentOf", to: "parentNode" },
    ],
    commonNodeIds: ["grandNode"],
    commonEdges: [],
    targetPathNodeIds: ["auntNode"],
    targetPathEdges: [
      { from: "grandNode", relation: "parentOf", to: "auntNode" },
    ],
  });

  const parentInLawResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "parentNode",
      toId: "spouseNode",
    });
  assert.deepEqual(parentInLawResult.relationship, {
    type: "parentInLaw",
    label: "parent-in-law",
  });
  assert.deepEqual(parentInLawResult.pathNodeIds, [
    "parentNode",
    "selfNode",
    "spouseNode",
  ]);
  assert.deepEqual(parentInLawResult.pathEdges, [
    { from: "parentNode", relation: "parentOf", to: "selfNode" },
    { from: "selfNode", relation: "spouseOf", to: "spouseNode" },
  ]);

  const childInLawResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "spouseNode",
      toId: "parentNode",
    });
  assert.deepEqual(childInLawResult.relationship, {
    type: "childInLaw",
    label: "child-in-law",
  });
  assert.deepEqual(childInLawResult.pathNodeIds, [
    "spouseNode",
    "selfNode",
    "parentNode",
  ]);
  assert.deepEqual(childInLawResult.pathEdges, [
    { from: "parentNode", relation: "parentOf", to: "selfNode" },
    { from: "selfNode", relation: "spouseOf", to: "spouseNode" },
  ]);

  const unknownResult = compareTatRelationship(session, {
      graphBinding: "family",
      fromId: "childNode",
      toId: "auntNode",
    });
  assert.deepEqual(unknownResult.relationship, {
    type: "unknown",
    label: "of unknown relationship",
  });
  assert.deepEqual(unknownResult.pathNodeIds, []);
  assert.deepEqual(unknownResult.pathEdges, []);
});

test("relationship comparison derives cousin degree and removed labels from shared ancestor depth", () => {
  const source = `
rootNode = <{ id: "root", type: "person", fullName: "Root" }>
leftParentNode = <{ id: "leftParent", type: "person", fullName: "Left Parent" }>
rightParentNode = <{ id: "rightParent", type: "person", fullName: "Right Parent" }>
leftGrandNode = <{ id: "leftGrand", type: "person", fullName: "Left Grand" }>
rightGrandNode = <{ id: "rightGrand", type: "person", fullName: "Right Grand" }>
leftGreatNode = <{ id: "leftGreat", type: "person", fullName: "Left Great" }>
rightGreatNode = <{ id: "rightGreat", type: "person", fullName: "Right Great" }>
secondCousinLeftNode = <{ id: "secondCousinLeft", type: "person", fullName: "Second Cousin Left" }>
secondCousinRightNode = <{ id: "secondCousinRight", type: "person", fullName: "Second Cousin Right" }>
thirdCousinLeftNode = <{ id: "thirdCousinLeft", type: "person", fullName: "Third Cousin Left" }>
thirdCousinRightNode = <{ id: "thirdCousinRight", type: "person", fullName: "Third Cousin Right" }>

@seed:
  nodes: [
    rootNode,
    leftParentNode,
    rightParentNode,
    leftGrandNode,
    rightGrandNode,
    leftGreatNode,
    rightGreatNode,
    secondCousinLeftNode,
    secondCousinRightNode,
    thirdCousinLeftNode,
    thirdCousinRightNode
  ]
  edges: [
    [rootNode : "parentOf" : leftParentNode],
    [rootNode : "parentOf" : rightParentNode],
    [leftParentNode : "parentOf" : leftGrandNode],
    [rightParentNode : "parentOf" : rightGrandNode],
    [leftGrandNode : "parentOf" : secondCousinLeftNode],
    [rightGrandNode : "parentOf" : secondCousinRightNode],
    [secondCousinLeftNode : "parentOf" : leftGreatNode],
    [secondCousinRightNode : "parentOf" : rightGreatNode],
    [leftGreatNode : "parentOf" : thirdCousinLeftNode],
    [rightGreatNode : "parentOf" : thirdCousinRightNode]
  ]
  state: {}
  meta: {}
  root: rootNode

family := @seed
`;

  const session = createTatRuntimeSession(source);

  const secondCousinResult = compareTatRelationship(session, {
    graphBinding: "family",
    fromId: "secondCousinLeftNode",
    toId: "secondCousinRightNode",
  });
  assert.deepEqual(secondCousinResult.relationship, {
    type: "cousin",
    degree: 2,
    removed: 0,
    label: "second cousin",
  });
  assert.deepEqual(secondCousinResult.sharedAncestor, {
    id: "rootNode",
    label: "Root",
  });
  assert.deepEqual(secondCousinResult.depths, {
    from: 3,
    to: 3,
  });

  const thirdCousinResult = compareTatRelationship(session, {
    graphBinding: "family",
    fromId: "leftGreatNode",
    toId: "rightGreatNode",
  });
  assert.deepEqual(thirdCousinResult.relationship, {
    type: "cousin",
    degree: 3,
    removed: 0,
    label: "third cousin",
  });
  assert.deepEqual(thirdCousinResult.sharedAncestor, {
    id: "rootNode",
    label: "Root",
  });
  assert.deepEqual(thirdCousinResult.depths, {
    from: 4,
    to: 4,
  });
});

test("relationship comparison stays correct against the imported five-generation demo family", () => {
  const session = loadRuntimeSessionFromImportPayload(
    "../src/app/examples/5-generation-demo.json",
  );
  const graph = session.state.graphs.get("family");
  assert.ok(graph);

  const nodes = [...graph.nodes.values()];
  const nodeIdByName = new Map(
    nodes.map((node) => [String((node.value as Record<string, unknown>).fullName), node.id]),
  );

  function compareByName(fromName: string, toName: string) {
    const fromId = nodeIdByName.get(fromName);
    const toId = nodeIdByName.get(toName);
    assert.ok(fromId, `Missing node for ${fromName}`);
    assert.ok(toId, `Missing node for ${toName}`);

    return compareTatRelationship(session, {
      graphBinding: "family",
      fromId,
      toId,
    });
  }

  assert.deepEqual(compareByName("Harper Brooks", "Noah Reed").relationship, {
    type: "spouse",
    label: "spouse",
  });
  assert.deepEqual(compareByName("Noah Reed", "Ella Reed").relationship, {
    type: "ancestor",
    label: "parent",
    depth: 1,
  });
  assert.deepEqual(compareByName("Ella Reed", "Noah Reed").relationship, {
    type: "descendant",
    label: "child",
    depth: 1,
  });
  assert.deepEqual(compareByName("Ella Reed", "Mason Reed").relationship, {
    type: "sibling",
    label: "sibling",
  });
  assert.deepEqual(compareByName("Noah Reed", "Owen Brooks").relationship, {
    type: "stepParent",
    label: "step-parent",
  });
  assert.deepEqual(compareByName("Emma Reed", "Caleb Reed").relationship, {
    type: "cousin",
    degree: 1,
    removed: 0,
    label: "first cousin",
  });
  assert.deepEqual(compareByName("Michael Bennett", "Noah Reed").relationship, {
    type: "cousin",
    degree: 1,
    removed: 0,
    label: "first cousin",
  });
  assert.deepEqual(compareByName("Julia Bennett", "Noah Reed").relationship, {
    type: "cousin",
    degree: 1,
    removed: 0,
    label: "first cousin",
  });

  assert.deepEqual(compareByName("Walter Hayes", "Noah Reed").relationship, {
    type: "ancestor",
    label: "great grandparent",
    depth: 3,
  });
  assert.deepEqual(compareByName("Noah Reed", "Jack Hayes").relationship, {
    type: "cousin",
    degree: 1,
    removed: 0,
    label: "first cousin",
  });
  assert.deepEqual(compareByName("Emma Reed", "Noah Reed").relationship, {
    type: "cousin",
    degree: 1,
    removed: 1,
    label: "first cousin once removed",
  });
  assert.deepEqual(compareByName("Caleb Reed", "Noah Reed").relationship, {
    type: "cousin",
    degree: 1,
    removed: 1,
    label: "first cousin once removed",
  });
  assert.deepEqual(compareByName("Noah Reed", "Henry Hayes").relationship, {
    type: "cousin",
    degree: 1,
    removed: 1,
    label: "first cousin once removed",
  });
  assert.deepEqual(compareByName("Noah Reed", "Isabel Hayes").relationship, {
    type: "cousin",
    degree: 1,
    removed: 1,
    label: "first cousin once removed",
  });
});

test("common ancestor query returns deduped shared ancestors with count and stable order", () => {
  const source = `
selfNode = <{ id: "self", type: "person", fullName: "Self" }>
parentNode = <{ id: "parent", type: "person", fullName: "Parent" }>
otherParentNode = <{ id: "other-parent", type: "person", fullName: "Other Parent" }>
grandNode = <{ id: "grand", type: "person", fullName: "Grand" }>
otherGrandNode = <{ id: "other-grand", type: "person", fullName: "Other Grand" }>
siblingNode = <{ id: "sibling", type: "person", fullName: "Sibling" }>
unrelatedNode = <{ id: "unrelated", type: "person", fullName: "Unrelated" }>

@seed:
  nodes: [selfNode, parentNode, otherParentNode, grandNode, otherGrandNode, siblingNode, unrelatedNode]
  edges: [
    [parentNode : "parentOf" : selfNode],
    [parentNode : "parentOf" : siblingNode],
    [otherParentNode : "parentOf" : selfNode],
    [otherParentNode : "parentOf" : siblingNode],
    [grandNode : "parentOf" : parentNode],
    [grandNode : "parentOf" : otherParentNode],
    [otherGrandNode : "parentOf" : parentNode],
    [otherGrandNode : "parentOf" : otherParentNode]
  ]
  state: {}
  meta: {}
  root: selfNode

family := @seed
`;

  const session = createTatRuntimeSession(source);

  const result = queryTatCommonAncestors(session, {
    graphBinding: "family",
    fromId: "selfNode",
    toId: "siblingNode",
  });

  assert.deepEqual(result.from, { id: "selfNode", label: "Self" });
  assert.deepEqual(result.to, { id: "siblingNode", label: "Sibling" });
  assert.equal(result.count, 4);
  assert.deepEqual(
    result.ancestors.map((ancestor: any) => ancestor.id),
    ["otherParentNode", "parentNode", "grandNode", "otherGrandNode"],
  );

  const emptyResult = queryTatCommonAncestors(session, {
    graphBinding: "family",
    fromId: "selfNode",
    toId: "unrelatedNode",
  });

  assert.equal(emptyResult.count, 0);
  assert.deepEqual(emptyResult.ancestors, []);
});

test("runtime focus persists across action cycles", () => {
  const session = createTatRuntimeSession(`
heroNode = <{ id: "hero", type: "character", name: "Hero" }>
goblinNode = <{ id: "goblin", type: "enemy", name: "Goblin" }>
attackNode = <{ id: "attack", type: "action", name: "Attack", actionKey: "attack" }>

attack := @action {
  pipeline:
    -> @graft.meta(to, "status", defeated)
}

@seed:
  nodes: [heroNode, goblinNode, attackNode]
  edges: [
    [heroNode : "can" : attackNode],
    [heroNode : "targets" : goblinNode]
  ]
  state: {}
  meta: {}
  root: heroNode

battle := @seed

battleDetail = battle <> @project {
  format: "detail"
  focus: heroNode
  include: [id, label, type, state, meta, value, actions, relationships, status]
}
`);

  const focusedSession = setTatFocus(session, {
    graphBinding: "battle",
    nodeId: "goblinNode",
  });
  const updatedSession = applyTatAction(focusedSession, {
    graphBinding: "battle",
    from: "heroNode",
    action: "attack",
    target: "goblinNode",
  });
  const result = inspectTatRuntimeSession(updatedSession);

  assert.equal((result.debug.projections.battleDetail as any).focus.id, "goblinNode");
  assert.equal(
    result.debug.graphs.battle.nodes.find((node: any) => node.id === "goblinNode")?.meta.status,
    "defeated",
  );
});

test("executeGraphInteraction records workspace interaction history and causal graph history", () => {
  const workspace = createWorkspaceWithTarget({ hp: 3 });

  const interaction: GraphInteraction = {
    id: "attack",
    subjectGraphId: "hero",
    relation: "attacks",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        { op: "@graft.state", key: "has", value: "poison" },
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "-",
            left: { kind: "current" },
            right: { kind: "literal", value: 1 },
          },
        },
      ],
    },
  };

  const result = executeGraphInteraction(interaction, workspace);
  const updatedEnemy = result.workspace.graphs.get("enemy");
  const untouchedHero = result.workspace.graphs.get("hero");

  assert.deepEqual(result.changedGraphIds, ["enemy"]);
  assert.equal(updatedEnemy?.nodes.get("enemy_root")?.state.has, "poison");
  assert.equal(updatedEnemy?.nodes.get("enemy_root")?.state.hp, 2);
  assert.equal(untouchedHero?.nodes.get("hero_root")?.state.has, undefined);
  assert.equal(result.log.length, 2);
  assert.equal(result.log[0].op, "@graft.state");
  assert.equal(result.log[1].op, "@derive.state");

  const interactionEvent = result.workspace.interactionHistory[0] as GraphInteractionHistoryEntry;
  assert.equal(interactionEvent.op, "@interaction");
  assert.equal(interactionEvent.definitionId, "attack");
  assert.equal(interactionEvent.subjectGraphId, "hero");
  assert.equal(interactionEvent.objectGraphId, "enemy");
  assert.equal(interactionEvent.targetNodeId, "enemy_root");
  assert.equal(interactionEvent.effectEntryIds.length, 2);
  assert.equal(interactionEvent.summary?.effects?.length, 2);

  const history = updatedEnemy?.history ?? [];
  assert.equal(history[0].op, "@graft.state");
  assert.equal(history[1].op, "@derive.state");
  assert.equal(history[0].causedBy, interactionEvent.id);
  assert.equal(history[1].causedBy, interactionEvent.id);
  assert.deepEqual(
    history.map((entry) => entry.id),
    interactionEvent.effectEntryIds,
  );
});

test("@derive.state uses append semantics for non-numeric +", () => {
  const interaction: GraphInteraction = {
    id: "buff",
    subjectGraphId: "bard",
    relation: "inspires",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        {
          op: "@derive.state",
          key: "has",
          expression: {
            kind: "binary",
            operator: "+",
            left: { kind: "current" },
            right: { kind: "literal", value: "inspired" },
          },
        },
      ],
    },
  };

  const arrayResult = executeGraphInteraction(
    interaction,
    createWorkspaceWithTarget({ has: ["poison"] }),
  );
  assert.deepEqual(
    arrayResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.has,
    ["poison", "inspired"],
  );

  const scalarResult = executeGraphInteraction(
    interaction,
    createWorkspaceWithTarget({ has: "poison" }),
  );
  assert.deepEqual(
    scalarResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.has,
    ["poison", "inspired"],
  );

  const missingResult = executeGraphInteraction(interaction, createWorkspaceWithTarget({}));
  assert.deepEqual(
    missingResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.has,
    ["inspired"],
  );
});

test("@derive.state keeps previous stable across the whole effect and errors on missing numeric current", () => {
  const stablePreviousInteraction: GraphInteraction = {
    id: "combo",
    subjectGraphId: "hero",
    relation: "combos",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "-",
            left: { kind: "current" },
            right: { kind: "literal", value: 1 },
          },
        },
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "+",
            left: { kind: "current" },
            right: { kind: "previous" },
          },
        },
      ],
    },
  };

  const stableResult = executeGraphInteraction(
    stablePreviousInteraction,
    createWorkspaceWithTarget({ hp: 5 }),
  );
  assert.equal(
    stableResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.hp,
    9,
  );

  const missingCurrentInteraction: GraphInteraction = {
    id: "heal",
    subjectGraphId: "cleric",
    relation: "heals",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "+",
            left: { kind: "current" },
            right: { kind: "literal", value: 2 },
          },
        },
      ],
    },
  };

  assert.throws(
    () => executeGraphInteraction(missingCurrentInteraction, createWorkspaceWithTarget({})),
    /Missing current for numeric derive/,
  );
});

test("@why(nodeId) includes linked interaction provenance for interaction-driven mutations", () => {
  const workspace = createWorkspaceWithTarget({ hp: 3 });
  const interaction: GraphInteraction = {
    id: "strike",
    subjectGraphId: "hero",
    relation: "attacks",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        { op: "@graft.state", key: "has", value: "poison" },
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "-",
            left: { kind: "current" },
            right: { kind: "literal", value: 1 },
          },
        },
      ],
    },
  };

  const executed = executeGraphInteraction(interaction, workspace);
  const graph = executed.workspace.graphs.get("enemy");
  assert.ok(graph);

  const ast = parseTatToAst(`@why(enemy_root)`);
  const stmt = ast.body[0];
  assert.equal(stmt.type, "QueryStatement");
  const result = executeWhy(graph, stmt.expr, executed.workspace);

  assert.equal(result.kind, "ReasonResultSet");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].because.length, 2);
  assert.equal(result.items[0].becauseInteractions.length, 1);
  assert.equal(result.items[0].becauseInteractions[0].definitionId, "strike");
  assert.deepEqual(
    result.items[0].because.map((entry) => entry.causedBy),
    [result.items[0].becauseInteractions[0].id, result.items[0].becauseInteractions[0].id],
  );
});
