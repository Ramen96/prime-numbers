import Link from "next/link";
import { AUTHOR_NAME, AUTHOR_URL, SITE_NAME } from "@/lib/site";
import { NavLinks } from "./NavLinks";

/**
 * Site navigation, shared by every page through the root layout.
 * Mobile and tablet: a compact bar stuck to the top.
 * Desktop: a slim sidebar stuck to the left edge.
 */
export function SiteNav() {
  return (
    <nav
      aria-label="Site"
      data-testid="site-nav"
      className="sticky top-0 z-20 flex h-(--mobile-nav-height) items-center border-b border-rule bg-background px-2 sm:px-3 desktop:h-dvh desktop:w-44 desktop:shrink-0 desktop:flex-col desktop:items-stretch desktop:border-r desktop:border-b-0 desktop:px-5 desktop:py-8"
    >
      <Link
        href="/"
        className="hidden font-bold leading-tight tracking-tight desktop:mb-8 desktop:block"
      >
        {SITE_NAME}
      </Link>
      <NavLinks />
      <p className="mt-auto hidden text-xs text-muted desktop:block">
        Built by{" "}
        <a href={AUTHOR_URL} className="underline underline-offset-2 hover:text-foreground">
          {AUTHOR_NAME}
        </a>
      </p>
    </nav>
  );
}
