import type { BannerProps } from './types';

export function ActiveSearcherBanner({ onDismiss }: BannerProps) {
  return (
    <div className="max-w-xl mx-auto bg-[#1a102a] border border-[#7b3ba5]/60 rounded-xl shadow-2xl p-4 flex items-center gap-4">
      <div className="text-2xl shrink-0">🔍</div>
      <div className="flex-1">
        <p className="text-white font-bold text-sm">Búsqueda activa detectada</p>
        <p className="text-violet-200/70 text-xs mt-0.5">Estás buscando algo específico. Si no lo encuentras, te avisamos cuando aparezcan nuevos eventos.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-violet-300/80">✓ Alerta de nuevos eventos</span>
        <button onClick={onDismiss} className="text-violet-300/60 hover:text-white transition text-xl leading-none" aria-label="Cerrar">×</button>
      </div>
    </div>
  );
}
