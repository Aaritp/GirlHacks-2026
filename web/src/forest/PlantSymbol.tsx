import type { GrowthState } from './health';
import botanicalAtlas from './assets/botanical-atlas.png';

/** Shared botanical atlas; state layers crossfade only after a successful save. */
export function PlantSymbol({ state, className = '' }: { state: GrowthState; className?: string }) {
  return <span className={`plant-symbol ${state} ${className}`} aria-hidden="true">
    {(['seed', 'sprout', 'bloom', 'wilted'] as GrowthState[]).map((stage, index) =>
      <span key={stage} className={`botanical-layer ${state === stage ? 'visible' : ''}`}
        style={{ backgroundImage: `url(${botanicalAtlas})`, backgroundPosition: `${index % 2 * 100}% ${Math.floor(index / 2) * 100}%` }} />)}
  </span>;
}
