export default function LoadingIndicator({ label = "Loading...", compact = false, className = "" }) {
  const Container = compact ? "span" : "div";
  return (
    <Container role="status" className={`${compact ? "inline-flex items-center justify-center gap-2" : "flex flex-col items-center justify-center gap-3"} ${className}`}>
      <span className={compact ? "" : "text-sm text-[var(--ed-muted)]"}>{label}</span>
    </Container>
  );
}
