type IconProps = { size?: number; title?: string; className?: string };

function FlagConfidence({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <path d="M4 2 L4 14" />
      <path d="M4 2.75 L12 5 L4 7.25 Z" fill="currentColor" />
    </svg>
  );
}

function FlagAccuracy({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <circle cx="8" cy="8" r="5.25" />
      <line x1="8" y1="8" x2="13.5" y2="3.5" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

function FlagStale({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <path d="M3 12.5 L6 12.5 L6 9 L9 9 L9 5.5 L13 5.5" />
      <path d="M3 12.5 L13 12.5" strokeDasharray="1.5 2" />
    </svg>
  );
}

function Covered({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <circle cx="8" cy="8" r="3.25" fill="currentColor" />
    </svg>
  );
}

function Untouched({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <circle cx="8" cy="8" r="3.25" />
    </svg>
  );
}

function Logged({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <path d="M3.5 7 L5.5 8 L3.5 9" />
      <line x1="5.5" y1="8" x2="8" y2="8" />
    </svg>
  );
}

function Pace({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <path d="M5 8 L10 5.5" />
      <path d="M5 8 L10 10.5" />
    </svg>
  );
}

function Coverage({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <rect x="2.5" y="2.5" width="11" height="11" />
      <rect x="4" y="4" width="8" height="8" />
      <rect x="5.5" y="5.5" width="5" height="5" />
    </svg>
  );
}

function Mock({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <circle cx="8" cy="3.5" r="1" fill="currentColor" />
      <line x1="3" y1="11.5" x2="13" y2="11.5" />
      <line x1="3" y1="10.5" x2="3" y2="12.5" />
      <line x1="8" y1="10.5" x2="8" y2="12.5" />
      <line x1="13" y1="10.5" x2="13" y2="12.5" />
    </svg>
  );
}

function Holiday({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <rect x="2.5" y="6.5" width="11" height="3" strokeDasharray="2 2" />
    </svg>
  );
}

function Health({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <path d="M2 8 L4 8 L5 6 L6 8 L7 8 L8.5 2 L10 8 L11 8 L14 8" />
    </svg>
  );
}

function Search({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <circle cx="6.5" cy="6.5" r="3.5" />
      <line x1="9.5" y1="9.5" x2="12" y2="12" />
    </svg>
  );
}

export type IconName =
  | "FlagConfidence"
  | "FlagAccuracy"
  | "FlagStale"
  | "Covered"
  | "Untouched"
  | "Logged"
  | "Pace"
  | "Coverage"
  | "Mock"
  | "Holiday"
  | "Health"
  | "Search";

const ICONS: Record<IconName, React.ComponentType<IconProps>> = {
  FlagConfidence,
  FlagAccuracy,
  FlagStale,
  Covered,
  Untouched,
  Logged,
  Pace,
  Coverage,
  Mock,
  Holiday,
  Health,
  Search,
};

export function Icon({
  name,
  size,
  title,
  className,
}: { name: IconName } & IconProps) {
  const Component = ICONS[name];
  return <Component size={size} title={title} className={className} />;
}

export {
  FlagConfidence,
  FlagAccuracy,
  FlagStale,
  Covered,
  Untouched,
  Logged,
  Pace,
  Coverage,
  Mock,
  Holiday,
  Health,
  Search,
};
