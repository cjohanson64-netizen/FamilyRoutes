function getNodeLabel(node) {
  if (!node) return "Unknown";
  return (
    node.value?.fullName ??
    node.value?.name ??
    node.meta?.label ??
    node.id ??
    "Unknown"
  );
}

function getGenerationLabel(node) {
  const generation = node?.meta?.generation;

  if (generation === 0) return "Self";
  if (generation === "parent") return "Parent";
  if (generation === "grandparent") return "Grandparent";
  if (generation === "child") return "Child";

  return "Relative";
}

function getRowRoleLabel(node, rowType, isSelected) {
  if (rowType === "parents") {
    return node?.meta?.generation === "parent" ? "Parent" : "Parent Spouse";
  }

  if (rowType === "selected") {
    return isSelected ? "Selected Person" : "Spouse";
  }

  if (rowType === "children") {
    return "Child";
  }

  return getGenerationLabel(node);
}

function PersonCard({ node, isSelected, onSelect, onDelete, rowType }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`person-card ${isSelected ? "selected" : ""}`}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <div className="person-card-header">
        <div className="person-name">{getNodeLabel(node)}</div>

        <div className="person-card-actions">
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

      <div className="person-role">{getRowRoleLabel(node, rowType, isSelected)}</div>
    </div>
  );
}

function FamilyRow({
  nodes,
  selectedNodeId,
  onSelectPerson,
  onDeletePerson,
  rowType,
}) {
  return (
    <div className="family-row">
      {nodes.map((node) => (
        <PersonCard
          key={node.id}
          node={node}
          isSelected={selectedNodeId === node.id}
          onSelect={onSelectPerson}
          onDelete={onDeletePerson}
          rowType={rowType}
        />
      ))}
    </div>
  );
}

export default function FamilyTreePanel({
  familyRows,
  selectedNodeId,
  onSelectPerson,
  onDeletePerson,
}) {
  return (
    <section className="genealogy-panel genealogy-panel-tree-map">
      <h2>Family Tree</h2>

      <div className="family-map">
        <FamilyRow
          nodes={familyRows.parents}
          selectedNodeId={selectedNodeId}
          onSelectPerson={onSelectPerson}
          onDeletePerson={onDeletePerson}
          rowType="parents"
        />

        <div className="spacer"></div>

        <FamilyRow
          nodes={familyRows.selectedAndSpouses}
          selectedNodeId={selectedNodeId}
          onSelectPerson={onSelectPerson}
          onDeletePerson={onDeletePerson}
          rowType="selected"
        />

        <div className="spacer"></div>

        <FamilyRow
          nodes={familyRows.children}
          selectedNodeId={selectedNodeId}
          onSelectPerson={onSelectPerson}
          onDeletePerson={onDeletePerson}
          rowType="children"
        />
      </div>
    </section>
  );
}
