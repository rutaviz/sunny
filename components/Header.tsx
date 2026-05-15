import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-white border-b border-slate-200 py-4 px-6 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 sunny-gradient rounded-xl flex items-center justify-center text-white shadow-lg">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">SunnyPath</h1>
          <p className="text-xs text-slate-500 font-medium">Powered by ShadeMap</p>
        </div>
      </div>
      <div className="hidden md:block text-right">
        <span className="text-sm font-semibold text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-100">
          Target: &gt;50% Sunlight
        </span>
      </div>
    </header>
  );
};

export default Header;