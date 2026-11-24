"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { GITHUB_URL } from "@/lib/site";
import { StarIcon } from "./StarIcon";

// Every page of the site, in three groups: the desktop sidebar lists them all, and
// on phones (where the bar has room for four things) the Menu does. Short labels,
// so each fits one line of the 135 px sidebar; the pages keep their full titles.

interface NavLink {
  href: string;
  label: string;
}

interface NavGroup {
  /** Shown above the group, with a rule to the edge. */
  heading: string;
  links: readonly NavLink[];
  /** Ends with GitHub, which opens in a new tab. */
  withGitHub?: boolean;
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    heading: "Explore",
    links: [
      { href: "/", label: "Home" },
      { href: "/is-prime", label: "Is it prime?" },
      { href: "/random-prime", label: "Random prime" },
      { href: "/favorites", label: "Favorites" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { href: "/what-is-a-prime-number", label: "What is a prime?" },
      { href: "/how-to-tell-if-a-number-is-prime", label: "Checking by hand" },
      { href: "/mersenne-primes", label: "Mersenne primes" },
      { href: "/fun-facts", label: "Fun facts" },
    ],
  },
  {
    heading: "This site",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/about", label: "About" },
    ],
    withGitHub: true,
  },
];

const FOCUS_CLASSES = "focus-visible:outline-2 focus-visible:outline-(--heat-text)";
// The heat accent marks the current page: a bar under it in the phone bar, beside it in the lists.
const CURRENT_IN_BAR_CLASSES = "font-semibold text-foreground! shadow-[inset_0_-2px_0_var(--heat-color)]";
// In the lists, each group's links hang off a rail (the list's left border); a link
// lights its own piece of it, so the current page is marked without moving sideways.
const CURRENT_IN_LIST_CLASSES = "font-semibold text-foreground! border-(--heat-color)!";
const GROUP_HEADING_CLASSES = "mb-2 flex items-center gap-2 text-xs font-semibold tracking-widest text-foreground uppercase";
const RAIL_CLASSES = "flex flex-col border-l border-rule";

/** The phone bar's links. Below 320 px (a Galaxy Fold’s cover screen is 280), a little tighter. */
const BAR_LINK_CLASSES = `flex h-11 items-center rounded-md px-2.5 text-sm max-[319px]:px-1 max-[319px]:text-[0.8125rem] text-muted transition-colors hover:text-foreground sm:px-3 ${FOCUS_CLASSES}`;

/**
 * A link in one of the full lists: the sidebar (compact, so all fit at 600 px
 * tall) or the menu (44 px rows). Its left border sits over the rail (-ml-px),
 * clear until hovered or current.
 */
const listLinkClasses = (inMenu: boolean) =>
  `-ml-px flex items-center border-l-2 border-transparent pl-3 text-muted transition-colors hover:border-muted hover:text-foreground ${FOCUS_CLASSES} ${
    // on desktops under 760 px tall, a little tighter, so every link fits (down to 600, the smallest desktop)
    inMenu ? "h-11 text-base" : "py-1 text-[0.95rem] [@media(max-height:47.5rem)]:py-0.5"
  }`;

const MENU_ID = "site-menu";

/** Every page, grouped: the desktop sidebar's list, and the phone menu's. */
function SiteLinks({ currentPath, inMenu, onNavigate }: { currentPath: string; inMenu: boolean; onNavigate?: () => void }) {
  const linkClasses = listLinkClasses(inMenu);
  return (
    <div className={`flex flex-col ${inMenu ? "gap-6" : "gap-6 [@media(max-height:47.5rem)]:gap-5"}`}>
      {NAV_GROUPS.map((group) => (
        <div key={group.heading}>
          <p className={GROUP_HEADING_CLASSES}>
            {group.heading}
            <span aria-hidden className="h-px flex-1 bg-rule" />
          </p>
          <ul className={RAIL_CLASSES}>
            {group.links.map(({ href, label }) => {
              const isCurrentPage = currentPath === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={isCurrentPage ? "page" : undefined}
                    className={`${linkClasses} ${isCurrentPage ? CURRENT_IN_LIST_CLASSES : ""}`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
            {group.withGitHub && (
              <li>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub (opens in a new tab)"
                  onClick={onNavigate}
                  className={`${linkClasses} gap-2`}
                >
                  <GitHubIcon />
                  GitHub ↗
                </a>
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function NavLinks() {
  // Static pages are prerendered per path, so this is known on the server too
  // and aria-current is in the HTML.
  const currentPath = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = () => menuRef.current?.hidePopover();

  // Opening the menu puts focus on its first link; closing it (Escape, a tap
  // outside, ☰ again) gives focus back to ☰, as the browser does for a popover.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") menu.querySelector<HTMLElement>("a")?.focus();
    };
    menu.addEventListener("toggle", onToggle);
    return () => menu.removeEventListener("toggle", onToggle);
  }, []);
  // A page change closes it too (the links close it as they're followed; this covers back and forward).
  useEffect(() => closeMenu(), [currentPath]);

  const barLink = (href: string, label: string) => (
    <li>
      <Link
        href={href}
        aria-current={currentPath === href ? "page" : undefined}
        className={`${BAR_LINK_CLASSES} ${currentPath === href ? CURRENT_IN_BAR_CLASSES : ""}`}
      >
        {label}
      </Link>
    </li>
  );

  return (
    <>
      {/* Desktop: every page, in the sidebar. Scrolls in its own box if a short screen ever needs it. */}
      <div className="hidden min-h-0 overflow-y-auto desktop:block" data-testid="site-nav-list">
        <SiteLinks currentPath={currentPath} inMenu={false} />
      </div>

      {/* Phones: four things fit in the bar; the Menu holds every page. */}
      <ul className="flex w-full items-center desktop:hidden" data-testid="site-nav-bar">
        {barLink("/", "Home")}
        {barLink("/is-prime", "Is it prime?")}
        <li className="ml-auto">
          <Link
            href="/favorites"
            aria-current={currentPath === "/favorites" ? "page" : undefined}
            className={`${BAR_LINK_CLASSES} w-11 justify-center ${currentPath === "/favorites" ? CURRENT_IN_BAR_CLASSES : ""}`}
          >
            <span aria-hidden>
              <StarIcon filled={currentPath === "/favorites"} size={20} />
            </span>
            <span className="sr-only">Favorites</span>
          </Link>
        </li>
        <li>
          <button
            type="button"
            popoverTarget={MENU_ID}
            aria-label="Menu"
            aria-controls={MENU_ID}
            className={`${BAR_LINK_CLASSES} w-11 justify-center`}
          >
            <MenuIcon />
          </button>
        </li>
      </ul>
      <div
        ref={menuRef}
        id={MENU_ID}
        popover="auto"
        data-testid="site-menu"
        className="fixed inset-x-0 top-(--mobile-nav-height) bottom-auto m-0 max-h-[calc(100dvh-var(--mobile-nav-height))] w-full overflow-y-auto border-b border-rule bg-background px-5 py-4 text-foreground shadow-lg backdrop:bg-black/30 desktop:hidden"
      >
        <SiteLinks currentPath={currentPath} inMenu onNavigate={closeMenu} />
      </div>
    </>
  );
}

/** Three lines: the phone bar's Menu. */
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
