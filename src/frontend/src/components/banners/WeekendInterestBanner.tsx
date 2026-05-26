import type { BannerProps } from './types';

export function WeekendInterestBanner({ onDismiss }: BannerProps) {
  return (
    <div className="max-w-xl mx-auto bg-[#1c2a3a] border border-[#3b6ea5]/60 rounded-xl shadow-2xl p-4 flex items-center gap-4">
      <div className="text-2xl shrink-0">🗓️</div>
      <div className="flex-1">
        <p className="text-white font-bold text-sm">¿Te interesan los eventos de fin de semana?</p>
        <p className="text-blue-200/70 text-xs mt-0.5">Filtraste por Sábado o Domingo — te avisamos cuando haya entradas disponibles para el fin de semana.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-blue-300/80">✓ Alertas activas</span>
        <button onClick={onDismiss} className="text-blue-300/60 hover:text-white transition text-xl leading-none" aria-label="Cerrar">×</button>
      </div>
    </div>
  );
}
