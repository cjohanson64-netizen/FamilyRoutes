import { useMemo, useState } from "react";

const VIEW_OPTIONS = [
  { id: "relationships", label: "Relationships" },
  { id: "siblings", label: "Siblings" },
  { id: "ancestors", label: "Ancestors" },
  { id: "descendants", label: "Descendants" },
  { id: "summary", label: "Summary" },
  { id: "list", label: "List" },
  { id: "tree", label: "Tree" },
];

const DEPTH_OPTIONS = [1, 2, 3, 4];

function getNodeLabel(node) {
  if (!node) return "Unknown";
  return (
    node.label ??
    node.value?.fullName ??
    node.value?.name ??
    node.meta?.label ??
    node.id ??
    "Unknown"
  );
}

function getGenerationLabel(node) {
  const generation = node?.meta?.generation;

  if (generation === "self" || generation === 0) return "Self / Spouse";
  if (generation === "parent") return "Parent";
  if (generation === "grandparent") return "Grandparent";
  if (generation === "child") return "Child";

  return node?.status ?? "Relative";
}

function RelationshipGroup({ title, nodes, selectedNodeId, onSelect }) {
  if (!nodes?.length) {
    return (
      <div className="relationship-group">
        <h4>{title}</h4>
        <p className="relationship-empty">None</p>
      </div>
    );
  }

  return (
    <div className="relationship-group">
      <h4>{title}</h4>
      <div className="relationship-list">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`relationship-item ${
              selectedNodeId === node.id ? "selected" : ""
            }`}
            onClick={() => onSelect(node.id)}
          >
            <div className="relationship-name">{getNodeLabel(node)}</div>
            <div className="relationship-role">{getGenerationLabel(node)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="projection-stat-card">
      <div className="projection-stat-label">{label}</div>
      <div className="projection-stat-value">{value}</div>
    </div>
  );
}

