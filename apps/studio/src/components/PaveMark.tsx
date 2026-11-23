/** The Pavé mark: a brilliant in profile, drawn with the same hairline as the kind glyphs. */
export function PaveMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-label="Pavé"
    >
      <path d="M3 9.5 7 4.5h10l4 5L12 20.5z" />
      <path
        d="M3 9.5h18M7 4.5l2 5 3 11 3-11 2-5M12 4.5l-3 5M12 4.5l3 5"
        strokeWidth="1"
        opacity=".55"
      />
    </svg>
  )
}
