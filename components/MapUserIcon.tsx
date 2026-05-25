import React from 'react';
import { Alignment, Fit, Layout, useRive } from '@rive-app/react-canvas';

interface MapUserIconProps {
  className?: string;
  onLoadError?: () => void;
}

const MapUserIcon: React.FC<MapUserIconProps> = ({ className, onLoadError }) => {
  const { RiveComponent } = useRive({
    src: '/assets/sunny_icon.riv',
    artboard: 'Artboard',
    stateMachines: 'State Machine 1',
    autoplay: true,
    onLoadError,
    layout: new Layout({
      fit: Fit.Contain,
      alignment: Alignment.Center
    })
  });

  return (
    <div className={className}>
      <RiveComponent className="h-full w-full" />
    </div>
  );
};

export default MapUserIcon;
