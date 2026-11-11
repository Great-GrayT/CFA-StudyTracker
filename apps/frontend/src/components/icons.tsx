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


// Navigation and utility icons.
//
// Same 16 unit grid, currentColor and square caps as the data icons above, so
// an icon in the bottom bar and an icon in a table read as one family. They
// are drawn here rather than pulled from an icon package because the house
// style is square-capped and sharp-cornered, and every general-purpose set is
// round-capped: mixing the two is visible immediately at 20px.

function Today({ size = 16, title, className }: IconProps) {
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
      <rect x="2.25" y="3.25" width="11.5" height="10.5" />
      <line x1="2.25" y1="6.5" x2="13.75" y2="6.5" />
      <rect x="4.75" y="8.75" width="3" height="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Plan({ size = 16, title, className }: IconProps) {
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
      <line x1="2.5" y1="4" x2="13.5" y2="4" />
      <line x1="2.5" y1="8" x2="10.5" y2="8" />
      <line x1="2.5" y1="12" x2="12" y2="12" />
    </svg>
  );
}

function Settings({ size = 16, title, className }: IconProps) {
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
      {/* Sliders, not a cog: a cog at 16px with square caps turns into a
          smudge, and sliders say "the things you can change" just as well. */}
      <line x1="2.5" y1="4.5" x2="13.5" y2="4.5" />
      <line x1="2.5" y1="11.5" x2="13.5" y2="11.5" />
      <rect x="9" y="2.75" width="2.5" height="3.5" fill="currentColor" stroke="none" />
      <rect x="4.5" y="9.75" width="2.5" height="3.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Compose({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

function ThemeSystem({ size = 16, title, className }: IconProps) {
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
      <rect x="2.25" y="3.25" width="11.5" height="8" />
      <line x1="5.5" y1="13.75" x2="10.5" y2="13.75" />
    </svg>
  );
}

function ThemeLight({ size = 16, title, className }: IconProps) {
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
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <circle cx="8" cy="8" r="3" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="8" y1="1.5" x2="8" y2="3" transform={`rotate(${a} 8 8)`} />
      ))}
    </svg>
  );
}

function ThemeDark({ size = 16, title, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      {...(title ? {} : { "aria-hidden": "true" })}
    >
      {title && <title>{title}</title>}
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.75 5.75 0 1 0 6.5 6.5Z" />
    </svg>
  );
}

function Install({ size = 16, title, className }: IconProps) {
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
      {/* A phone with something arriving in it, which is what installing is. */}
      <rect x="4.25" y="1.75" width="7.5" height="12.5" />
      <line x1="8" y1="5" x2="8" y2="10" />
      <path d="M6 8.25 L8 10.25 L10 8.25" fill="none" />
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
  | "Search"
  | "Today"
  | "Plan"
  | "Settings"
  | "Compose"
  | "ThemeSystem"
  | "ThemeLight"
  | "ThemeDark"
  | "Install";

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
  Today,
  Plan,
  Settings,
  Compose,
  ThemeSystem,
  ThemeLight,
  ThemeDark,
  Install,
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
  Today,
  Plan,
  Settings,
  Compose,
  ThemeSystem,
  ThemeLight,
  ThemeDark,
  Install,
};
