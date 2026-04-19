import '../styles/vision-orb.css';
import GeneratingOrb from './GeneratingOrb';

interface VisionOrbStageProps {
  isAgentRunning: boolean;
  isSearchExiting: boolean;
  isOrbVisible: boolean;
  isResonanceVisible: boolean;
  isProcessVisible: boolean;
}

function VisionOrbStage({
  isAgentRunning,
  isSearchExiting,
  isOrbVisible,
  isResonanceVisible,
  isProcessVisible,
}: VisionOrbStageProps) {
  const className = [
    'vision-stage-layer',
    'vision-stage-layer--orb',
    'vision-orb-transition',
    isAgentRunning && 'vision-stage-layer--orb-active',
    isSearchExiting && 'vision-stage-layer--orb-primed',
    isProcessVisible && 'vision-stage-layer--orb-fading',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <div
        className={`vision-resonance ${isResonanceVisible ? 'vision-resonance--visible' : ''}`}
        aria-hidden="true"
      >
        <div className="vision-resonance__aura" />
        <div className="vision-resonance__aura vision-resonance__aura--reverse" />
        <div className="vision-resonance__wave" />
        <div className="vision-resonance__wave vision-resonance__wave--delayed-1" />
        <div className="vision-resonance__wave vision-resonance__wave--delayed-2" />
        <div className="vision-resonance__wave vision-resonance__wave--delayed-3" />
      </div>

      <GeneratingOrb isVisible={isOrbVisible} />
    </div>
  );
}

export default VisionOrbStage;
