# Nastavení Supabase

1. Na [supabase.com](https://supabase.com/) vytvořte nový projekt v evropském regionu.
2. V **SQL Editoru** otevřete nový dotaz, vložte obsah `schema.sql` a spusťte jej.
3. Spusťte obsah lokálního souboru `private-seed.sql`, který vloží aktivní brigádníky. Soubor je kvůli osobním údajům ignorovaný Gitem.
4. Ve stejném SQL Editoru přidejte svůj e-mail na seznam povolených vedoucích: `insert into public.app_members (email, display_name) values ('vas@email.cz', 'Vaše jméno');`
5. V **Authentication → Providers → Email** ponechte povolené e-mailové přihlášení.
6. V nastavení autentizace zakažte veřejné registrace. Další uživatele přidávejte do `app_members` a zvěte ručně.
7. V dialogu **Connect** zkopírujte Project URL a **Publishable key** (`sb_publishable_…`).
8. Doplňte obě veřejné hodnoty do `config.js`. V tomto repozitáři už jsou nakonfigurované.

Do webové aplikace nikdy nevkládejte Secret key ani starší `service_role` klíč. Tyto klíče obcházejí Row Level Security.

Schéma:

- neposkytuje anonymním návštěvníkům žádný přístup,
- dovoluje čtení a běžné změny pouze přihlášeným e-mailům uvedeným v `app_members`,
- nedovoluje upravovat ani mazat historické palce,
- eviduje autora importu a autora každého palce,
- zapisuje změny profilu do auditní tabulky.
