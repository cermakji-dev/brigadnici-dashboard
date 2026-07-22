# Aktualizace databáze

1. V Supabase otevřete SQL Editor.
2. Spusťte celý soubor `2026-07-22-hardening.sql`.
3. Na konci změňte ukázkový e-mail a spusťte `update public.app_members set role = 'admin' ...` pro účet správce.

Migrace doplní samostatné nástupní úkoly, konsolidovanou tabulku prodejních dnů a správcovské operace pro přidání/odebrání brigádníka.

Google Sheets zůstává pouze zdrojem veřejného XLSX exportu ke čtení. Tato migrace ani aplikace do Google Sheets nic nezapisují.
