import { useEffect, useId, useRef, useState } from "react";
import { validateInput, validateInputDraft } from "../../../shared/inputValidation.mjs";

export default function ValidatedInput({
  kind = "text", label = "This field", value = "", onChange, required = false,
  min = 0, max = Number.MAX_SAFE_INTEGER, minLength = 0, maxLength,
  id, type = "text", onBlur, onInvalid, className = "", ...props
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const inputRef = useRef(null);
  const [touched, setTouched] = useState(false);
  const [rejectedError, setRejectedError] = useState("");
  const rules = { kind, label, required, min, max, minLength, maxLength };
  const validationError = validateInput(value, rules);
  const visibleError = rejectedError || (touched || value !== "" ? validationError : "");

  useEffect(() => {
    inputRef.current?.setCustomValidity(validationError);
  }, [validationError]);

  const handleChange = (event) => {
    const draftError = validateInputDraft(event.target.value, rules);
    setTouched(true);
    setRejectedError(draftError);
    if (draftError) {
      event.target.value = String(value);
      return;
    }
    // Set validity immediately, including before a rapid submit after editing.
    event.target.setCustomValidity(validateInput(event.target.value, rules));
    onChange?.(event);
  };

  return (
    <>
      <input
        {...props} ref={inputRef} id={inputId}
        type={kind === "integer" ? "text" : type}
        inputMode={kind === "integer" ? "numeric" : props.inputMode}
        pattern={kind === "integer" ? "[0-9]*" : props.pattern}
        value={value} required={required} onChange={handleChange}
        onBlur={(event) => { setTouched(true); onBlur?.(event); }}
        onInvalid={(event) => { setTouched(true); onInvalid?.(event); }}
        aria-invalid={Boolean(visibleError)}
        aria-describedby={[props["aria-describedby"], visibleError ? errorId : null].filter(Boolean).join(" ") || undefined}
        className={`${className}${visibleError ? " border-[var(--ed-color-d94141)]" : ""}`}
      />
      {visibleError && <span id={errorId} role="alert" className="mt-2 block text-xs leading-5 text-[var(--ed-color-c53939)]">{visibleError}</span>}
    </>
  );
}
