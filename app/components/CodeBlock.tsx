import { codeToHtml } from "shiki";
import styles from "./CodeBlock.module.scss";

export type CodeLanguage = "c" | "javascript" | "typescript";

interface Props {
  code: string;
  language: CodeLanguage;
}

/**
 * A syntax-highlighted code sample. A server component: Shiki runs while the
 * page is built, so the browser gets static HTML and no highlighting JavaScript.
 *
 * Both themes are rendered at once as CSS variables (--shiki-light and
 * --shiki-dark on every token); CodeBlock.module.scss picks one with
 * prefers-color-scheme, like the rest of the site. Both themes' token colours
 * meet WCAG AA (4.5:1) against the site's light and dark backgrounds.
 */
export async function CodeBlock({ code, language }: Props) {
  const highlightedHtml = await codeToHtml(code.trim(), {
    lang: language,
    themes: { light: "github-light-default", dark: "github-dark-default" },
    defaultColor: false,
  });
  // Shiki escapes the code itself; the HTML is generated at build time from our own source.
  return <div className={styles.codeBlock} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />;
}
