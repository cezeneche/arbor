/**
 * Skeleton — loading placeholder per global spec:
 *   --color-border background, same dimensions as the content it replaces.
 *   1.5s opacity pulse. Respects prefers-reduced-motion via globals.css.
 */

interface SkeletonProps {
  height?:       number | string;
  width?:        number | string;
  borderRadius?: number | string;
  style?:        React.CSSProperties;
}

export function Skeleton({
  height       = 16,
  width        = "100%",
  borderRadius = 4,
  style,
}: SkeletonProps) {
  return (
    <div
      style={{
        height,
        width,
        borderRadius,
        backgroundColor: "var(--color-border)",
        animation:       "skeleton-pulse 1.5s ease-in-out infinite",
        flexShrink:      0,
        ...style,
      }}
    />
  );
}