function SummaryView({ summary }) {
  const data = summary?.data ?? {};
  const counts = data.counts ?? {};

  return (
    <section className="genealogy-section">
      <h2>Summary</h2>

      <div className="projection-summary-grid">
        <SummaryCard label="Person" value={getNodeLabel(data)} />
        <SummaryCard label="Status" value={data.status ?? "Unknown"} />
        <SummaryCard
          label="Date of Birth"
          value={data.value?.dateOfBirth ?? "Unknown"}
        />
        <SummaryCard
          label="Generation"
          value={data.meta?.generation ?? "Unknown"}
        />
      </div>

      <div className="projection-summary-stack">
        <div className="projection-card">
          <h3>Biography</h3>
          <p className="projection-body-text">
            {data.value?.biography ?? "No biography yet."}
          </p>
        </div>

        <div className="projection-card">
          <h3>Graph Counts</h3>
          <div className="projection-summary-grid projection-summary-grid-compact">
            <SummaryCard label="People" value={counts.nodes ?? 0} />
            <SummaryCard label="Relationships" value={counts.edges ?? 0} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ListView({ list, selectedNodeId, onSelectPerson }) {
  const items = list?.items ?? [];

  return (
    <section className="genealogy-section">
      <h2>List</h2>

      {items.length === 0 ? (
        <p className="relationship-empty">No items in this list.</p>
      ) : (
        <div className="projection-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`projection-list-item ${
                selectedNodeId === item.id ? "selected" : ""
              }`}
              onClick={() => onSelectPerson(item.id)}
            >
              <div className="projection-list-main">
                <div className="projection-list-name">{getNodeLabel(item)}</div>
                <div className="projection-list-meta">
                  {item.value?.dateOfBirth ?? getGenerationLabel(item)}
                </div>
              </div>
              <div className="projection-list-status">
                {item.status ?? item.value?.type ?? "item"}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TreeNode({ node, selectedNodeId, onSelectPerson, depth = 0 }) {
  const children = node?.children ?? [];
  const isSelected = selectedNodeId === node.id;

  return (
    <div
      className="tree-node"
      style={{ "--tree-depth": depth }}
    >
      <button
        type="button"
        className={`tree-card ${
          isSelected ? "is-focus" : ""
        }`}
        onClick={() => node.id && onSelectPerson(node.id)}
      >
        <div className="tree-label">{getNodeLabel(node)}</div>
        <div className="tree-meta">
          {node.value?.dateOfBirth ?? node.meta?.generation ?? node.value?.type ?? ""}
        </div>
      </button>

      {children.length > 0 && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.id ?? `${depth}-${getNodeLabel(child)}`}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelectPerson={onSelectPerson}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeView({ tree, selectedNodeId, onSelectPerson }) {
  if (!tree?.tree) {
    return (
      <section className="genealogy-section">
        <h2>Tree</h2>
        <p className="relationship-empty">No tree view available.</p>
      </section>
    );
  }

  return (
    <section className="genealogy-section">
      <h2>Tree</h2>
      <div className="projection-card projection-tree-card tree-view">
        <TreeNode
          node={tree.tree}
          depth={0}
          selectedNodeId={selectedNodeId}
          onSelectPerson={onSelectPerson}
        />
      </div>
    </section>
  );
}

function RelationshipsView({ familyRows, selectedNodeId, onSelectPerson }) {
  const birthParents = familyRows.birthParents ?? familyRows.parents ?? [];
  const stepParents = familyRows.stepParents ?? [];
  const spouses = familyRows.selectedAndSpouses.filter(
    (node) => node.id !== selectedNodeId,
  );
  const birthChildren = familyRows.birthChildren ?? familyRows.children ?? [];
  const stepChildren = familyRows.stepChildren ?? [];

  return (
    <section className="genealogy-section">
      <h2>Relationships</h2>

      <RelationshipGroup
        title="Birth Parents"
        nodes={birthParents}
        selectedNodeId={selectedNodeId}
        onSelect={onSelectPerson}
      />

      <RelationshipGroup
        title="Step Parents"
        nodes={stepParents}
        selectedNodeId={selectedNodeId}
        onSelect={onSelectPerson}
      />

      <RelationshipGroup
        title="Spouse"
        nodes={spouses}
        selectedNodeId={selectedNodeId}
        onSelect={onSelectPerson}
      />

      <RelationshipGroup
        title="Biological Children"
        nodes={birthChildren}
        selectedNodeId={selectedNodeId}
        onSelect={onSelectPerson}
      />

      <RelationshipGroup
        title="Stepchildren"
        nodes={stepChildren}
        selectedNodeId={selectedNodeId}
        onSelect={onSelectPerson}
      />
    </section>
  );
}

function SiblingsView({ siblings, selectedNodeId, onSelectPerson }) {
  const items = siblings?.siblings ?? [];

  return (
    <section className="genealogy-section">
      <h2>Siblings</h2>

      {items.length === 0 ? (
        <p className="relationship-empty">No siblings found.</p>
      ) : (
        <div className="relationship-group">
          <div className="relationship-list">
            {items.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`relationship-item ${
                  selectedNodeId === node.id ? "selected" : ""
                }`}
                onClick={() => onSelectPerson(node.id)}
              >
                <div className="relationship-name">{getNodeLabel(node)}</div>
                <div className="relationship-role">{getGenerationLabel(node)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TraversalView({
  title,
  emptyLabel,
  items,
  selectedNodeId,
  onSelectPerson,
}) {
  return (
    <section className="genealogy-section">
      <h2>{title}</h2>

      {items.length === 0 ? (
        <p className="relationship-empty">{emptyLabel}</p>
      ) : (
        <div className="relationship-group">
          <div className="relationship-list">
            {items.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`relationship-item ${
                  selectedNodeId === node.id ? "selected" : ""
                }`}
                onClick={() => onSelectPerson(node.id)}
              >
                <div className="relationship-name">{getNodeLabel(node)}</div>
                <div className="relationship-role">{getGenerationLabel(node)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function RelationshipPanel({
  familyRows,
  selectedNodeId,
  siblings,
  ancestors,
  descendants,
  viewDepths,
  summary,
  list,
  tree,
  onSelectPerson,
  onChangeViewDepth,
}) {
  const normalizedFamilyRows = useMemo(
    () => ({
      ...familyRows,
      birthParents: familyRows?.birthParents ?? familyRows?.parents ?? [],
      stepParents: familyRows?.stepParents ?? [],
      birthChildren: familyRows?.birthChildren ?? familyRows?.children ?? [],
      stepChildren: familyRows?.stepChildren ?? [],
    }),
    [familyRows],
  );

  const [activeView, setActiveView] = useState("relationships");
  const [showRawJson, setShowRawJson] = useState(false);

  const rawProjection = useMemo(() => {
    switch (activeView) {
      case "relationships":
        return normalizedFamilyRows;
      case "summary":
        return summary;
      case "siblings":
        return siblings;
      case "ancestors":
        return ancestors;
      case "descendants":
        return descendants;
      case "list":
        return list;
      case "tree":
        return tree;
      default:
        return null;
    }
  }, [activeView, ancestors, descendants, list, normalizedFamilyRows, siblings, summary, tree]);

  function renderReadableView() {
    switch (activeView) {
      case "relationships":
        return (
          <RelationshipsView
            familyRows={normalizedFamilyRows}
            selectedNodeId={selectedNodeId}
            onSelectPerson={onSelectPerson}
          />
        );
      case "summary":
        return <SummaryView summary={summary} />;
      case "siblings":
        return (
          <SiblingsView
            siblings={siblings}
            selectedNodeId={selectedNodeId}
            onSelectPerson={onSelectPerson}
          />
        );
      case "ancestors":
        return (
          <TraversalView
            title="Ancestors"
            emptyLabel="No ancestors found at this depth."
            items={ancestors?.ancestors ?? []}
            selectedNodeId={selectedNodeId}
            onSelectPerson={onSelectPerson}
          />
        );
      case "descendants":
        return (
          <TraversalView
            title="Descendants"
            emptyLabel="No descendants found at this depth."
            items={descendants?.descendants ?? []}
            selectedNodeId={selectedNodeId}
            onSelectPerson={onSelectPerson}
          />
        );
      case "list":
        return (
          <ListView
            list={list}
            selectedNodeId={selectedNodeId}
            onSelectPerson={onSelectPerson}
          />
        );
      case "tree":
        return (
          <TreeView
            tree={tree}
            selectedNodeId={selectedNodeId}
            onSelectPerson={onSelectPerson}
          />
        );
      default:
        return null;
    }
  }

  return (
    <section className="genealogy-panel genealogy-panel-side">
      <div className="genealogy-panel-scroll">
        <section className="genealogy-section">
          <div className="panel-view-header">
            <h2>View Panel</h2>

            <label className="panel-debug-toggle">
              <input
                type="checkbox"
                checked={showRawJson}
                onChange={(event) => setShowRawJson(event.target.checked)}
              />
              <span>Show raw JSON</span>
            </label>
          </div>

          <div className="panel-view-tabs" role="tablist" aria-label="Right panel views">
            {VIEW_OPTIONS.map((view) => (
              <button
                key={view.id}
                type="button"
                className={`panel-view-tab ${
                  activeView === view.id ? "active" : ""
                }`}
                onClick={() => setActiveView(view.id)}
              >
                {view.label}
              </button>
            ))}
          </div>

          {(activeView === "ancestors" || activeView === "descendants") && (
            <div className="panel-depth-controls">
              <span className="panel-depth-label">Depth</span>
              <div className="panel-depth-buttons" role="group" aria-label={`${activeView} depth`}>
                {DEPTH_OPTIONS.map((depth) => (
                  <button
                    key={`${activeView}-${depth}`}
                    type="button"
                    className={`panel-depth-button ${
                      viewDepths?.[activeView] === depth ? "active" : ""
                    }`}
                    onClick={() => onChangeViewDepth?.(activeView, depth)}
                  >
                    {depth}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {showRawJson ? (
          <section className="genealogy-section">
            <h2>{VIEW_OPTIONS.find((view) => view.id === activeView)?.label} JSON</h2>
            <pre className="genealogy-json">{JSON.stringify(rawProjection, null, 2)}</pre>
          </section>
        ) : (
          renderReadableView()
        )}
      </div>
    </section>
  );
}
