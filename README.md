# Databáze brigádníků

Jednoduchý přehled brigádníků připravený pro GitHub Pages.

## Co umí první verze

- importovat celý XLSX sešit nebo CSV exportovaný z Google Sheets,
- nabídnout výběr měsíčního listu a načíst jeho sloupce `Jméno` a `Počet zapsaných hodin`,
- seskupit záznamy podle jména a sečíst odpracované hodiny,
- zobrazit karty brigádníků s fotografií,
- evidovat schopnosti a docházkovou morálku,
- přidávat palce nahoru a dolů s povinným důvodem a časem záznamu,
- otevřít kartu brigádníka a zobrazit detail včetně historie hodnocení,
- zobrazovat pouze autoritativní seznam 27 aktivních brigádníků a ignorovat historické osoby z docházky,
- evidovat zaškolení pro Výdej, Prodej, Lego, Pokladny, Upsell, MV a LOG,
- filtrovat karty podle jednoho nebo více oddělení v režimu „alespoň jedno“ nebo „všechna vybraná“,
- ukládat poznámky,
- exportovat a importovat úplnou JSON zálohu.

## Formát docházky

U dodaného ročního XLSX sešitu aplikace sama najde měsíční listy se souhrnem `Jméno` a `Počet zapsaných hodin`. Po nahrání lze měsíc přepínat bez opakovaného nahrávání souboru.

U obecného CSV jsou povinné sloupce `Jméno` a `Hodiny`. Volitelně lze přidat `Datum`, `Email` a `Foto`. Aplikace rozpozná čárku i středník jako oddělovač a desetinnou čárku v hodinách.

Ukázka je v souboru `sample-attendance.csv`.

## Spuštění

Projekt nemá žádné závislosti. Pro lokální test lze otevřít `index.html` nebo spustit jednoduchý lokální server:

```powershell
python -m http.server 8000
```

Poté otevřete `http://localhost:8000`.

## Publikování přes GitHub Pages

V repozitáři otevřete **Settings → Pages**, jako zdroj vyberte **Deploy from a branch**, větev `main` a složku `/ (root)`.

## Důležitá poznámka k datům

Tato první verze ukládá profily a hodnocení do `localStorage` konkrétního prohlížeče. Pro sdílení mezi zařízeními použijte export/import zálohy. Pro skutečnou víceuživatelskou databázi bude potřeba připojit backend (například Supabase) a přihlášení uživatelů.

## Připravený databázový backend

Bezpečné schéma pro Supabase, RLS pravidla a auditní historii najdete ve složce `supabase/`. Po vytvoření Supabase projektu pokračujte podle `supabase/README.md`. Aplikace používá přihlášení pomocí odkazu zaslaného na povolený e-mail a bez platného členství nezobrazí žádná osobní data.
