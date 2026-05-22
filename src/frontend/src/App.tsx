import { useEffect, useState, useMemo } from 'react';
import {
  Music, Search, MapPin, Calendar, Ticket, X, ExternalLink,
  Clock, Building2, Sparkles, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Menu
} from 'lucide-react';
import { Landing } from './Landing';
import { usePostHog } from '@posthog/react';
import { ingest } from './ingest';
import { InviteNotification } from './InviteNotification';

interface Event {
  id: number;
  title: string;
  url: string;
  status: 'available' | 'sold_out' | 'limited' | 'unknown' | 'cancelled' | 'closed';
  event_date: string;
  site_name: string;
}

const SITE_INFO: Record<string, { address: string; image: string }> = {
  'Auditorio Nacional': {
    address: 'C/ Príncipe de Vergara 146, Madrid',
    image: '/sites/auditorio-nacional.jpg',
  },
  'Teatro Real': {
    address: 'Plaza de Isabel II, Madrid',
    image: '/sites/teatro-real.jpg',
  },
  'Teatro de la Zarzuela': {
    address: 'C/ Jovellanos 4, Madrid',
    image: '/sites/teatro-zarzuela.jpg',
  },
  'Teatro del Canal': {
    address: 'C/ Cea Bermúdez 1, Madrid',
    image: '/sites/teatro-canal.jpg',
  },
};

const ALL_VIEW_IMAGE = '/sites/violin.jpg';

// Earthy chocolate palette: olive, rust, mustard, cocoa, sand
const STATUS_CFG: Record<string, { label: string; badgeDark: string; sidebarText: string }> = {
  available:  { label: 'Disponible',     badgeDark: 'bg-[#3d4a2a]/40 text-[#c8d49a] ring-1 ring-[#5a6b3d]/40',  sidebarText: 'text-[#c8d49a]' },
  sold_out:   { label: 'Agotado',        badgeDark: 'bg-[#5a2a20]/40 text-[#d4a08c] ring-1 ring-[#7a3a2a]/40',  sidebarText: 'text-[#d4a08c]' },
  limited:    { label: 'Últimas plazas', badgeDark: 'bg-[#6b4a18]/40 text-[#e0bc70] ring-1 ring-[#8a6320]/40',  sidebarText: 'text-[#e0bc70]' },
  cancelled:  { label: 'Cancelado',      badgeDark: 'bg-[#3a2e23]/40 text-[#a89380] ring-1 ring-[#5a4938]/40',  sidebarText: 'text-[#a89380]' },
  unknown:    { label: 'Disponible',     badgeDark: 'bg-[#3d4a2a]/40 text-[#c8d49a] ring-1 ring-[#5a6b3d]/40',  sidebarText: 'text-[#c8d49a]' },
  closed:     { label: 'Cerrado',        badgeDark: 'bg-[#4a4a4a]/40 text-[#c0c0c0] ring-1 ring-[#6a6a6a]/40',  sidebarText: 'text-[#c0c0c0]' },
};

const API_URL = import.meta.env.VITE_API_URL || '';

