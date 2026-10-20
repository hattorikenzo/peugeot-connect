# Peugeot Connect — MVP 0.1

Web app indipendente e di **sola lettura** per Geotab GO9B, con GitHub Pages + Supabase Auth + Supabase Edge Function.

## Struttura

```text
site/
  index.html                  Interfaccia responsive
  assets/app.js               Login, dashboard, chiamate sicure
  assets/style.css            Stile
  manifest.webmanifest        PWA di base
  config.example.js           Modello configurazione pubblica
  .nojekyll
supabase/
  config.toml                 Impostazioni Edge Function
  functions/peugeot-api/
    index.ts                  Proxy server Geotab con controllo accessi
.env.example                  Nomi dei segreti, senza valori reali
.gitignore
```

## 1. Supabase: preparazione

1. Crea un progetto Supabase o usa un progetto con Edge Functions disponibili e spazio adeguato.
2. In **Authentication > Users**, crea il tuo utente personale e recupera il suo **UUID**. Per uso personale, disabilita le iscrizioni pubbliche in Authentication (Sign Ups). Verifica che l'utente sia confermato e abbia una password.
3. In **Project Settings > API Keys** copia **Project URL** e **publishable key** (o legacy anon key). Non usare la secret/service_role key nel browser.
4. Installa la Supabase CLI, esegui `supabase login` e `supabase link --project-ref TUO_PROJECT_REF` dalla cartella radice del progetto.
5. Configura i segreti della funzione con `supabase secrets set GEOTAB_DATABASE=... GEOTAB_USERNAME=... GEOTAB_PASSWORD=... GEOTAB_DEVICE_ID=b1 ALLOWED_USER_ID=UUID`. Preferisci un utente Geotab dedicato, con permessi minimi in sola lettura. Non inserire password in file Git.
6. Pubblica con `supabase functions deploy peugeot-api`. Il file `supabase/config.toml` imposta `verify_jwt=false` perché l'autenticazione viene effettuata **dentro la funzione** tramite `withSupabase({auth:'user'})`, compatibile con chiavi publishable moderne. Non rimuovere questo controllo.

## 2. GitHub Pages

1. Copia `site/config.example.js` in `site/config.js` e inserisci URL Supabase e chiave **pubblica**. `site/config.js` è escluso da Git per evitare pubblicazioni accidentali; per pubblicare GitHub Pages devi includere una copia del file **solo con URL e chiave publishable/anon** nella cartella effettivamente distribuita (es. mediante un workflow che genera `config.js` da GitHub Variables). URL e publishable key sono dati pubblici, non segreti.
2. Pubblica il contenuto della cartella `site/` su GitHub Pages (es. usando GitHub Actions). Non pubblicare la cartella `supabase/` come sito.
3. Configura l'URL del sito tra gli URL consentiti in **Authentication > URL Configuration** di Supabase, soprattutto se in futuro userai link email e recupero password.
4. Apri il sito, accedi con le credenziali **Supabase** e premi Aggiorna.

## 3. Test e limiti della prima versione

- Il backend legge `Device`, `DeviceStatusInfo`, `Trip`, `StatusData` solo per `GEOTAB_DEVICE_ID` (default `b1`). Non esegue `Set`, non invia comandi CAN e non modifica il GO9B.
- La dashboard visualizza GPS, stato, velocità, ultimi viaggi e alcuni campioni tecnici grezzi. Porte, batteria e livello carburante richiedono un successivo mapping affidabile dei diagnostici specifici; **non vengono inventati**.
- Nessun aggiornamento automatico: usa il pulsante Aggiorna. Il valore GPS può essere storico.
- Il dato di distanza `Trip.distance` è convertito da metri in km; se il tuo database usa un formato diverso, verificarlo prima di usarlo in report.
- I tile OpenStreetMap e le librerie CDN richiedono Internet; il caricamento della mappa comunica le coordinate ai provider delle tile. Verifica termini d'uso e privacy per un eventuale uso pubblico.
- La PWA è installabile dove supportata, ma questa MVP non include notifiche push né modalità offline.
- Non pubblicare il sito prima di aver impostato `ALLOWED_USER_ID`: il backend blocca qualsiasi accesso se manca.

## 4. Pubblicazione alternativa rapida con GitHub Actions

Il workflow incluso crea `site/config.js` al deploy usando le **Repository Variables** `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`, quindi distribuisce `site/` su Pages. Abilita in GitHub Settings > Pages la sorgente **GitHub Actions**.

## Sicurezza

Le credenziali Geotab devono stare **esclusivamente** nei Supabase Secrets. La chiave publishable Supabase non dà accesso ai dati Geotab senza una sessione utente valida e il controllo UUID. Non utilizzare mai credenziali Geotab nel frontend, nei commit o nei log.
