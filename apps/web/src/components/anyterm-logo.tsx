type AnytermLogoProps = {
  className?: string;
  showWordmark?: boolean;
  textClassName?: string;
  iconClassName?: string;
};

export function AnytermLogo({
  className = "",
  showWordmark = true,
  textClassName = "",
  iconClassName = "",
}: AnytermLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`.trim()}>
      <svg
        className={`h-8 w-8 shrink-0 ${iconClassName}`.trim()}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="56" height="56" rx="16" fill="#090D18" />
        <rect x="4.75" y="4.75" width="54.5" height="54.5" rx="15.25" stroke="#1F2937" strokeWidth="1.5" />
        <circle cx="32" cy="32" r="17.5" stroke="#14B8A6" strokeWidth="3" opacity="0.92" />
        <path d="M22 24.5L29.5 32L22 39.5" stroke="#F8FAFC" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M34.5 39.5H42.5" stroke="#F8FAFC" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M45 19.5C49.2 22.6 51.8 27.6 51.8 33C51.8 38.4 49.2 43.4 45 46.5"
          stroke="#34D399"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M19 19.5C14.8 22.6 12.2 27.6 12.2 33C12.2 38.4 14.8 43.4 19 46.5"
          stroke="#22D3EE"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.8"
        />
      </svg>

      {showWordmark ? (
        <span className={`font-display text-xl font-bold tracking-tight text-white ${textClassName}`.trim()}>
          anyterm
        </span>
      ) : null}
    </span>
  );
}

