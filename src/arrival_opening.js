export const ARRIVAL_BLANK_SECONDS = 0.35;
export const ARRIVAL_REVEAL_SECONDS = 1.25;

export class ArrivalOpening {
  constructor() {
    this.entry_complete = false;
    this.assets_ready = false;
    this.phase = 'waiting';
    this.elapsed = 0;
    this.opacity = 0;
  }

  update(seconds) {
    if (!this.entry_complete || this.phase === 'complete') return;
    if (this.phase === 'waiting') {
      this.phase = 'blank';
      this.elapsed = 0;
      return;
    }
    this.elapsed += seconds;
    if (this.phase === 'blank') {
      if (this.elapsed < ARRIVAL_BLANK_SECONDS || !this.assets_ready) return;
      this.phase = 'revealing';
      this.elapsed = 0;
      return;
    }
    const progress = Math.min(1, this.elapsed / ARRIVAL_REVEAL_SECONDS);
    this.opacity = progress * progress * (3 - 2 * progress);
    if (progress === 1) this.phase = 'complete';
  }
}
