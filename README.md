# Databáze brigádníků

Jednoduchý přehled brigádníků připravený pro GitHub Pages.

## Funkce

- importovat celý XLSX sešit nebo CSV exportovaný z Google Sheets,
- nabídnout výběr měsíčního listu a načíst jeho sloupce `Jméno` a `Počet zapsaných hodin`,
- seskupit záznamy podle jména a sečíst odpracované hodiny,
- automaticky založit kartu každému člověku uvedenému v měsíčním rozpisu směn, i když zatím nemá zapsané hodiny,
- zobrazit karty brigádníků s fotografií,
- evidovat schopnosti a docházkovou morálku,
- přidávat palce nahoru a dolů s povinným důvodem, časem a autorem záznamu,
- otevřít kartu brigádníka a zobrazit detail včetně historie hodnocení,
- zobrazovat aktivní brigádníky z rozpisu a ignorovat historické osoby, které v aktuálním rozpisu nejsou,
- evidovat zaškolení pro Výdej, Prodej, Lego, Pokladny, Upsell, MV, LOG a PS,
- filtrovat karty podle jednoho nebo více oddělení v režimu „alespoň jedno“ nebo „všechna vybraná“,
- ukládat poznámky,
- hledat podle jména, e-mailu, interního ID i přezdívky (bez ohledu na diakritiku),
- rychle vyfiltrovat nováčky a lidi s nedokončeným nástupem,
- zobrazit v profilu odpracované hodiny za posledních 12 měsíců,
- exportovat zobrazené brigádníky i prodejní výkon do CSV pro Excel,
- filtrovat prodejní výkon podle brigádníka.

## Vývoj

Čistá logika (parsování rozpisu směn, CSV, výpočty ukazatelů) je v `logic.mjs` a je pokrytá testy:

```powershell
npm test
```

Při každém nasazení zvyšte číslo verze v `index.html` (`app.js?v=`, `styles.css?v=`, podpis `vNN`) a v importu `logic.mjs?v=` v `app.js`, aby prohlížeče nenačítaly starou verzi z mezipaměti. Test to hlídá.

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

Profily, docházka, hodnocení, poznámky a prodejní reporty se ukládají v Supabase. V `localStorage` zůstává pouze nastavení zobrazení, barevný režim a lokální informace o posledním načtení.

## Připravený databázový backend

Bezpečné schéma pro Supabase, RLS pravidla a auditní historii najdete ve složce `supabase/`. Po vytvoření Supabase projektu pokračujte podle `supabase/README.md`. Aplikace používá přihlášení e-mailem a heslem pro povolené účty a bez platného členství nezobrazí žádná osobní data.
