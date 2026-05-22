-- Migration 006: Add remaining theater sites
INSERT OR IGNORE INTO sites (name, base_url, slug) VALUES
  ('Teatro Real', 'https://tickets.teatroreal.es', 'teatro-real'),
  ('Teatro de la Zarzuela', 'https://teatrodelazarzuela.inaem.gob.es', 'teatro-zarzuela'),
  ('Auditorio Nacional', 'https://auditorionacional.inaem.gob.es', 'auditorio-nacional');
