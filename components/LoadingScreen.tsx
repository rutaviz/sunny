import React from "react";
import { useRive, Layout, Fit, Alignment } from "@rive-app/react-canvas";

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message }) => {
  const [hasError, setHasError] = React.useState(false);
  const [tipIndex, setTipIndex] = React.useState(0);
  const [showLoader, setShowLoader] = React.useState(true);

  const tips = [
    "Finding the sunniest spots for you...",
    "Calculating building shadows...",
    "Optimizing your vitamin D intake...",
    "Scouting for the perfect sunny bench...",
    "Preparing your sun-drenched route...",
  ];

  // Rotate tips
  React.useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  // Minimum loading time (10 seconds)
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowLoader(false);
    }, 10000);

    return () => clearTimeout(timer);
  }, []);

  const { RiveComponent } = useRive({
    src: "/assets/dancing_flower.riv",
    stateMachines: "State Machine 1",
    autoplay: true,
    layout: new Layout({
      fit: Fit.Contain,
      alignment: Alignment.Center,
    }),
    onLoadError: () => {
      console.error("Rive failed to load");
      setHasError(true);
    },
  });

  if (!showLoader) return null;

  return (
    <div className="fixed inset-0 z-[6000] flex flex-col items-center justify-center bg-white/90 backdrop-blur-lg transition-opacity duration-700">
      
      {/* Rive animation */}
      <div className="w-[50vw] max-w-[400px] aspect-square mb-8 flex items-center justify-center">
        {!hasError ? (
          <RiveComponent className="w-full h-full" />
        ) : (
          <div className="w-32 h-32 bg-amber-100 rounded-full flex items-center justify-center animate-pulse">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-spin"
            >
              <path d="M12 2v4" />
              <path d="m16.2 7.8 2.9-2.9" />
              <path d="M18 12h4" />
              <path d="m16.2 16.2 2.9 2.9" />
              <path d="M12 18v4" />
              <path d="m4.9 19.1 2.9-2.9" />
              <path d="M2 12h4" />
              <path d="m4.9 4.9 2.9 2.9" />
            </svg>
          </div>
        )}
      </div>

      {/* Loading UI */}
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" />
        </div>

        <p className="text-slate-800 font-black uppercase tracking-widest text-sm animate-pulse mb-1">
          {message || "Loading..."}
        </p>

        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-tighter transition-all duration-500">
          {tips[tipIndex]}
        </p>
      </div>
    </div>
  );
};

export default LoadingScreen;