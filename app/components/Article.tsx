import type { ReactNode } from "react";
import styles from "./Article.module.scss";

interface Props {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}

/** Layout for text pages: a comfortable reading width, same theme as the home page. */
export function Article({ title, lead, children }: Props) {
  return (
    <main className="mx-auto w-full max-w-[42rem] px-5 pt-8 pb-24 desktop:px-8 desktop:pt-12">
      <article className={styles.prose}>
        <h1 className="mb-3 text-3xl font-bold tracking-tight">{title}</h1>
        {lead && <p className="text-lg text-muted">{lead}</p>}
        {children}
      </article>
    </main>
  );
}
