import React, { useEffect, useState } from 'react';

interface ClinicLogoProps {
  size?: 'sm' | 'md' | 'lg';
  refreshKey?: number;
}

export const ClinicLogo: React.FC<ClinicLogoProps> = ({ size = 'md', refreshKey = 0 }) => {
  const [hasCustomLogo, setHasCustomLogo] = useState(true);

  useEffect(() => {
    setHasCustomLogo(true);
  }, [refreshKey]);

  const dims =
    size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-14 h-14' : 'w-10 h-10';

  if (hasCustomLogo) {
    return (
      <div className={`${dims} rounded-lg overflow-hidden bg-white border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0`}>
        <img
          src={`/api/settings/logo?v=${refreshKey}`}
          alt="Logo Cabinet Médical de Cardiologie Paris 16"
          className="w-full h-full object-contain p-1"
          referrerPolicy="no-referrer"
          onError={() => setHasCustomLogo(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={`${dims} rounded-lg bg-[#073B70] text-white flex items-center justify-center shrink-0 shadow-xs`}
      aria-label="Logo CARDIO ERP"
    >
      <svg viewBox="0 0 36 36" className="w-6 h-6" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M18 30.5C18 30.5 6 22.8 6 13.8C6 9.9 9.1 6.8 13 6.8C15.3 6.8 17.3 7.9 18 9.6C18.7 7.9 20.7 6.8 23 6.8C26.9 6.8 30 9.9 30 13.8C30 22.8 18 30.5 18 30.5Z"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 17.5H13L15.2 12.5L18.2 22.2L20.8 15.8L22.5 17.5H27.5"
          stroke="#D71920"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
