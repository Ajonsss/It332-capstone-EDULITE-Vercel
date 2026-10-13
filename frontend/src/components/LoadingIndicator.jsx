// EL_1.webp is the looping, transparent browser version of EL_1.mov.
export default function LoadingIndicator({ label = "Loading...", compact = false, className = "" }) {
  const Container = compact ? "span" : "div";
  return (
    <Container role="status" className={`${compact ? "inline-flex items-center justify-center gap-2" : "flex flex-col items-center justify-center gap-3"} ${className}`}>
      <picture aria-hidden="true" className={compact ? "block h-8 w-8 shrink-0" : "block h-32 w-32 shrink-0 sm:h-40 sm:w-40"}>
        <source media="(prefers-reduced-motion: reduce)" srcSet="/EL_1-poster.png" type="image/png" />
        <source srcSet="/EL_1.webp" type="image/webp" />
        <img src="/EL_1-poster.png" alt="" width="320" height="320" className="h-full w-full object-contain" />
      </picture>
      <span className={compact ? "" : "text-sm text-[var(--ed-muted)]"}>{label}</span>
    </Container>
  );
}
