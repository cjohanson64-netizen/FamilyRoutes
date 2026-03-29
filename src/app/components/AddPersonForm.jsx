import { useMemo, useState } from "react";

const EMPTY_FORM = {
  firstName: "",
  middleNames: "",
  lastName: "",
  suffix: "",
  dateOfBirth: "",
  birthPlace: "",
  lifeStatus: "unknown",
  deathDate: "",
  deathPlace: "",
  gender: "",
  biography: "",
  notes: "",
};

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

  const safeLabel =
    typeof node.label === "string" &&
    node.label !== node.id &&
    !/node/i.test(node.label)
      ? node.label
      : null;

  return (
    assembledName ||
    node.value?.fullName ||
    safeLabel ||
    node.value?.name ||
    node.meta?.label ||
    node.id ||
    "Unknown"
  );
}

function getNodeDetail(node) {
  const dateOfBirth = node?.value?.dateOfBirth;
  if (!dateOfBirth) {
    return "";
  }

  const year = `${dateOfBirth}`.slice(0, 4);
  if (/^\d{4}$/.test(year)) {
    return year;
  }

  return dateOfBirth;
}

function buildFullName(formState) {
  return [
    formState.firstName.trim(),
    formState.middleNames.trim(),
    formState.lastName.trim(),
    formState.suffix.trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

export default function AddPersonForm({
  submitLabel,
  onSubmit,
  onCancel,
  initialValues = EMPTY_FORM,
  contextTitle,
  contextDescription,
  relationshipAssignments = [],
  initialAssignmentValues = {},
  submitDisabled = false,
  submitDisabledMessage = "",
}) {
  const [formState, setFormState] = useState(() => ({
    ...EMPTY_FORM,
    ...initialValues,
  }));
  const [assignmentState, setAssignmentState] = useState(
    () => initialAssignmentValues,
  );
  const [formError, setFormError] = useState("");

  const hasRelationshipAssignments = relationshipAssignments.length > 0;

  const visibleAssignments = useMemo(
    () =>
      relationshipAssignments.map((item) => ({
        ...item,
        assignmentValue: assignmentState[item.id] ?? "none",
      })),
    [assignmentState, relationshipAssignments],
  );

  function handleChange(event) {
    const { name, value } = event.target;
    setFormError("");
    setFormState((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleAssignmentChange(childId, value) {
    setAssignmentState((current) => ({
      ...current,
      [childId]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const fullName = buildFullName(formState);
    if (!fullName) {
      setFormError("Enter at least a first or last name.");
      return;
    }

    const result = await onSubmit?.({
      firstName: formState.firstName.trim(),
      middleNames: formState.middleNames.trim(),
      lastName: formState.lastName.trim(),
      suffix: formState.suffix.trim(),
      fullName,
      dateOfBirth: formState.dateOfBirth.trim(),
      birthPlace: formState.birthPlace.trim(),
      lifeStatus: formState.lifeStatus,
      deathDate: formState.deathDate.trim(),
      deathPlace: formState.deathPlace.trim(),
      gender: formState.gender.trim(),
      biography: formState.biography.trim(),
      notes: formState.notes.trim(),
      childAssignments: assignmentState,
    });

    if (result?.ok === false) {
      setFormError(result.error ?? "Unable to save this person.");
      return;
    }

    setFormState(EMPTY_FORM);
    setAssignmentState({});
    setFormError("");
  }

  function handleCancel() {
    setFormState(EMPTY_FORM);
    setAssignmentState({});
    setFormError("");
    onCancel?.();
  }

  return (
    <form className="genealogy-inline-form" onSubmit={handleSubmit}>
      {contextTitle && (
        <section className="person-form-section">
          <h3 className="person-form-section-title">Relationship Context</h3>
          <div className="person-form-context-card">
            <div className="person-form-context-title">{contextTitle}</div>
            {contextDescription && (
              <p className="person-form-context-body">{contextDescription}</p>
            )}
          </div>
        </section>
      )}

      <section className="person-form-section">
        <h3 className="person-form-section-title">Identity</h3>

        <div className="person-form-grid">
          <label className="genealogy-field">
            <span className="genealogy-label">First Name</span>
            <input
              className="genealogy-input"
              name="firstName"
              value={formState.firstName}
              onChange={handleChange}
            />
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Middle Name(s)</span>
            <input
              className="genealogy-input"
              name="middleNames"
              value={formState.middleNames}
              onChange={handleChange}
            />
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Last Name</span>
            <input
              className="genealogy-input"
              name="lastName"
              value={formState.lastName}
              onChange={handleChange}
            />
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Suffix</span>
            <input
              className="genealogy-input"
              name="suffix"
              value={formState.suffix}
              onChange={handleChange}
            />
          </label>
        </div>
      </section>

      <section className="person-form-section">
        <h3 className="person-form-section-title">Life Details</h3>

        <div className="person-form-grid">
          <label className="genealogy-field">
            <span className="genealogy-label">Birth Date</span>
            <input
              className="genealogy-input"
              name="dateOfBirth"
              placeholder="YYYY-MM-DD or partial"
              value={formState.dateOfBirth}
              onChange={handleChange}
            />
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Birth Place</span>
            <input
              className="genealogy-input"
              name="birthPlace"
              value={formState.birthPlace}
              onChange={handleChange}
            />
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Living Status</span>
            <select
              className="genealogy-input"
              name="lifeStatus"
              value={formState.lifeStatus}
              onChange={handleChange}
            >
              <option value="unknown">Unknown</option>
              <option value="living">Living</option>
              <option value="deceased">Deceased</option>
            </select>
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Gender</span>
            <select
              className="genealogy-input"
              name="gender"
              value={formState.gender}
              onChange={handleChange}
            >
              <option value="">Unknown</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="nonbinary">Nonbinary</option>
            </select>
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Death Date</span>
            <input
              className="genealogy-input"
              name="deathDate"
              placeholder="YYYY-MM-DD or partial"
              value={formState.deathDate}
              onChange={handleChange}
            />
          </label>

          <label className="genealogy-field">
            <span className="genealogy-label">Death Place</span>
            <input
              className="genealogy-input"
              name="deathPlace"
              value={formState.deathPlace}
              onChange={handleChange}
            />
          </label>
        </div>
      </section>

      <section className="person-form-section">
        <h3 className="person-form-section-title">Notes</h3>

        <label className="genealogy-field">
          <span className="genealogy-label">Biography</span>
          <textarea
            className="genealogy-input genealogy-textarea"
            name="biography"
            rows={4}
            value={formState.biography}
            onChange={handleChange}
          />
        </label>

        <label className="genealogy-field">
          <span className="genealogy-label">Notes</span>
          <textarea
            className="genealogy-input genealogy-textarea"
            name="notes"
            rows={3}
            value={formState.notes}
            onChange={handleChange}
          />
        </label>
      </section>

      {hasRelationshipAssignments && (
        <section className="person-form-section">
          <h3 className="person-form-section-title">Relationship Assignment</h3>
          <p className="person-form-context-body">
            Assign this new person’s relationship to the current children.
          </p>

          <div className="person-assignment-list">
            {visibleAssignments.map((item) => (
              <label key={item.id} className="person-assignment-row">
                <span className="person-assignment-copy">
                  <span className="person-assignment-name">
                    {getNodeLabel(item)}
                  </span>
                  {getNodeDetail(item) && (
                    <span className="person-assignment-detail">
                      {getNodeDetail(item)}
                    </span>
                  )}
                </span>
                <select
                  className="genealogy-input person-assignment-select"
                  value={item.assignmentValue}
                  onChange={(event) =>
                    handleAssignmentChange(item.id, event.target.value)
                  }
                >
                  <option value="none">No link</option>
                  <option value="birthParent">Birth Parent</option>
                  <option value="stepParent">Step Parent</option>
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      {formError && <div className="spouse-modal-error">{formError}</div>}
      {submitDisabled && submitDisabledMessage && (
        <div className="spouse-modal-warning">{submitDisabledMessage}</div>
      )}

      <div className="genealogy-form-actions">
        <button type="submit" className="genealogy-button" disabled={submitDisabled}>
          {submitLabel}
        </button>
        <button
          type="button"
          className="genealogy-button genealogy-button-secondary"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
