import React from 'react';
import {
  Alignment,
  Fit,
  Layout,
  useRive
} from '@rive-app/react-canvas';

const NUMBER_PROPERTY = 'numberProperty';

interface FlowerMascotProps {
  condition?: number;
  className?: string;
  onLoadError?: () => void;
}

const FlowerMascot: React.FC<FlowerMascotProps> = ({
  condition = 0,
  className,
  onLoadError
}) => {
  const { RiveComponent, rive } = useRive({
    src: '/assets/dancing_flower.riv',
    artboard: 'Artboard',
    stateMachines: 'State Machine 1',
    autoplay: true,
    autoBind: true,
    onLoadError,
    layout: new Layout({
      fit: Fit.Contain,
      alignment: Alignment.Center
    })
  });

  React.useEffect(() => {
    if (!rive) return;

    const vmi = rive.viewModelInstance;
    if (!vmi) {
      console.warn(
        '[Rive] No viewModelInstance — check data binding / autoBind in your .riv file'
      );
      return;
    }

    const numberProp = vmi.number(NUMBER_PROPERTY);
    if (!numberProp) {
      console.warn(
        `[Rive] Property "${NUMBER_PROPERTY}" not found — use the exact name from the Rive editor`
      );
      return;
    }

    numberProp.value = condition;
  }, [rive, condition]);

  return (
    <div className={className}>
      <RiveComponent className="h-full w-full" />
    </div>
  );
};

export default FlowerMascot;
