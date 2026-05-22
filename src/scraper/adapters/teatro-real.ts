import { SelectorConfig } from '../types.js';

export const TEATRO_REAL_SELECTORS: SelectorConfig = {
  container: 'li.performance',
  title: 'a.title',
  date: 'li.performance > div > div:first-child p',
  status: {
    available: 'a[id^="book"]',
    sold_out: 'li.performance.soldout',
    limited: 'li.performance.limited',
  },
  statusText: {
    available: ['ELIGE LOS ASIENTOS', 'COMPRAR', 'Comprar'],
    sold_out: ['ENTRADAS AGOTADAS', 'Agotado'],
    limited: ['ÚLTIMAS ENTRADAS', 'Disponibilidad limitada', 'Limited availability']
  }
};

export function parseTeatroRealDate(dateText: string): string {
  const months: Record<string, number> = {
    'ene': 0, 'enero': 0, 'feb': 1, 'febrero': 1, 'mar': 2, 'marzo': 2,
    'abr': 3, 'abril': 3, 'may': 4, 'mayo': 4, 'jun': 5, 'junio': 5,
    'jul': 6, 'julio': 6, 'ago': 7, 'agosto': 7, 'sep': 8, 'septiembre': 8,
    'oct': 9, 'octubre': 9, 'nov': 10, 'noviembre': 10, 'dic': 11, 'diciembre': 11,
    'jan': 0, 'january': 0, 'february': 1, 'march': 2, 'apr': 3, 'april': 3,
    'aug': 7, 'august': 7, 'dec': 11, 'december': 11
  };
  
  const cleanText = dateText.toLowerCase().replace(/,/g, '').trim();
  const parts = cleanText.split(/\s+/);
  
  let day: number | null = null;
  let month: number | null = null;
  let year: number = new Date().getFullYear();
  let hour: number = 19;
  let minute: number = 0;

  for (const part of parts) {
    if (months[part] !== undefined) {
      month = months[part];
    } else if (part.includes(':')) {
      const [h, m] = part.split(':').map(Number);
      if (!isNaN(h)) hour = h;
      if (!isNaN(m)) minute = m;
    } else if (part.length === 4 && !isNaN(Number(part))) {
      year = Number(part);
    } else if (!isNaN(Number(part)) && day === null) {
      day = Number(part);
    }
  }

  if (day === null || month === null) {
    return new Date().toISOString();
  }

  const date = new Date(year, month, day, hour, minute);
  if (date < new Date() && parts.every(p => p.length !== 4)) {
    date.setFullYear(year + 1);
  }

  return date.toISOString();
}

