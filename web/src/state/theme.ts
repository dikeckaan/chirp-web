// Tiny theme manager — keeps the body class in sync with localStorage
// and exposes a hook for the toggle UI. We don't bother with system
// `prefers-color-scheme` heuristics; this app is a tool and the user
// will pick what they want.

import { useEffect, useState } from "react";

const KEY = "chirp.theme";
export type Theme = "dark" | "light";

function read(): Theme {
  if (typeof localStorage === "undefined") return "dark";
  const v = localStorage.getItem(KEY);
  return v === "light" ? "light" : "dark";
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

apply(read());

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  return [theme, setTheme];
}
