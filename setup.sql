-- ─────────────────────────────────────────────────────────────
-- ICE COLD CUTZ — Supabase Database Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────

-- 1. Create bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  client_name  text        NOT NULL,
  client_phone text,
  service      text        NOT NULL,
  notes        text,
  booking_date date        NOT NULL,
  booking_time text        NOT NULL,
  status       text        DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','completed','cancelled'))
);

-- 2. Enable Row Level Security
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- 3. Anyone can INSERT a booking (customers booking online)
CREATE POLICY "Anyone can book"
  ON bookings FOR INSERT
  WITH CHECK (true);

-- 4. Anyone can SELECT bookings (needed to show taken slots + admin view)
CREATE POLICY "Anyone can read"
  ON bookings FOR SELECT
  USING (true);

-- 5. Anyone can UPDATE status (admin uses anon key to mark done/cancel)
CREATE POLICY "Anyone can update"
  ON bookings FOR UPDATE
  USING (true);
