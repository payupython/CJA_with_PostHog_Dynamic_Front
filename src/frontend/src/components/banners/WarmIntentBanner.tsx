import type { BannerProps } from './types';

export function WarmIntentBanner({ onDismiss }: BannerProps) {
  return (
    <div className="max-w-xl mx-auto bg-[#2a1c10] border border-[#a57b3b]/60 rounded-xl shadow-2xl p-4 flex items-center gap-4">
      <div className="text-2xl shrink-0">🕐</div>
      <div className="flex-1">
        <p className="text-white font-bold text-sm">Llevas un rato explorando</p>
        <p className="text-amber-200/70 text-xs mt-0.5">Vimos que estás interesado en entradas. Te alertamos por email si aparece disponibilidad.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-amber-300/80">✓ Monitoreo activo</span>
        <button onClick={onDismiss} className="text-amber-300/60 hover:text-white transition text-xl leading-none" aria-label="Cerrar">×</button>
      </div>
    </div>
  );
}
