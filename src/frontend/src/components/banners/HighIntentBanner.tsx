import type { BannerProps } from './types';

export function HighIntentBanner({ userEmail, onDismiss }: BannerProps) {
  return (
    <div className="max-w-2xl mx-auto bg-[#7a4f2e] border border-[#9a6840] rounded-xl shadow-2xl p-4 flex items-center gap-4">
      <div className="text-2xl shrink-0">🎯</div>
      <div className="flex-1">
        <p className="text-white font-bold text-sm">¿Buscas entradas activamente?</p>
        <p className="text-[#f0c89a] text-xs mt-0.5">Te avisamos por email cuando haya disponibilidad en los teatros que visitaste.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-[#f0c89a] font-medium">✓ Alertas activas en {userEmail}</span>
        <button onClick={onDismiss} className="text-[#f0c89a] hover:text-white transition text-lg leading-none" aria-label="Cerrar">×</button>
      </div>
    </div>
  );
}
