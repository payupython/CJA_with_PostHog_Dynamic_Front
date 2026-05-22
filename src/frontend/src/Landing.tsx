import { useState } from 'react';
import { Mail, Music } from 'lucide-react';
import { usePostHog } from '@posthog/react';

interface LandingProps {
  onSuccess?: () => void; // kept for flexibility
}

const VENUES = [
  'Auditorio Nacional',
  'Teatro Real',
  'Teatro de la Zarzuela',
  'Teatro del Canal',
];

export function Landing({ onSuccess }: LandingProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const posthog = usePostHog();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/landing/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Error (${response.status})`);
      }

      const subscribedEmail = email.trim().toLowerCase();
      posthog?.identify(subscribedEmail, { email: subscribedEmail });
      posthog?.capture('newsletter_subscribed', { email: subscribedEmail });

      setSuccess(true);
      setEmail('');
      onSuccess?.();
      // Don't auto-hide success — user needs to go check their email
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
        posthog?.capture('newsletter_subscription_failed', {
          email: email.trim().toLowerCase(),
          error: 'network_error',
        });
      } else {
        const message = err instanceof Error ? err.message : 'Error subscribing';
        setError(message);
        posthog?.capture('newsletter_subscription_failed', {
          email: email.trim().toLowerCase(),
          error: message,
        });
        if (err instanceof Error) posthog?.captureException(err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full min-h-[100dvh] overflow-hidden">
      {/* Video background */}
      <div className="fixed inset-0">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover scale-105 blur-sm"
        >
          <source src="/background.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/55" />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-[100dvh] flex flex-col items-center justify-center px-4 py-6">

        {/* Hero — compacto */}
        <div className="text-center mb-4 sm:mb-6 max-w-sm sm:max-w-lg">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Music className="w-5 h-5 text-amber-300 drop-shadow-lg" />
            <span className="text-xs text-amber-300/80 uppercase tracking-widest font-semibold">Madrid · Música clásica</span>
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white mb-2 leading-tight tracking-tight">
            No te pierdas{' '}
            <span className="text-amber-300">ningún concierto</span>
          </h1>

          <p className="text-sm text-white/65 leading-relaxed">
            Escaneamos cada semana la disponibilidad en{' '}
            <span className="text-white/85">{VENUES.join(', ')}</span>
            {' '}y te avisamos.
          </p>
        </div>

        {/* Email form — protagonista */}
        <div className="w-full max-w-xs sm:max-w-sm">
          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 sm:p-6 shadow-2xl">

            <div className="mb-4 text-center">
              <h2 className="text-base font-bold text-white">Accede a los próximos eventos</h2>
              <p className="text-white/50 text-[11px] mt-0.5">
                Introduce tu email — te enviamos el enlace de acceso.
              </p>
            </div>

            {success ? (
              <div className="bg-green-500/20 border border-green-400/40 rounded-xl p-4 text-green-100 text-center space-y-2">
                <p className="text-sm font-semibold">✓ Revisa tu email</p>
                <p className="text-green-200/60 text-[11px]">
                  Te hemos enviado el enlace de acceso.
                </p>
                <button
                  onClick={() => setSuccess(false)}
                  className="text-green-200/60 text-[11px] underline hover:text-green-100 transition"
                >
                  Usar otro email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-2.5">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-300/80" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    className="w-full pl-9 pr-3 py-2.5 bg-white/15 border border-white/25 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-300/70 focus:border-transparent text-sm"
                  />
                </div>

                {error && (
                  <p className="text-red-300 text-xs text-center">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-60 text-white font-bold rounded-xl transition duration-150 text-sm tracking-wide"
                >
                  {loading ? 'Enviando…' : 'Recibir enlace de acceso'}
                </button>
              </form>
            )}
          </div>

          <p className="text-white/35 text-[10px] text-center mt-2.5 px-2">
            Sin spam · Solo avisos de nuevos escaneos
          </p>
        </div>

        {/* Géneros — pie discreto */}
        <p className="mt-5 text-white/30 text-[10px] italic tracking-wide">
          Ópera · Sinfónica · Zarzuela · Cámara · Ballet
        </p>
      </div>
    </div>
  );
}
