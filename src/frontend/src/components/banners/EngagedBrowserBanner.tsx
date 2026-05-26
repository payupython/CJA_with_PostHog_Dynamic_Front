import type { BannerProps } from './types';

export function EngagedBrowserBanner({ onDismiss }: BannerProps) {
  return (
    <div className="max-w-xl mx-auto bg-[#10202a] border border-[#3b8ea5]/60 rounded-xl shadow-2xl p-4 flex items-center gap-4">
      <div className="text-2xl shrink-0">🎭</div>
      <div className="flex-1">
        <p className="text-white font-bold text-sm">Has explorado varios teatros</p>
        <p className="text-cyan-200/70 text-xs mt-0.5">Estás comparando opciones — te avisamos si cambia la disponibilidad en cualquiera de ellos.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-cyan-300/80">✓ Seguimiento multi-teatro</span>
        <button onClick={onDismiss} className="text-cyan-300/60 hover:text-white transition text-xl leading-none" aria-label="Cerrar">×</button>
      </div>
    </div>
  );
}
