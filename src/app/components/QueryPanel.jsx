import { useMemo } from "react";

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

export default function QueryPanel({
  people,
  comparisonPair,
  relationshipComparison,
  commonAncestorsQuery,
  selectedCommonAncestorId,
  canOverrideCommonAncestor,
  onChangeComparisonPerson,
  onSwapComparisonPeople,
  onChangeSelectedCommonAncestor,
}) {
  const sortedPeople = useMemo(
    () =>
      [...people].sort((left, right) =>
        getNodeLabel(left).localeCompare(getNodeLabel(right)),
      ),
    [people],
  );
  const commonAncestors = commonAncestorsQuery?.ancestors ?? [];

  return (
    <section className="genealogy-panel genealogy-panel-query">
      <div className="genealogy-panel-scroll">
        <section className="genealogy-section">
          <h2>Query Panel</h2>
          <p className="query-panel-subtitle">
            Compare any two people and let runtime genealogy semantics resolve
            the relationship.
          </p>

          <div className="comparison-controls">
            <label className="genealogy-field">
              <span className="genealogy-label">Select Person</span>
              <select
                className="genealogy-input"
                value={comparisonPair?.fromId ?? ""}
                onChange={(event) =>
                  onChangeComparisonPerson?.("fromId", event.target.value)
                }
              >
                <option value="">Select person</option>
                {sortedPeople.map((person) => (
                  <option key={`from-${person.id}`} value={person.id}>
                    {getNodeLabel(person)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="genealogy-button genealogy-button-secondary comparison-swap-button"
              onClick={() => onSwapComparisonPeople?.()}
            >
              Swap
            </button>

            <label className="genealogy-field">
              <span className="genealogy-label">Target Person</span>
              <select
                className="genealogy-input"
                value={comparisonPair?.toId ?? ""}
                onChange={(event) =>
                  onChangeComparisonPerson?.("toId", event.target.value)
                }
              >
                <option value="">Target person</option>
                {sortedPeople.map((person) => (
                  <option key={`to-${person.id}`} value={person.id}>
                    {getNodeLabel(person)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {relationshipComparison ? (
            <div className="projection-card comparison-result-card">
              <p className="projection-body-text">
                {relationshipComparison.from.label} is{" "}
                {relationshipComparison.relationship.label} to{" "}
                {relationshipComparison.to.label}
              </p>
            </div>
          ) : (
            <p className="relationship-empty">
              Select two people to compare their relationship.
            </p>
          )}

          <div className="projection-card comparison-result-card">
            <p className="projection-body-text">
              Common Ancestors Found: {commonAncestorsQuery?.count ?? 0}
            </p>

            {canOverrideCommonAncestor && commonAncestors.length > 0 ? (
              <label className="genealogy-field">
                <span className="genealogy-label">Common Ancestor</span>
                <select
                  className="genealogy-input"
                  value={selectedCommonAncestorId ?? ""}
                  onChange={(event) =>
                    onChangeSelectedCommonAncestor?.(event.target.value)
                  }
                >
                  <option value="">Automatic</option>
                  {commonAncestors.map((ancestor) => (
                    <option key={ancestor.id} value={ancestor.id}>
                      {getNodeLabel(ancestor)}
                    </option>
                  ))}
                </select>
              </label>
            ) : commonAncestors.length > 0 ? (
              <p className="projection-body-text">
                Automatic mode is using the closest shared ancestor.
              </p>
            ) : (
              <p className="relationship-empty">No common ancestors found.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
