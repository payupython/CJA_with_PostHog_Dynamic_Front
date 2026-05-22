import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  ruleName: string;
  segment: string;
  fromEmail: string;
  onDismiss: () => void;
}

export function InviteNotification({ ruleName, segment, fromEmail, onDismiss }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const send = async () => {
    if (!email.trim() || !email.includes('@')) return;
    setStatus('sending');
    try {
      const res = await fetch(`${API_URL}/api/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail: email.trim(), fromEmail }),
      });
      setStatus(res.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  };

  const SEGMENT_LABEL: Record<string, string> = {
    high_intent:    '🎯 Alta intención de compra',
    warm_intent:    '🕐 Llevas tiempo buscando entradas',
    engaged:        '🎭 Has explorado varios teatros',
    active_searcher:'🔍 Búsqueda activa',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-[#1c1510] border border-[#7a4f2e]/60 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-[#7a4f2e]/20 px-4 py-3 flex items-start justify-between gap-2 border-b border-[#7a4f2e]/30">
        <div>
          <p className="text-xs font-bold text-[#f0c89a]">
            {SEGMENT_LABEL[segment] || ruleName}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">
            ¿Conoces a alguien que también busque entradas?
          </p>
        </div>
        <button onClick={onDismiss} className="text-stone-500 hover:text-stone-200 transition text-lg leading-none shrink-0">×</button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {status === 'sent' ? (
          <div className="text-center py-2">
            <p className="text-emerald-400 font-semibold text-sm">✓ Invitación enviada</p>
            <p className="text-stone-400 text-[10px] mt-1">Tu amigo recibirá el enlace de acceso</p>
            <button onClick={onDismiss} className="mt-3 text-xs text-stone-400 hover:text-stone-200 transition">Cerrar</button>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-stone-300 mb-3">
              Comparte el acceso — recibirán un enlace directo al dashboard.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="email del invitado"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                className="flex-1 bg-[#0d0d0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-stone-100 placeholder-stone-600 focus:outline-none focus:border-[#7a4f2e]/80"
              />
              <button
                onClick={send}
                disabled={status === 'sending' || !email.includes('@')}
                className="bg-[#7a4f2e] hover:bg-[#9a6840] disabled:opacity-40 text-white text-xs font-bold px-3 py-2 rounded-lg transition shrink-0"
              >
                {status === 'sending' ? '…' : 'Invitar'}
              </button>
            </div>
            {status === 'error' && (
              <p className="text-red-400 text-[10px] mt-2">Error al enviar. Inténtalo de nuevo.</p>
            )}
            <button onClick={onDismiss} className="mt-3 text-[10px] text-stone-500 hover:text-stone-300 transition w-full text-center">
              Ahora no
            </button>
          </>
        )}
      </div>
    </div>
  );
}
