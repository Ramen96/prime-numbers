import { pageMetadata } from "@/lib/pageMetadata";
import { FavoritesManager } from "../components/FavoritesManager";

export const metadata = pageMetadata({
  title: "Your Favorite Primes | Every Prime Number",
  description:
    "The primes you've starred on Every Prime Number, kept only in this browser. Jump back to any of them in the list.",
  path: "/favorites",
  // Favorites are personal, so there's nothing here for search engines.
  noIndex: true,
});

/**
 * The page shell is static; the favorites and records come from this browser's
 * storage after mount (FavoritesManager). Like the home page, it's exactly one
 * screen tall and only the list scrolls.
 */
export default function FavoritesPage() {
  return (
    <main className="mx-auto flex h-[calc(100dvh-var(--mobile-nav-height)-var(--storage-notice-height))] w-full max-w-3xl flex-col px-5 pt-6 desktop:h-[calc(100dvh-var(--storage-notice-height))] desktop:max-w-[44rem] desktop:px-8 desktop:pt-10">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Favorite primes</h1>
      <p className="mt-2 max-w-prose text-muted">
        The primes you’ve starred, kept only in this browser. Tap the ☆ next to any prime in the
        list to add it.
      </p>
      <FavoritesManager />
    </main>
  );
}
