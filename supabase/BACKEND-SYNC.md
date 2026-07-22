# Automatická synchronizace Google Sheets

Synchronizace běží v Supabase Edge Function. Tabulku pouze čte; neobsahuje žádné volání Google API, které by ji mohlo upravit.

## Jednorázové nasazení

1. V Supabase SQL Editoru spusťte celý soubor `2026-07-22-sheets-backend-sync.sql`.
2. Přihlaste Supabase CLI a propojte projekt:

   ```powershell
   npx supabase login
   npx supabase link --project-ref kgfszhhsrxsyccxywnpn
   ```

3. Vygenerujte dlouhý náhodný token a uložte jej jako secret funkce:

   ```powershell
   npx supabase secrets set SYNC_CRON_SECRET="SEM_VLOZTE_DLOUHY_NAHODNY_TOKEN"
   npx supabase functions deploy sync-google-sheets --no-verify-jwt
   ```

4. V SQL Editoru uložte stejný token do Vaultu a zapněte plán každých pět minut. Připravené příkazy jsou na konci souboru `2026-07-22-sheets-backend-sync.sql`.

## Ověření

- V Edge Functions otevřete `sync-google-sheets` a zkontrolujte poslední invocation.
- V Table Editoru otevřete `sheets_sync_runs`; poslední řádek má mít `status = success`.
- Na webu se čas poslední synchronizace načítá právě z této tabulky.

Ruční tlačítko na webu volá tutéž Edge Function. Pravidelný cron tedy funguje i tehdy, když nikdo nemá otevřený prohlížeč.