function App() {
  const posthog = usePostHog();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<'site_name' | 'title' | 'event_date' | 'time' | 'status'>('event_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  // Collapse sidebar by default on mobile
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' ? !window.matchMedia('(max-width: 768px)').matches : true
  );
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showHighIntentBanner, setShowHighIntentBanner] = useState(false);
  const [inviteNotif, setInviteNotif] = useState<{ ruleName: string; segment: string } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const storedToken = localStorage.getItem('access_token');
    const token = urlToken || storedToken;

    if (token) {
      // Basic client-side format check before hitting the API
      if (token.length !== 64 || !/^[0-9a-f]+$/.test(token)) {
        localStorage.removeItem('access_token');
        if (urlToken) {
          params.delete('token');
          const newUrl = params.toString() ? `?${params}` : window.location.pathname;
          window.history.replaceState({}, '', newUrl);
        }
        setAuthChecking(false);
        return;
      }

      fetch(`${API_URL}/api/auth/validate?token=${token}`)
        .then(r => r.json())
        .then(data => {
          if (data.valid) {
            localStorage.setItem('access_token', token);
            setAuthToken(token);
            if (data.email) {
              posthog?.identify(data.email, { email: data.email });
              setUserEmail(data.email);
            }
            posthog?.capture('auth_validated', { token_source: urlToken ? 'url' : 'storage' });
            if (data.email) ingest(data.email, 'auth_validated');
            if (urlToken) {
              params.delete('token');
              const newUrl = params.toString() ? `?${params}` : window.location.pathname;
              window.history.replaceState({}, '', newUrl);
            }
          } else {
            localStorage.removeItem('access_token');
            // Also clean token from URL if it was invalid/expired
            if (urlToken) {
              params.delete('token');
              const newUrl = params.toString() ? `?${params}` : window.location.pathname;
              window.history.replaceState({}, '', newUrl);
            }
          }
        })
        .catch(() => {
          // Network error: keep stored token (might be a transient failure)
          // but don't set authToken so dashboard won't render with a broken API
          localStorage.removeItem('access_token');
        })
        .finally(() => setAuthChecking(false));
    } else {
      setAuthChecking(false);
    }
  }, []);

  // fetchEvents as a stable callback that reads authToken from state
  useEffect(() => {
    if (!authToken) return;

    let cancelled = false;

    const fetchEvents = async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API_URL}/api/events`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (r.status === 401) {
          localStorage.removeItem('access_token');
          setAuthToken(null);
          return;
        }
        if (!r.ok) {
          console.error(`[API] Events fetch failed: ${r.status}`);
          return;
        }
        const d = await r.json();
        if (!cancelled) {
          setEvents(Array.isArray(d) ? d : []);
        }
      } catch (e) {
        console.error('[API] Events fetch error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchEvents();

    // Auto-refresh events every 5 minutes while dashboard is open
    const interval = setInterval(fetchEvents, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authToken]);

  // SSE — detectar high_intent del usuario actual → mostrar banner
  useEffect(() => {
    if (!userEmail) return;
    const es = new EventSource(`${API_URL}/api/sse/dashboard`);
    es.addEventListener('segment_change', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.userId !== userEmail) return;
        if (data.segment === 'high_intent') {
          setShowHighIntentBanner(true);
        }
        // Mostrar notificación de invitación para cualquier regla
        setInviteNotif({ ruleName: data.rule || data.segment, segment: data.segment });
      } catch {}
    });
    return () => es.close();
  }, [userEmail]);

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mobile sidebar: close on Escape key, window resize, or site selection
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    const handleResize = () => {
      if (window.innerWidth >= 768) setSidebarOpen(true);
    };
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const futureEvents = useMemo(() => {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    return events
      .filter(e => new Date(e.event_date).getTime() >= todayMs)
      .map(e => {
        const eventTime = new Date(e.event_date);
        const isClosed = eventTime.getTime() < now.getTime() && eventTime.getTime() >= todayMs;
        return isClosed ? { ...e, status: 'closed' as const } : e;
      });
  }, [events]);

  const siteStats = useMemo(() => {
    const s: Record<string, number> = {};
    futureEvents.forEach(e => { s[e.site_name] = (s[e.site_name] || 0) + 1; });
    return s;
  }, [futureEvents]);

  const statusStats = useMemo(() => {
    const s: Record<string, number> = { available: 0, sold_out: 0, limited: 0, cancelled: 0, unknown: 0, closed: 0 };
    futureEvents.forEach(e => { if (s[e.status] !== undefined) s[e.status]++; });
    return s;
  }, [futureEvents]);

  const buildHaystack = (e: Event): string => {
    const d = new Date(e.event_date);
    const parts: string[] = [
      e.title,
      e.site_name,
      d.toLocaleDateString('es-ES', { weekday: 'long' }),
      d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''),
      d.toLocaleDateString('es-ES', { month: 'long' }),
      d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''),
      String(d.getDate()),
      String(d.getDate()).padStart(2, '0'),
      String(d.getFullYear()),
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`,
      d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', ''),
      d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
    ];
    return parts.join(' ').toLowerCase();
  };

  const filteredEvents = useMemo(() => {
    const tokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const filtered = futureEvents.filter(e => {
      const matchSite = !selectedSite || e.site_name === selectedSite;
      let matchStatus = !selectedStatus || e.status === selectedStatus;
      // When filtering 'available', also include 'unknown' (both show as Disponible)
      if (selectedStatus === 'available' && e.status === 'unknown') matchStatus = true;
      const matchDay = selectedDays.size === 0 || selectedDays.has(new Date(e.event_date).getDay());
      if (!matchSite || !matchStatus || !matchDay) return false;
      if (tokens.length === 0) return true;
      const hay = buildHaystack(e);
      return tokens.every(t => hay.includes(t));
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    const parseMs = (s: string): number => {
      const t = new Date(s).getTime();
      return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
    };
    return filtered.sort((a, b) => {
      const aMs = parseMs(a.event_date);
      const bMs = parseMs(b.event_date);
      let cmp = 0;
      switch (sortKey) {
        case 'site_name': cmp = a.site_name.localeCompare(b.site_name, 'es'); break;
        case 'title':     cmp = a.title.localeCompare(b.title, 'es'); break;
        case 'event_date': cmp = aMs - bMs; break;
        case 'time': {
          const ad = new Date(aMs);
          const bd = new Date(bMs);
          cmp = (ad.getHours() * 60 + ad.getMinutes()) - (bd.getHours() * 60 + bd.getMinutes());
          break;
        }
        case 'status':    cmp = a.status.localeCompare(b.status); break;
      }
      // Tie-break: always fall back to event_date asc so rows are deterministic
      if (cmp === 0) cmp = aMs - bMs;
      return cmp * dir;
    });
  }, [futureEvents, searchQuery, selectedSite, selectedStatus, selectedDays, sortKey, sortDir]);

  const requestSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleDay = (jsDay: number) => {
    setSelectedDays(prev => {
      const next = new Set(prev);
      next.has(jsDay) ? next.delete(jsDay) : next.add(jsDay);
      return next;
    });
  };

  const dateRange = useMemo(() => {
    if (filteredEvents.length === 0) return null;
    const dates = filteredEvents.map(e => new Date(e.event_date)).sort((a, b) => a.getTime() - b.getTime());
    const fmt = (d: Date) => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
    return `${fmt(dates[0])} — ${fmt(dates[dates.length - 1])}`;
  }, [filteredEvents]);

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedSite(null);
    setSelectedStatus(null);
    setSelectedDays(new Set());
  };

  const allSites = Object.keys(siteStats).sort();
  const hasFilters = searchQuery || selectedSite || selectedStatus || selectedDays.size > 0;

  // Carousel slides: "Todos los sitios" + each site
  const slides = useMemo(() => {
    return [
      { name: 'Todos los sitios', site: null as string | null, address: 'Madrid · Todos los teatros', image: ALL_VIEW_IMAGE },
      ...allSites.map(name => ({
        name,
        site: name as string | null,
        address: SITE_INFO[name]?.address || 'Madrid',
        image: SITE_INFO[name]?.image || ALL_VIEW_IMAGE,
      })),
    ];
  }, [allSites]);

  // When a site is selected, lock carousel to that site
  useEffect(() => {
    if (selectedSite) {
      const idx = slides.findIndex(s => s.site === selectedSite);
      if (idx >= 0) setCarouselIdx(idx);
    }
  }, [selectedSite, slides]);

  // Auto-advance carousel only when no site is selected (purely visual)
  useEffect(() => {
    if (paused || slides.length <= 1 || selectedSite) return;
    const t = setInterval(() => {
      setCarouselIdx(i => (i + 1) % slides.length);
    }, 6000);
    return () => clearInterval(t);
  }, [paused, slides, selectedSite]);

  // Manual nav: only change image, do NOT change filter
  const goCarousel = (idx: number) => {
    if (!slides[idx]) return;
    setCarouselIdx(idx);
  };

  const currentSlide = slides[carouselIdx] || slides[0];
  // Hero title: show site name when carousel is on a specific site, empty when on "Todos los sitios"
  const heroTitle = selectedSite || (currentSlide?.site !== null ? currentSlide?.name : '');
  const heroInfo = selectedSite
    ? { address: SITE_INFO[selectedSite]?.address || 'Madrid', image: SITE_INFO[selectedSite]?.image || ALL_VIEW_IMAGE }
    : { address: currentSlide?.address || 'Madrid · Todos los teatros', image: currentSlide?.image || ALL_VIEW_IMAGE };

  if (authChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#15110b] text-stone-400">
        <p>Verificando acceso...</p>
      </div>
    );
  }

  if (!authToken) {
    return <Landing />;
  }

  return (
    <div className="flex h-screen overflow-x-hidden bg-[#15110b] text-stone-200" style={{ backgroundImage: 'radial-gradient(1200px 600px at 70% -10%, rgba(154,104,64,0.10), transparent 50%), radial-gradient(900px 500px at 0% 100%, rgba(122,79,46,0.07), transparent 50%)' }}>
      {/* Invite notification — aparece cuando se activa cualquier regla */}
      {inviteNotif && userEmail && (
        <InviteNotification
          ruleName={inviteNotif.ruleName}
          segment={inviteNotif.segment}
          fromEmail={userEmail}
          onDismiss={() => setInviteNotif(null)}
        />
      )}

      {/* High intent banner */}
      {showHighIntentBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
          <div className="max-w-2xl mx-auto bg-[#7a4f2e] border border-[#9a6840] rounded-xl shadow-2xl p-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="text-white font-bold text-sm">¿Buscas entradas activamente?</p>
              <p className="text-[#f0c89a] text-xs mt-0.5">Te avisamos por email cuando haya disponibilidad en los teatros que visitaste.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-[#f0c89a] font-medium">✓ Ya tienes alertas activas en {userEmail}</span>
              <button
                onClick={() => setShowHighIntentBanner(false)}
                className="text-[#f0c89a] hover:text-white transition text-lg leading-none"
                aria-label="Cerrar"
              >×</button>
            </div>
          </div>
        </div>
      )}
      {/* Mobile overlay when sidebar open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside className={`w-64 bg-[#100c08] text-stone-100 flex flex-col border-r border-white/5 shrink-0 fixed md:static inset-y-0 left-0 z-50 transition-transform md:transition-none ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}>
        {/* Logo */}
        <div className="px-5 py-5 flex items-center gap-3 border-b border-stone-800">
          <div className="w-10 h-10 rounded-xl bg-[#7a4f2e] flex items-center justify-center">
            <Sparkles size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-bold text-base">Avisador</div>
            <div className="text-[11px] text-stone-400">Entradas en vivo</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* SITIOS */}
          <div className="px-3 pt-5 pb-2">
            <div className="px-2 text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-2">SITIOS</div>
            <button
              onClick={() => { setSelectedSite(null); setSidebarOpen(false); }}
              className={`w-full flex items-center justify-between px-2 py-2 rounded-md text-sm transition ${
                !selectedSite ? 'bg-[#7a4f2e]/25 text-[#d4a878] ring-1 ring-[#7a4f2e]/40' : 'text-stone-300 hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Music size={14} />
                <span>Todos los sitios</span>
              </span>
              <span className="text-xs text-stone-400">{futureEvents.length}</span>
            </button>
            {allSites.map(site => (
              <button
                key={site}
                onClick={() => { const next = site === selectedSite ? null : site; posthog?.capture('site_filter_selected', { site: next }); if (next && userEmail) ingest(userEmail, 'site_filter_selected', { site: next }); setSelectedSite(next); setSidebarOpen(false); }}
                className={`w-full flex items-center justify-between px-2 py-2 rounded-md text-sm transition mt-0.5 ${
                  selectedSite === site ? 'bg-[#7a4f2e]/25 text-[#d4a878] ring-1 ring-[#7a4f2e]/40' : 'text-stone-300 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Building2 size={14} />
                  <span className="truncate">{site}</span>
                </span>
                <span className="text-xs text-stone-400">{siteStats[site]}</span>
              </button>
            ))}
          </div>

          {/* ESTADO */}
          <div className="px-3 pt-5 pb-2">
            <div className="px-2 text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-2">ESTADO</div>
            {(['available', 'sold_out', 'limited', 'cancelled', 'closed'] as const).map(s => {
              let count = statusStats[s] || 0;
              if (s === 'available') count += statusStats.unknown || 0;
              const cfg = STATUS_CFG[s];
              return (
                <button
                  key={s}
                  onClick={() => { setSelectedStatus(s === selectedStatus ? null : s); setSidebarOpen(false); }}
                  className={`w-full flex items-center justify-between px-2 py-2 rounded-md text-sm transition mt-0.5 ${
                    selectedStatus === s ? 'bg-[#7a4f2e]/25 text-[#d4a878] ring-1 ring-[#7a4f2e]/40' : 'text-stone-300 hover:bg-white/5'
                  }`}
                >
                  <span className={`text-sm font-medium ${cfg.sidebarText}`}>{cfg.label}</span>
                  <span className="text-xs text-stone-400">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile menu toggle (hidden on desktop) */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden absolute top-4 left-4 z-40 p-2 bg-[#7a4f2e] hover:bg-[#9a6840] text-white rounded-lg transition"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>

        {/* HERO BANNER (carousel) */}
        <div
          className="relative h-76 sm:h-48 md:h-72 shrink-0 overflow-hidden"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* carousel slides — fade transition */}
          {slides.map((slide, idx) => (
            <div
              key={idx}
              className={`absolute inset-0 bg-cover bg-center transition-opacity duration-700 ${
                idx === carouselIdx ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ backgroundImage: `url(${slide.image})` }}
            />
          ))}
          <div className="absolute inset-0 bg-gradient-to-b from-[#15110b]/60 via-[#15110b]/75 to-[#15110b]/95"></div>

          {/* arrow nav */}
          <button
            onClick={() => goCarousel((carouselIdx - 1 + slides.length) % slides.length)}
            className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white transition"
            aria-label="Anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => goCarousel((carouselIdx + 1) % slides.length)}
            className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white transition"
            aria-label="Siguiente"
          >
            <ChevronRight size={18} />
          </button>

          {/* dots */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => goCarousel(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === carouselIdx ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/60'
                }`}
                aria-label={`Slide ${idx + 1}`}
              />
            ))}
          </div>

          <div className="relative h-full flex flex-col px-4 py-3 sm:px-6 sm:py-4 md:px-8 md:py-5">
            {/* Top metadata row */}
            <div className="flex flex-col md:flex-row items-center md:items-start justify-center md:justify-between gap-2 md:gap-0 text-white text-xs">
              {heroInfo && (
                <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full">
                  <MapPin size={12} />
                  <span>{heroInfo.address}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                {dateRange && (
                  <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full">
                    <Calendar size={12} />
                    <span>{dateRange}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full">
                  <Ticket size={12} />
                  <span className="font-bold">{filteredEvents.length}</span>
                </div>
              </div>
            </div>

            {/* Title */}
            <h1 className="text-white text-3xl font-bold mt-4 mb-4">{heroTitle}</h1>

            {/* Search pill */}
            <div className="flex items-center bg-white rounded-full shadow-lg overflow-hidden pr-1 w-full md:w-96 mx-auto px-4 md:px-0">
              <div className="flex-1 flex items-center gap-2 pl-3 pr-2 py-2 md:pl-4">
                <Search size={14} className="text-stone-400 shrink-0" />
                <input
                  id="search-input"
                  type="text"
                  placeholder="Buscar evento, fecha..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-stone-700 placeholder-stone-400 text-sm focus:outline-none min-w-0"
                />
              </div>
              <button className="flex items-center gap-1.5 bg-[#7a4f2e] hover:bg-[#9a6840] text-white px-2 py-1 md:px-3 md:py-1.5 rounded-full text-xs font-semibold transition shrink-0">
                <Search size={12} />
                <span className="hidden sm:inline">Buscar</span>
              </button>
            </div>

            {/* Day-of-week filter */}
            <div className="flex justify-center mt-3">
              <div className="flex overflow-x-auto sm:flex-nowrap items-center gap-1 bg-white rounded-lg p-1 shadow-lg ring-1 ring-white/10 scroll-smooth snap-x snap-mandatory">
                {[
                  { label: 'L', jsDay: 1 },
                  { label: 'M', jsDay: 2 },
                  { label: 'X', jsDay: 3 },
                  { label: 'J', jsDay: 4 },
                  { label: 'V', jsDay: 5 },
                  { label: 'S', jsDay: 6 },
                  { label: 'D', jsDay: 0 },
                ].map(({ label, jsDay }) => {
                  const active = selectedDays.has(jsDay);
                  return (
                    <button
                      key={jsDay}
                      onClick={() => toggleDay(jsDay)}
                      className={`w-6 h-6 sm:w-7 sm:h-7 rounded-md text-[10px] sm:text-[11px] font-black transition-all duration-200 active:scale-90 snap-center shrink-0 ${
                        active
                          ? 'bg-[#7a4f2e] text-white scale-110 shadow-md'
                          : 'bg-white text-stone-900 hover:bg-stone-100'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Helpers row */}
            <div className="flex items-center justify-between mt-3 text-xs">
              <div className="flex items-center gap-3">
                {hasFilters && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 text-stone-300 hover:text-white transition bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded-full"
                  >
                    <X size={12} />
                    Limpiar filtros
                  </button>
                )}
                <kbd className="text-stone-300 bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded font-mono text-[10px]">⌘K</kbd>
              </div>
              <div className="text-stone-200 font-medium">
                {filteredEvents.length} de {futureEvents.length} eventos
              </div>
            </div>
          </div>
        </div>

        {/* TABLE + CARDS */}
        <div className="flex-1 overflow-auto bg-[#15110b]">
          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center h-full text-stone-400 text-sm">Cargando eventos…</div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex items-center justify-center h-full text-stone-400 text-sm">Sin resultados</div>
          ) : (
            <>
            {/* Desktop table */}
            <table className="hidden md:table w-full">
              <thead className="bg-[#1a1410] border-b border-white/10 sticky top-0">
                <tr>
                  {([
                    { key: 'site_name', label: 'SITIO', align: 'left' },
                    { key: 'title', label: 'EVENTO', align: 'left' },
                    { key: 'event_date', label: 'FECHA', align: 'left' },
                    { key: 'time', label: 'HORA', align: 'left' },
                    { key: 'status', label: 'ESTADO', align: 'left' },
                  ] as { key: typeof sortKey; label: string; align: string }[]).map(col => {
                    const isActive = sortKey === col.key;
                    const Icon = isActive ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                    return (
                      <th
                        key={col.key}
                        onClick={() => requestSort(col.key)}
                        className={`px-4 py-2 md:px-6 md:py-3 text-${col.align} text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none transition group ${
                          isActive ? 'text-[#d4a878]' : 'text-stone-400 hover:text-stone-100'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {col.label}
                          <Icon size={11} className={isActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-80'} />
                        </div>
                      </th>
                    );
                  })}
                  <th className="px-4 py-2 md:px-6 md:py-3 text-right text-[11px] font-bold text-stone-400 uppercase tracking-wider">ENLACE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredEvents.map(event => {
                  const d = new Date(event.event_date);
                  const day = d.toLocaleDateString('es-ES', { weekday: 'short' });
                  const dayStr = day.charAt(0).toUpperCase() + day.slice(1, 3);
                  const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
                  const timeStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                  const cfg = STATUS_CFG[event.status];

                  return (
                    <tr key={event.id} className="hover:bg-white/[0.03] transition">
                      <td className="px-4 py-2 md:px-6 md:py-3">
                        <div className="flex items-center gap-2 text-sm text-stone-300">
                          <Calendar size={14} className="text-stone-500" />
                          <span className="font-medium">{event.site_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm text-stone-100 font-semibold max-w-md">
                        {event.title}
                      </td>
                      <td className="px-6 py-3 text-sm">
                        <div className="flex items-center gap-3">
                          <span className="text-stone-200">{dateStr}</span>
                          <span className="text-stone-500 text-xs">{dayStr}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm">
                        <div className="flex items-center gap-1.5 text-stone-200 font-mono">
                          <Clock size={13} className="text-stone-500" />
                          {timeStr}
                        </div>
                      </td>
                      <td className="px-4 py-2 md:px-6 md:py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${cfg.badgeDark}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {event.url && !['closed', 'cancelled'].includes(event.status) ? (
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2 py-1 md:px-3 md:py-1.5 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 text-stone-100 text-xs font-semibold rounded-md transition"
                            onClick={() => { posthog?.capture('ticket_link_clicked', { event_id: event.id, event_title: event.title, site: event.site_name, status: event.status }); if (userEmail) ingest(userEmail, 'ticket_link_clicked', { site: event.site_name }); }}
                          >
                            Tickets
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <button
                            disabled
                            className="inline-flex items-center gap-1.5 px-2 py-1 md:px-3 md:py-1.5 bg-white/5 border border-white/10 text-stone-500 text-xs font-semibold rounded-md opacity-50 cursor-not-allowed line-through"
                          >
                            Tickets
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Mobile cards */}
            <div className="md:hidden space-y-3 p-4">
              {filteredEvents.map(event => {
                const d = new Date(event.event_date);
                const day = d.toLocaleDateString('es-ES', { weekday: 'short' });
                const dayStr = day.charAt(0).toUpperCase() + day.slice(1, 3);
                const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
                const timeStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                const cfg = STATUS_CFG[event.status];
                return (
                  <div key={event.id} className="p-4 border border-white/10 rounded-lg bg-[#1a1410]">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white line-clamp-2">{event.title}</p>
                        <p className="text-xs text-stone-400">{event.site_name}</p>
                      </div>
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold shrink-0 ${cfg.badgeDark}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-stone-300">
                      <div className="flex items-center gap-3">
                        <span>{dateStr}</span>
                        <span className="text-stone-500">{dayStr}</span>
                        <span className="flex items-center gap-1 font-mono">
                          <Clock size={11} className="text-stone-500" />
                          {timeStr}
                        </span>
                      </div>
                      {event.url && !['closed', 'cancelled'].includes(event.status) ? (
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 text-stone-100 text-xs font-semibold rounded transition shrink-0"
                          onClick={() => { posthog?.capture('ticket_link_clicked', { event_id: event.id, event_title: event.title, site: event.site_name, status: event.status }); if (userEmail) ingest(userEmail, 'ticket_link_clicked', { site: event.site_name }); }}
                        >
                          Tickets
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <button
                          disabled
                          className="inline-flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 text-stone-500 text-xs font-semibold rounded opacity-50 cursor-not-allowed shrink-0 line-through"
                        >
                          Tickets
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
