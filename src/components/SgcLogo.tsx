// SGC logo — approximation of the Shree Ganesh Corporation mark.
export function SgcLogo({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer maroon border */}
      <rect x="2" y="2" width="76" height="76" rx="4" fill="#7B1A1A" />
      {/* Inner gold/cream box */}
      <rect x="7" y="7" width="66" height="66" rx="2" fill="#F5E6C8" />
      {/* S */}
      <text
        x="12"
        y="54"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fontSize="38"
        fill="#7B1A1A"
      >
        S
      </text>
      {/* G */}
      <text
        x="32"
        y="54"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fontSize="38"
        fill="#7B1A1A"
      >
        G
      </text>
      {/* C — partial, clipped to suggest the logo style */}
      <text
        x="52"
        y="54"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fontSize="38"
        fill="#7B1A1A"
      >
        C
      </text>
    </svg>
  );
}
