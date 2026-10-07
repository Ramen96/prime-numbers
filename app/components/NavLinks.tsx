"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GITHUB_URL } from "@/lib/site";
import { StarIcon } from "./StarIcon";

const PAGES = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
] as const;

const LINK_CLASSES =
  "flex h-11 items-center rounded-md px-2.5 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) sm:px-3 desktop:h-auto desktop:px-0 desktop:py-1.5 desktop:text-[0.95rem]";
// The heat accent marks the current page: a bar under it on mobile, beside it on desktop.
const CURRENT_PAGE_CLASSES =
  "font-semibold text-foreground! shadow-[inset_0_-2px_0_var(--heat-color)] desktop:pl-3 desktop:shadow-[inset_2px_0_0_var(--heat-color)]";

export function NavLinks() {
  // Static pages are prerendered per path, so this is known on the server too
  // and aria-current is in the HTML.
  const currentPath = usePathname();

  return (
    <ul className="flex w-full items-center desktop:flex-col desktop:items-stretch desktop:gap-1">
      {PAGES.map(({ href, label }) => {
        const isCurrentPage = currentPath === href;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={isCurrentPage ? "page" : undefined}
              className={`${LINK_CLASSES} ${isCurrentPage ? CURRENT_PAGE_CLASSES : ""}`}
            >
              {label}
            </Link>
          </li>
        );
      })}
      {/*
        Favorites: a star icon in the phone nav bar (five words don't fit in one
        row at 360px), the word in the desktop sidebar. Named "Favorites" either way.
      */}
      <li className="ml-auto desktop:ml-0">
        <Link
          href="/favorites"
          aria-current={currentPath === "/favorites" ? "page" : undefined}
          className={`${LINK_CLASSES} w-11 justify-center desktop:w-auto desktop:justify-start ${currentPath === "/favorites" ? CURRENT_PAGE_CLASSES : ""}`}
        >
          <span aria-hidden className="desktop:hidden">
            <StarIcon filled={currentPath === "/favorites"} size={20} />
          </span>
          <span className="sr-only desktop:not-sr-only">Favorites</span>
        </Link>
      </li>
      <li className="desktop:mt-3">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub (opens in a new tab)"
          className={`${LINK_CLASSES} w-11 justify-center desktop:w-auto desktop:justify-start desktop:gap-2`}
        >
          <GitHubIcon />
          <span className="hidden desktop:inline">GitHub</span>
        </a>
      </li>
    </ul>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
