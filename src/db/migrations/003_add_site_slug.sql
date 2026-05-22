-- Migration 003: Add slug to sites
ALTER TABLE sites ADD COLUMN slug TEXT;

UPDATE sites SET slug = 'teatro-real' WHERE name = 'Teatro Real';
