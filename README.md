# AliPost v2 — Telegram Mini App

Piattaforma completa per gestione post affiliati Amazon & AliExpress.

## Struttura progetto

```
src/
├── types/index.ts              → Tutti i tipi TypeScript
├── data/mock.ts                → Dati mock + helpers (genId, mockProduct, detectSource)
├── context/AppContext.tsx      → Stato globale + hook useApp()
├── components/
│   └── Shared.tsx              → Componenti riutilizzabili:
│                                  PageHeader, SourceBadge, StatusBadge,
│                                  SwitchTabs, ToggleRow, PriceRow,
│                                  EmptyState, InfoBanner, ErrorBanner,
│                                  TelegramPreview
├── pages/
│   ├── MainPages.tsx           → Dashboard, SearchPage, NewPostPage,
│   │                              QueuePage, PublishedPage
│   └── LayoutSettings.tsx     → LayoutPage (Tags/Testo/Template), SettingsPage
├── App.tsx                     → Router + BottomNav
├── index.tsx                   → Entry point + Telegram SDK init
└── index.css                   → Design system dark/mobile-first
```

## Funzionalità implementate

### Dashboard
- Statistiche: in coda / programmati / pubblicati
- 6 pulsanti: Cerca Offerte, Nuovo Post, Coda, Pubblicati, Layout, Impostazioni
- Badge AUTO ON quando AutoPost è attivo

### Cerca Offerte
- Filtro Amazon / AliExpress / Entrambi
- Campo ricerca testuale
- Lista prodotti mock con immagine, titolo, prezzo, sconto
- Azioni: Pubblica ora / Aggiungi AutoPost

### Nuovo Post
- Contatori singoli/multipli/link
- Switch modalità: singolo / multiplo
- Inserimento link uno alla volta (invio rapido)
- Riconoscimento automatico Amazon vs AliExpress
- Analisi link → modifica prodotti → anteprima → aggiungi coda
- Max 6 articoli in modalità multipla

### Coda AutoPost
- Lista tutti i post con tipo, source, stato, orario
- Riordino ↑↓
- Selezione multipla
- Unisci in multiplo
- Eliminazione singola e multipla
- Pubblica subito

### Pubblicati
- Lista post pubblicati oggi
- Modifica / Duplica / Reinserisci in AutoPost

### Layout
- **Tag**: lista tag dinamici, crea/elimina
- **Testo**: gestisci layout multipli (normale/minimo storico/multiplo), editor completo
- **Template immagine**: canvas mock, elementi (visibilità toggle), caricamento overlay/logo

### Impostazioni
- API Amazon PA-API, AliExpress API
- Tracking ID Amazon e AliExpress
- Canali Telegram (aggiungi/rimuovi)
- AutoPost: toggle, ora inizio/fine, intervallo minuti

## Avvio locale

```bash
cd alipost-v2
npm install
npm start
```

## Build produzione

```bash
npm run build
```

## Deploy Telegram Mini App

1. Crea bot con @BotFather
2. `/newapp` per creare la Mini App
3. Deploy su hosting HTTPS (Vercel, Netlify)
4. Decommentare `<script telegram-web-app.js>` in `public/index.html`
5. Registra URL con @BotFather

## Collegare API reali

In `src/data/mock.ts`, sostituire `fetchProductMock()`:

```typescript
// Amazon (PA-API)
export async function fetchAmazonProduct(asin: string, trackingId: string): Promise<Product> {
  const res = await fetch(`/api/amazon/product/${asin}?tracking=${trackingId}`);
  return res.json();
}

// AliExpress
export async function fetchAliProduct(itemId: string): Promise<Product> {
  const res = await fetch(`/api/aliexpress/product/${itemId}`);
  return res.json();
}
```

## TODO future

- [ ] Integrazione API Amazon PA-API v5
- [ ] Integrazione API AliExpress Affiliate
- [ ] Storico prezzi + grafico
- [ ] Rilevamento automatico minimo storico
- [ ] Pubblicazione effettiva su Telegram via Bot API
- [ ] Database persistente (Supabase / PlanetScale)
- [ ] Drag & drop coda (react-dnd)
- [ ] Editor template immagine canvas reale (Fabric.js / Konva)
- [ ] Notifiche push Telegram
