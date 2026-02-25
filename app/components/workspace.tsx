import styles from "./workspace.module.css";

type Props = {
  title: string;
  subtitle?: string;
  size?: "default" | "narrow";
  children: React.ReactNode;
};

export default function Workspace({ title, subtitle, size = "default", children }: Props) {
  return (
    <section className={size === "narrow" ? `${styles.root} ${styles.narrow}` : styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
