import React from 'react';
import {
  Alignment,
  Fit,
  Layout,
  useRive
} from '@rive-app/react-canvas';

const NUMBER_PROPERTY = 'numberProperty';
const VALUE_NORMAL = 5;
const VALUE_IN_SUN = 4;

interface MapUserIconProps {
  inSun?: boolean;
  className?: string;
  onLoadError?: () => void;
}

const MapUserIcon: React.FC<MapUserIconProps> = ({
  inSun = false,
  className,
  onLoadError
}) => {
  const { RiveComponent, rive } = useRive({
    src: '/assets/sunny_icon.riv',
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
    if (!vmi) return;

    const numberProp = vmi.number(NUMBER_PROPERTY);
    if (!numberProp) return;

    numberProp.value = inSun ? VALUE_IN_SUN : VALUE_NORMAL;
  }, [rive, inSun]);

  return (
    <div className={className}>
      <RiveComponent className="h-full w-full" />
    </div>
  );
};

export default MapUserIcon;
