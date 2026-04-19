import type { CSSProperties } from 'react';

interface GeneratingOrbProps {
  isVisible: boolean;
  label?: string;
}

function GeneratingOrb({ isVisible, label = 'Analyzing' }: GeneratingOrbProps) {
  return (
    <div className={`generating-orb-shell ${isVisible ? 'generating-orb-shell--visible' : ''}`}>
      <div className="generating-orb">
        <div className="generating-orb__glow" />

        <div className="generating-orb__main">
          <div className="generating-orb__liquid-layer generating-orb__liquid-base" />
          <div className="generating-orb__liquid-layer generating-orb__liquid-highlight-1" />
          <div className="generating-orb__liquid-layer generating-orb__liquid-highlight-2" />
          <div className="generating-orb__core" />
          <div className="generating-orb__glass" />
        </div>

        <div className="generating-orb__text" aria-live="polite">
          {Array.from(label).map((char, index) => (
            <span key={`${char}-${index}`} style={{ '--i': index + 1 } as CSSProperties}>
              {char === ' ' ? '\u00A0' : char}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default GeneratingOrb;
