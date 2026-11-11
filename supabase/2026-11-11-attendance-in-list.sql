-- Byl brigádník v seznamu „Jméno“ daného měsíčního listu (= tým toho měsíce).
-- Spuštěno 11. 11. 2026, aplikace v104 a novější podle něj ukazuje historii týmu.
alter table public.attendance_totals add column if not exists in_list boolean not null default false;
