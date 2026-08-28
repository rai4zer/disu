"use client";

import styles from "./ui-state.module.css";

type Props = {
  kind: "loading" | "empty" | "error";
  message: string;
  className?: string;
};

export default function UiState({ kind, message, className }: Props) {
  return (
    <div className={`${styles.state} ${styles[`state_${kind}`]} ${className ?? ""}`} role={kind === "error" ? "alert" : "status"}>
      {message}
    </div>
  );
}

