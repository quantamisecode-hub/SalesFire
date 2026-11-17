// Top-of-viewport progress bar — visible on every navigation and initial
// page load. Animates via CSS (scaleX) so it never blocks interaction.
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export function PageLoadingBar() {
  const location = useLocation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 400);
    return () => clearTimeout(t);
  }, [location.key]);

  if (!visible) return null;
  return (
    <div
      className="pointer-events-none fixed top-0 left-0 right-0 z-[65] h-0.5 bg-transparent overflow-hidden"
      role="progressbar"
      aria-label="Loading page"
      aria-valuetext="Loading page"
    >
      <div className="h-full bg-primary animate-route-progress origin-left" />
    </div>
  );
}
