/** A compass, in the surrounding text's colour: “Take me somewhere interesting” in the phone's jump box. */
export function CompassIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15.5 8.5 13.4 13.4 8.5 15.5 10.6 10.6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
