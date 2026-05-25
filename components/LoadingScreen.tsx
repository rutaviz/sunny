import React from 'react';

const SHOW_LOADING_UI = false;

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message }) => {
  const [tipIndex, setTipIndex] = React.useState(0);

  const tips = [
    'Finding the sunniest spots for you...',
    'Calculating building shadows...',
    'Optimizing your vitamin D intake...',
    'Scouting for the perfect sunny bench...',
    'Preparing your sun-drenched route...',
  ];

  React.useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  if (!SHOW_LOADING_UI) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-36 z-[30] flex flex-col items-center gap-3 px-6">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]" />
        <div className="h-2 w-2 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]" />
        <div className="h-2 w-2 animate-bounce rounded-full bg-amber-500" />
      </div>

      <p className="text-center text-sm font-black uppercase tracking-widest text-slate-800">
        {message || 'Loading...'}
      </p>

      <p className="text-center text-[10px] font-bold uppercase tracking-tighter text-slate-500">
        {tips[tipIndex]}
      </p>
    </div>
  );
};

export default LoadingScreen;
