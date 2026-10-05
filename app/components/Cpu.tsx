import styles from "./Cpu.module.scss";

export function Cpu() {
  return (
    <div className={styles.wrap} aria-hidden>
      <div className={styles.shimmer}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.glow}>
        <div />
      </div>
      <div className={styles.chip}>
        <div className={styles.pinsTop} />
        <div className={styles.pinsBottom} />
        <div className={styles.pinsLeft} />
        <div className={styles.pinsRight} />
        <div className={styles.face}>
          <div className={styles.eyes}>
            <span />
            <span />
          </div>
          <div className={styles.mouth} />
        </div>
      </div>
      <div className={styles.sweat}>
        <span />
        <span />
      </div>
    </div>
  );
}
