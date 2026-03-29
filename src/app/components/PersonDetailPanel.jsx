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

  if (generation === "self" || generation === 0) return "Self / Spouse";
  if (generation === "parent") return "Parent";
  if (generation === "grandparent") return "Grandparent";
  if (generation === "child") return "Child";

  return "Relative";
}

export default function PersonDetailPanel({
  selectedPerson,
}) {
  return (
    <section className="genealogy-panel genealogy-panel-detail">
      <div className="genealogy-panel-scroll">
        <section className="genealogy-section">
          <h2>Person Detail</h2>

          {selectedPerson ? (
            <>
              <h3>{getNodeLabel(selectedPerson)}</h3>
              <p className="detail-subtitle">
                {getGenerationLabel(selectedPerson)}
              </p>

              <div className="detail-block">
                <p>
                  <strong>Date of Birth:</strong>{" "}
                  {selectedPerson.value?.dateOfBirth ?? "Unknown"}
                </p>
                <p>
                  <strong>Biography:</strong>{" "}
                  {selectedPerson.value?.biography ?? "No biography yet."}
                </p>
              </div>
            </>
          ) : (
            <p>Select a person to view details.</p>
          )}
        </section>
      </div>
    </section>
  );
}
