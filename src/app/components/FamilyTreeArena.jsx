import { useMemo, useRef } from "react";
import FamilyTreeConnectors from "./FamilyTreeConnectors";

function getNodeLabel(node) {
  if (!node) return "Unknown";

  const assembledName = [
    node.value?.firstName,
    node.value?.middleNames,
    node.value?.lastName,
    node.value?.suffix,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    assembledName ||
    node.value?.fullName ||
    node.value?.name ||
    node.meta?.label ||
    node.label ||
    node.id ||
    "Unknown"
  );
}

function getBirthdateSortValue(node) {
  const birthdate = node?.value?.dateOfBirth;
  if (!birthdate) {
    return null;
  }

  const normalized = String(birthdate).trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function sortRenderedChildren(children) {
  return [...(children ?? [])].sort((left, right) => {
    const leftBirthdate = getBirthdateSortValue(left);
    const rightBirthdate = getBirthdateSortValue(right);

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

    return getNodeLabel(left).localeCompare(getNodeLabel(right));
  });
}

function createSlotCard(id, label, intent) {
  return {
    id,
    isPlaceholder: true,
    addLabel: label,
    intent,
  };
}

function fillFixedSlots(items, slotCount, createSlot) {
  const filled = [...items];

  while (filled.length < slotCount) {
    filled.push(createSlot(filled.length));
  }

  return filled.slice(0, slotCount);
}

function wrapSlots(nodes, prefix) {
  return (nodes ?? []).map((node, index) => ({
    slotId: `${prefix}-${index}`,
    node,
  }));
}

function buildParentSlots(nodes, focusNodeId) {
  return fillFixedSlots(wrapSlots(nodes, "parent"), 2, (index) => ({
    slotId: `parent-${index}`,
    node: createSlotCard(`parent-slot-${index}`, "Add Parent", {
      actionType: "addParent",
      anchorId: focusNodeId,
      title: "Add Parent",
      slotLabel: "Parents column",
    }),
  }));
}

function buildGrandparentSlots(nodes, parentSlots, focusNodeId) {
  const wrapped = wrapSlots(nodes, "grandparent");

  return fillFixedSlots(wrapped, 4, (index) => {
    const branchParent = parentSlots[Math.floor(index / 2)]?.node;
    const anchorId =
      branchParent && !branchParent.isPlaceholder
        ? branchParent.id
        : focusNodeId;

    return {
      slotId: `grandparent-${index}`,
      node: createSlotCard(`grandparent-slot-${index}`, "Add Grandparent", {
        actionType: "addParent",
        anchorId,
        title: "Add Grandparent",
        slotLabel: "Grandparents column",
        note: "Adds via the closest known descendant in this branch.",
      }),
    };
  });
}

function buildGreatGrandparentSlots(nodes, grandparentSlots, parentSlots, focusNodeId) {
  const wrapped = wrapSlots(nodes, "great-grandparent");

  return fillFixedSlots(wrapped, 8, (index) => {
    const branchGrandparent = grandparentSlots[Math.floor(index / 2)]?.node;
    const branchParent = parentSlots[Math.floor(index / 4)]?.node;
    const anchorId =
      branchGrandparent && !branchGrandparent.isPlaceholder
        ? branchGrandparent.id
        : branchParent && !branchParent.isPlaceholder
          ? branchParent.id
          : focusNodeId;

    return {
      slotId: `great-grandparent-${index}`,
      node: createSlotCard(
        `great-grandparent-slot-${index}`,
        "Add Great Grandparent",
        {
          actionType: "addParent",
          anchorId,
          title: "Add Great Grandparent",
          slotLabel: "Great Grandparents column",
          note: "Adds via the closest known descendant in this branch.",
        },
      ),
    };
  });
}

function buildSelectedSlot(focusNode, focusNodeId) {
  if (focusNode) {
    return [{ slotId: "selected-0", node: focusNode }];
  }

  return [
    {
      slotId: "selected-0",
      node: createSlotCard("selected-slot", "Select Person", {
        actionType: null,
        anchorId: focusNodeId,
        title: "Selected Person",
        slotLabel: "Selected column",
      }),
    },
  ];
}

function buildFamilyLane(spouseNode, children, focusNodeId) {
  const sortedChildren = sortRenderedChildren(children);
  const spouse = spouseNode
    ? { slotId: "spouse-0", node: spouseNode }
    : {
        slotId: "spouse-0",
        node: createSlotCard("spouse-slot", "Add Spouse", {
          actionType: "addSpouse",
          anchorId: focusNodeId,
          title: "Add Spouse",
          slotLabel: "Spouse slot",
        }),
      };

  const childSlots = [
    ...wrapSlots(sortedChildren, "child"),
    {
      slotId: "child-add",
      node: createSlotCard(`child-slot-${focusNodeId ?? "focus"}`, "Add Child", {
        actionType: "addChild",
        anchorId: focusNodeId,
        title: "Add Child",
        slotLabel: "Children lane",
      }),
    },
  ];

  return {
    spouse,
    children: childSlots,
  };
}

function TreeCard({
  node,
  isSelected,
  isFocus,
  highlightTone,
  onSelect,
  onEdit,
  onDelete,
  onAddSlot,
}) {
  const isPlaceholder = !!node?.isPlaceholder;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`person-card tree-person-card ${
        isSelected ? "selected" : ""
      } ${isFocus ? "focus-card" : ""} ${
        isPlaceholder ? "placeholder-card" : ""
      } ${highlightTone ? `highlighted-card highlighted-card-${highlightTone}` : ""}`}
      onClick={() => {
        if (isPlaceholder) {
          onAddSlot?.(node.intent);
          return;
        }

        onSelect(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();

        if (isPlaceholder) {
          onAddSlot?.(node.intent);
          return;
        }

        onSelect(node.id);
      }}
    >
      {isPlaceholder ? (
        <div className="tree-add-card-copy">
          <div className="tree-add-icon">+</div>
          <div className="tree-add-label">{node.addLabel}</div>
        </div>
      ) : (
        <div className="person-card-header">
          <div className="person-name">{getNodeLabel(node)}</div>

          <div className="person-card-actions">
            <button
              type="button"
              className="person-edit-button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(node);
              }}
            >
              ✎
            </button>
            {node.id !== "selfNode" && (
              <button
                type="button"
                className="person-delete-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(node);
                }}
              >
                🗑️
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GenerationColumn({
  title,
  density,
  slots,
  focusNodeId,
  selectedNodeId,
  onSelectPerson,
  onEditPerson,
  onDeletePerson,
  onAddSlot,
  registerSlot,
  highlightedNodeTones,
}) {
  return (
    <section
      className={`generation-column generation-column-${density}`}
      aria-label={title}
    >
      <div className="generation-column-label">{title}</div>
      <div className="generation-column-people">
        {slots.map(({ slotId, node }) => (
          <div
            key={slotId}
            ref={(element) => registerSlot(slotId, element)}
            className="tree-slot-anchor"
          >
            <TreeCard
              node={node}
              isSelected={!node.isPlaceholder && selectedNodeId === node.id}
              isFocus={!node.isPlaceholder && focusNodeId === node.id}
              highlightTone={!node.isPlaceholder ? highlightedNodeTones.get(node.id) ?? null : null}
              onSelect={onSelectPerson}
              onEdit={onEditPerson}
              onDelete={onDeletePerson}
              onAddSlot={onAddSlot}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function FamilyColumn({
  spouse,
  children,
  focusNodeId,
  selectedNodeId,
  onSelectPerson,
  onEditPerson,
  onDeletePerson,
  onAddSlot,
  registerSlot,
  highlightedNodeTones,
}) {
  return (
    <section
      className="generation-column generation-column-lower"
      aria-label="Spouse + Children"
    >
      <div className="generation-column-label">Spouse + Children</div>
      <div className="generation-column-people generation-column-family">
        <div
          ref={(element) => registerSlot(spouse.slotId, element)}
          className="tree-slot-anchor"
        >
          <TreeCard
            node={spouse.node}
            isSelected={
              !spouse.node.isPlaceholder && selectedNodeId === spouse.node.id
            }
            isFocus={!spouse.node.isPlaceholder && focusNodeId === spouse.node.id}
            highlightTone={
              !spouse.node.isPlaceholder
                ? highlightedNodeTones.get(spouse.node.id) ?? null
                : null
            }
            onSelect={onSelectPerson}
            onEdit={onEditPerson}
            onDelete={onDeletePerson}
            onAddSlot={onAddSlot}
          />
        </div>

        <div className="generation-family-divider">Children</div>

        <div className="generation-family-children">
          {children.map(({ slotId, node }) => (
            <div
              key={slotId}
              ref={(element) => registerSlot(slotId, element)}
              className="tree-slot-anchor"
            >
              <TreeCard
                node={node}
                isSelected={!node.isPlaceholder && selectedNodeId === node.id}
                isFocus={!node.isPlaceholder && focusNodeId === node.id}
                highlightTone={!node.isPlaceholder ? highlightedNodeTones.get(node.id) ?? null : null}
                onSelect={onSelectPerson}
                onEdit={onEditPerson}
                onDelete={onDeletePerson}
                onAddSlot={onAddSlot}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function FamilyTreeArena({
  generations,
  selectedNodeId,
  relationshipComparison,
  onSelectPerson,
  onEditPerson,
  onDeletePerson,
  onAddSlot,
}) {
  const canvasRef = useRef(null);
  const slotRefs = useRef({});
  const lanes = useMemo(() => generations?.generations ?? {}, [generations]);
  const focusNode = generations?.focus ?? null;
  const focusNodeId = focusNode?.id ?? selectedNodeId ?? null;

  const parentSlots = useMemo(
    () => buildParentSlots(lanes["1"], focusNodeId),
    [focusNodeId, lanes],
  );
  const grandparentSlots = useMemo(
    () => buildGrandparentSlots(lanes["2"], parentSlots, focusNodeId),
    [focusNodeId, lanes, parentSlots],
  );
  const greatGrandparentSlots = useMemo(
    () =>
      buildGreatGrandparentSlots(
        lanes["3"],
        grandparentSlots,
        parentSlots,
        focusNodeId,
      ),
    [focusNodeId, grandparentSlots, lanes, parentSlots],
  );
  const selectedSlot = useMemo(
    () => buildSelectedSlot(focusNode, focusNodeId),
    [focusNode, focusNodeId],
  );
  const familyLane = useMemo(
    () =>
      buildFamilyLane(
        lanes["0"]?.find((node) => node.id !== focusNodeId) ?? null,
        lanes["-1"] ?? [],
        focusNodeId,
      ),
    [focusNodeId, lanes],
  );

  const highlightedNodeTones = useMemo(
    () => {
      const tones = new Map();
      const highlight = relationshipComparison?.highlight;

      if (highlight) {
        for (const nodeId of highlight.selectedPathNodeIds ?? []) {
          tones.set(nodeId, "selected");
        }

        for (const nodeId of highlight.commonNodeIds ?? []) {
          tones.set(nodeId, "common");
        }

        for (const nodeId of highlight.targetPathNodeIds ?? []) {
          if (!tones.has(nodeId)) {
            tones.set(nodeId, "target");
          }
        }
      }

      if (tones.size === 0) {
        for (const nodeId of relationshipComparison?.pathNodeIds ?? []) {
          tones.set(nodeId, "default");
        }
      }

      return tones;
    },
    [relationshipComparison],
  );

  const connectorPairs = useMemo(() => {
    const pairs = [];

    for (let index = 0; index < 8; index += 1) {
      pairs.push({
        from: `great-grandparent-${index}`,
        to: `grandparent-${Math.floor(index / 2)}`,
        edge: {
          relation: "parentOf",
          fromNodeId: greatGrandparentSlots[index]?.node?.isPlaceholder
            ? null
            : greatGrandparentSlots[index]?.node?.id,
          toNodeId: grandparentSlots[Math.floor(index / 2)]?.node?.isPlaceholder
            ? null
            : grandparentSlots[Math.floor(index / 2)]?.node?.id,
        },
      });
    }

    for (let index = 0; index < 4; index += 1) {
      pairs.push({
        from: `grandparent-${index}`,
        to: `parent-${Math.floor(index / 2)}`,
        edge: {
          relation: "parentOf",
          fromNodeId: grandparentSlots[index]?.node?.isPlaceholder
            ? null
            : grandparentSlots[index]?.node?.id,
          toNodeId: parentSlots[Math.floor(index / 2)]?.node?.isPlaceholder
            ? null
            : parentSlots[Math.floor(index / 2)]?.node?.id,
        },
      });
    }

    for (let index = 0; index < 2; index += 1) {
      pairs.push({
        from: `parent-${index}`,
        to: "selected-0",
        edge: {
          relation: "parentOf",
          fromNodeId: parentSlots[index]?.node?.isPlaceholder
            ? null
            : parentSlots[index]?.node?.id,
          toNodeId: selectedSlot[0]?.node?.isPlaceholder
            ? null
            : selectedSlot[0]?.node?.id,
        },
      });
    }

    pairs.push({
      from: "selected-0",
      to: "spouse-0",
      edge: {
        relation: "spouseOf",
        fromNodeId: selectedSlot[0]?.node?.isPlaceholder
          ? null
          : selectedSlot[0]?.node?.id,
        toNodeId: familyLane.spouse.node?.isPlaceholder
          ? null
          : familyLane.spouse.node?.id,
      },
    });

    for (const child of familyLane.children) {
      pairs.push({
        from: "selected-0",
        to: child.slotId,
        kind: "bridge",
        edge: {
          relation: "parentOf",
          fromNodeId: selectedSlot[0]?.node?.isPlaceholder
            ? null
            : selectedSlot[0]?.node?.id,
          toNodeId: child.node?.isPlaceholder ? null : child.node?.id,
        },
      });
    }

    return pairs;
  }, [familyLane, grandparentSlots, greatGrandparentSlots, parentSlots, selectedSlot]);

  const highlightedEdgeTones = useMemo(() => {
    const tones = new Map();
    const highlight = relationshipComparison?.highlight;

    const pairEdgeKeys = new Map(
      connectorPairs
        .filter((pair) => pair.edge?.fromNodeId && pair.edge?.toNodeId)
        .map((pair) => [
          `${pair.from}-${pair.to}`,
          getConnectorEdgeKey(pair.edge),
        ]),
    );

    function applyTone(edges, tone, overwrite = false) {
      const edgeKeys = new Set((edges ?? []).map(getHighlightEdgeKey));

      for (const [pairKey, edgeKey] of pairEdgeKeys.entries()) {
        if (!edgeKeys.has(edgeKey)) {
          continue;
        }

        if (!overwrite && tones.has(pairKey)) {
          continue;
        }

        tones.set(pairKey, tone);
      }
    }

    if (highlight) {
      applyTone(highlight.targetPathEdges, "target");
      applyTone(highlight.selectedPathEdges, "selected");
      applyTone(highlight.commonEdges, "common", true);
    }

    if (tones.size === 0) {
      applyTone(relationshipComparison?.pathEdges ?? [], "default");
    }

    return tones;
  }, [connectorPairs, relationshipComparison]);

  function registerSlot(slotId, element) {
    if (element) {
      slotRefs.current[slotId] = element;
      return;
    }

    delete slotRefs.current[slotId];
  }

  return (
    <section className="genealogy-panel genealogy-panel-tree-arena">
      <div className="genealogy-panel-scroll">
        <div className="tree-arena-header">
          <div>
            <h2>Family Tree</h2>
            <p>Explore the family by generation around the selected person.</p>
          </div>
        </div>

        <div className="family-tree-canvas" ref={canvasRef}>
          <FamilyTreeConnectors
            canvasRef={canvasRef}
            slotRefs={slotRefs}
            connectorPairs={connectorPairs}
            highlightedEdgeTones={highlightedEdgeTones}
          />

          <div className="family-tree-arena">
            <GenerationColumn
              title="Great Grandparents"
              density="far"
              slots={greatGrandparentSlots}
              focusNodeId={focusNodeId}
              selectedNodeId={selectedNodeId}
              onSelectPerson={onSelectPerson}
              onEditPerson={onEditPerson}
              onDeletePerson={onDeletePerson}
              onAddSlot={onAddSlot}
              registerSlot={registerSlot}
              highlightedNodeTones={highlightedNodeTones}
            />

            <GenerationColumn
              title="Grandparents"
              density="upper"
              slots={grandparentSlots}
              focusNodeId={focusNodeId}
              selectedNodeId={selectedNodeId}
              onSelectPerson={onSelectPerson}
              onEditPerson={onEditPerson}
              onDeletePerson={onDeletePerson}
              onAddSlot={onAddSlot}
              registerSlot={registerSlot}
              highlightedNodeTones={highlightedNodeTones}
            />

            <GenerationColumn
              title="Parents"
              density="near"
              slots={parentSlots}
              focusNodeId={focusNodeId}
              selectedNodeId={selectedNodeId}
              onSelectPerson={onSelectPerson}
              onEditPerson={onEditPerson}
              onDeletePerson={onDeletePerson}
              onAddSlot={onAddSlot}
              registerSlot={registerSlot}
              highlightedNodeTones={highlightedNodeTones}
            />

            <GenerationColumn
              title="Selected"
              density="focus"
              slots={selectedSlot}
              focusNodeId={focusNodeId}
              selectedNodeId={selectedNodeId}
              onSelectPerson={onSelectPerson}
              onEditPerson={onEditPerson}
              onDeletePerson={onDeletePerson}
              onAddSlot={onAddSlot}
              registerSlot={registerSlot}
              highlightedNodeTones={highlightedNodeTones}
            />

            <FamilyColumn
              spouse={familyLane.spouse}
              children={familyLane.children}
              focusNodeId={focusNodeId}
              selectedNodeId={selectedNodeId}
              onSelectPerson={onSelectPerson}
              onEditPerson={onEditPerson}
              onDeletePerson={onDeletePerson}
              onAddSlot={onAddSlot}
              registerSlot={registerSlot}
              highlightedNodeTones={highlightedNodeTones}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function getConnectorEdgeKey(edge) {
  if (edge.relation === "spouseOf") {
    return [edge.fromNodeId, edge.toNodeId].sort().join("|spouseOf|");
  }

  return `${edge.fromNodeId}|${edge.relation}|${edge.toNodeId}`;
}

function getHighlightEdgeKey(edge) {
  if (edge.relation === "spouseOf") {
    return [edge.from, edge.to].sort().join("|spouseOf|");
  }

  return `${edge.from}|${edge.relation}|${edge.to}`;
}
