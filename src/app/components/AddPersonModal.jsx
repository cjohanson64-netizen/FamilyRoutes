import { useState } from "react";
import AddPersonForm from "./AddPersonForm";

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

export default function AddPersonModal({
  intent,
  isOpen,
  onClose,
  onSubmit,
  anchorPerson = null,
  relationshipAssignments = [],
  initialAssignmentValues = {},
  submitDisabled = false,
  submitDisabledMessage = "",
}) {
  const [submitError, setSubmitError] = useState("");

  if (!isOpen || !intent) {
    return null;
  }

  async function handleSubmit(values) {
    setSubmitError("");

    const result = await onSubmit?.(values);
    if (result?.ok === false) {
      setSubmitError(result.error ?? "Unable to save this person.");
    }
  }

  return (
    <div
      className="genealogy-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="genealogy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="genealogy-add-person-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="genealogy-modal-header">
          <div>
            <h2 id="genealogy-add-person-title">{intent.title}</h2>
            <p className="genealogy-modal-subtitle">
              {intent.description ??
                `Update family details for ${
                  anchorPerson ? getNodeLabel(anchorPerson) : "this person"
                }.`}
            </p>
          </div>

          <button
            type="button"
            className="genealogy-button genealogy-button-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {submitError && <div className="spouse-modal-error">{submitError}</div>}

        <AddPersonForm
          submitLabel={intent.submitLabel ?? "Save Person"}
          initialValues={intent.initialValues}
          contextTitle={intent.title}
          contextDescription={
            intent.contextDescription ??
            (anchorPerson
              ? `${intent.title} for ${getNodeLabel(anchorPerson)}`
              : intent.description)
          }
          relationshipAssignments={relationshipAssignments}
          initialAssignmentValues={initialAssignmentValues}
          submitDisabled={submitDisabled}
          submitDisabledMessage={submitDisabledMessage}
          onSubmit={handleSubmit}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
