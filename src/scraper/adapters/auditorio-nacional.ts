export function parseAuditorioNacionalDate(dateText: string, hourText: string): string {
  const monthMap: { [key: string]: string } = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };

  // dateText format: "miércoles, 13 de mayo de 2026" or "13 de mayo de 2026" or empty
  // hourText format: "19:30"

  // If dateText is empty or only contains hour, try to use today's date
  if (!dateText || /^\d{1,2}:\d{2}$/.test(dateText.trim())) {
    dateText = hourText && /^\d+\s+de\s+\w+\s+de\s+\d{4}/.test(hourText) ? hourText : '';
    hourText = /^\d{1,2}:\d{2}$/.test(dateText.trim()) ? dateText : hourText;
  }

  const dayMonthYearMatch = dateText.match(/(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (!dayMonthYearMatch) {
    // Fallback: use today's date if no valid date found
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const [hour = '00', minute = '00'] = (hourText || '00:00').split(':');
    const isoString = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
    return new Date(isoString).toISOString();
  }

  const [, day, monthName, year] = dayMonthYearMatch;
  const month = monthMap[monthName.toLowerCase()];
  const [hour = '00', minute = '00'] = (hourText || '00:00').split(':');

  if (!month) {
    console.error('Unknown month:', monthName);
    return new Date().toISOString();
  }

  // Construct ISO format: YYYY-MM-DDTHH:MM:SS
  const isoString = `${year}-${month}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
  try {
    const date = new Date(isoString);
    return date.toISOString();
  } catch (e) {
    console.error('Error parsing constructed date:', isoString);
    return new Date().toISOString();
  }
}
