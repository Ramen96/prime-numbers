// How deep /how-it-works opens (CLAUDE.md, After completion 3e): four levels, each
// section's basics always shown and its deeper levels in nested <details>. The
// depth comes from ?level= (a shared link, for that visit), else the reader's
// saved choice, else A bit deeper. Every level is in the HTML whatever the depth.

export const DEPTH_LEVELS = [
  { level: 1, name: "The basics" },
  { level: 2, name: "A bit deeper" },
  { level: 3, name: "Under the hood" },
  { level: 4, name: "Turtles all the way down" },
] as const;

export type DepthLevel = (typeof DEPTH_LEVELS)[number]["level"];

/** What the page opens to without a link or a saved choice, and without JavaScript. */
export const DEFAULT_DEPTH: DepthLevel = 2;
export const DEPTH_PARAMETER = "level";
export const DEPTH_STORAGE_KEY = "everyPrimeNumber.howItWorksDepth";

export function depthName(level: DepthLevel): string {
  return DEPTH_LEVELS[level - 1].name;
}

/** "1" to "4" as a level; anything else (missing, "0", "9", "2.5", " 2") is none. */
export function parseDepth(text: string | null | undefined): DepthLevel | null {
  return text !== null && text !== undefined && /^[1-4]$/.test(text) ? (Number(text) as DepthLevel) : null;
}

/** The level a page opens to: the address's ?level=, else the saved one, else the default. */
export function initialDepth(queryString: string, saved: string | null): DepthLevel {
  return parseDepth(new URLSearchParams(queryString).get(DEPTH_PARAMETER)) ?? parseDepth(saved) ?? DEFAULT_DEPTH;
}

/** The current address with ?level= set, other parameters and the #anchor kept. */
export function urlWithDepth(currentUrl: string, level: DepthLevel): string {
  const url = new URL(currentUrl);
  url.searchParams.set(DEPTH_PARAMETER, String(level));
  return url.pathname + url.search + url.hash;
}

/** What screen readers hear when the switch changes every section. */
export function depthAnnouncement(level: DepthLevel): string {
  return `Every section now opens to ${depthName(level)}.`;
}

/**
 * Run inline as soon as the sections are parsed, before the page is first drawn,
 * so a reader whose depth isn't the default doesn't see the page jump: the same
 * choice as initialDepth (kept in step by the tests), applied to every level's
 * <details>, and the switch shown (it does nothing without JavaScript).
 */
export const APPLY_DEPTH_SCRIPT = `(function () {
  try {
    var match = /[?&]${DEPTH_PARAMETER}=([^&#]*)/.exec(location.search);
    var level = match && /^[1-4]$/.test(decodeURIComponent(match[1])) ? Number(match[1]) : 0;
    if (!level) {
      try {
        var saved = localStorage.getItem(${JSON.stringify(DEPTH_STORAGE_KEY)});
        if (saved && /^[1-4]$/.test(saved)) level = Number(saved);
      } catch (error) {}
    }
    if (!level) level = ${DEFAULT_DEPTH};
    var levels = document.querySelectorAll("details[data-depth]");
    for (var index = 0; index < levels.length; index++) levels[index].open = Number(levels[index].getAttribute("data-depth")) <= level;
    var depthSwitch = document.getElementById("depth-switch");
    if (depthSwitch) {
      depthSwitch.hidden = false;
      var choice = depthSwitch.querySelector('input[value="' + level + '"]');
      if (choice) choice.checked = true;
    }
  } catch (error) {}
})();`;
