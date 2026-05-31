// Regole keyword → emoji (ordine: prima specifico, poi generico)
// Ogni elemento: { re: RegExp che matcha sul titolo, emoji }
const KEYWORD_RULES: Array<{ re: RegExp; emoji: string }> = [
  // ── Telefonia ──────────────────────────────────────────────────────────────
  { re: /\b(iphone|samsung.{0,10}galaxy|xiaomi.{0,10}redmi|pixel.{0,5}\d|motorola.{0,10}moto)\b/i, emoji: '📱' },
  { re: /\b(smartphone|telefono|cellulare|mobile phone)\b/i, emoji: '📱' },
  { re: /\b(ipad|tablet|e-reader|kindle)\b/i, emoji: '📱' },

  // ── PC & Monitor ───────────────────────────────────────────────────────────
  { re: /\b(macbook|laptop|notebook|ultrabook|chromebook)\b/i, emoji: '💻' },
  { re: /\b(pc|computer|desktop|tower).{0,10}(portatil|fisso|gaming|win)/i, emoji: '🖥️' },
  { re: /\b(monitor|display)\b.{0,15}(pollici|inch|4k|2k|qhd|fhd|ips|va|oled)/i, emoji: '🖥️' },

  // ── Audio ──────────────────────────────────────────────────────────────────
  { re: /\b(airpods|cuffie|auricolar|headphone|earphone|earbuds|in-ear)\b/i, emoji: '🎧' },
  { re: /\b(speaker|altoparlante|cassa.{0,8}bluetooth|soundbar|subwoofer)\b/i, emoji: '🔊' },

  // ── TV & Video ─────────────────────────────────────────────────────────────
  { re: /\b(smart tv|televisore|oled tv|qled|neo qled|mini.?led tv)\b/i, emoji: '📺' },
  { re: /\b(proiettore|projector|beamer)\b/i, emoji: '📽️' },

  // ── Foto & Video ───────────────────────────────────────────────────────────
  { re: /\b(fotocamera|mirrorless|reflex|dslr|gopro|action.?cam|telecamera)\b/i, emoji: '📷' },
  { re: /\b(drone|dji.{0,15}(air|mini|mavic|phantom))\b/i, emoji: '🚁' },

  // ── Gaming ─────────────────────────────────────────────────────────────────
  { re: /\b(playstation|xbox|nintendo switch|ps5|ps4|gamepad|joystick|controller.{0,10}(gioc|game))\b/i, emoji: '🎮' },
  { re: /\b(videogioc|gaming mouse|gaming keyboard|gaming headset|scheda video|gpu)\b/i, emoji: '🎮' },

  // ── Smartwatch & Orologi ───────────────────────────────────────────────────
  { re: /\b(apple watch|galaxy watch|fitbit|garmin.{0,10}watch|smartwatch|fitness watch)\b/i, emoji: '⌚' },
  { re: /\b(orologio|cronografo|orologi).{0,20}(uomo|donna|acciaio|automatico|quarzo)\b/i, emoji: '⌚' },

  // ── Stampanti & Accessori ──────────────────────────────────────────────────
  { re: /\b(stampante|printer|scanner|plotter)\b/i, emoji: '🖨️' },
  { re: /\b(cartuccia|toner|inchiostro.{0,10}(stampante|hp|canon|epson))\b/i, emoji: '🖨️' },

  // ── Rete & Connettività ────────────────────────────────────────────────────
  { re: /\b(router|wifi|wi-fi|modem|access point|mesh.{0,10}rete|switch.{0,10}rete|ethernet)\b/i, emoji: '📡' },

  // ── Batterie & Ricarica ────────────────────────────────────────────────────
  { re: /\b(powerbank|power bank|caricatore|caricabatterie|batteria portati|powerstation)\b/i, emoji: '🔋' },

  // ── Robot & Pulizie casa ───────────────────────────────────────────────────
  { re: /\b(robot.{0,15}(aspira|lava|puliz)|roomba|irobot|roborock|dreame|ecovacs)\b/i, emoji: '🤖' },
  { re: /\b(aspirapolvere|scopa.{0,10}elettrica|dyson)\b/i, emoji: '🧹' },

  // ── Lavatrici & Grandi Elettrodomestici ───────────────────────────────────
  { re: /\b(lavatrice|asciugatrice|lavasciuga)\b/i, emoji: '🧺' },
  { re: /\b(lavastoviglie|dishwasher)\b/i, emoji: '🍽️' },
  { re: /\b(frigorifero|freezer|frigo|refrigerator)\b/i, emoji: '🧊' },

  // ── Cucina & Cottura ───────────────────────────────────────────────────────
  { re: /\b(friggitrice.{0,10}aria|air fryer)\b/i, emoji: '🍟' },
  { re: /\b(forno|microonde|fornello|piano.{0,8}cottura|piastra.{0,8}cottura)\b/i, emoji: '🍳' },
  { re: /\b(macchina.{0,10}caffè|nespresso|dolce gusto|caffettiera|moka|macchina espresso)\b/i, emoji: '☕' },
  { re: /\b(frullatore|mixer|robot.{0,10}cucina|kenwood|kitchenaid|impastatrice)\b/i, emoji: '🥣' },
  { re: /\b(bollitore|kettle)\b/i, emoji: '☕' },

  // ── Aria & Riscaldamento ───────────────────────────────────────────────────
  { re: /\b(aria.{0,10}condizionata|condizionatore|climatizzatore)\b/i, emoji: '❄️' },
  { re: /\b(ventilatore|fan.{0,10}(da|tower|portatile))\b/i, emoji: '🌬️' },
  { re: /\b(stufa|termoventilatore|riscaldatore|radiatore.{0,10}elettric)\b/i, emoji: '🔥' },
  { re: /\b(purificatore.{0,10}aria|umidificatore|deumidificatore)\b/i, emoji: '💨' },

  // ── Illuminazione ──────────────────────────────────────────────────────────
  { re: /\b(lampada|lampadina|illuminazione|striscia.{0,8}led|luce.{0,5}led|smart.{0,8}luce)\b/i, emoji: '💡' },

  // ── Letto & Bagno ──────────────────────────────────────────────────────────
  { re: /\b(piumone|lenzuola|cuscino|guanciale|materasso|coperta|copripiumino)\b/i, emoji: '🛏️' },
  { re: /\b(asciugamano|telo.*bagno|accappatoio)\b/i, emoji: '🛁' },

  // ── Arredamento ────────────────────────────────────────────────────────────
  { re: /\b(sedia|poltrona|divano|pouf)\b/i, emoji: '🪑' },
  { re: /\b(tavolo|scrivania|libreria|scaffale|armadio|comodino)\b/i, emoji: '🪑' },
  { re: /\b(tenda|veneziana|rullo.{0,10}oscurante)\b/i, emoji: '🪟' },

  // ── Igiene femminile ───────────────────────────────────────────────────────
  { re: /\b(assorbente|igiene.{0,10}femminile|ciclo.{0,10}mestruale|mestrual|coppetta)\b/i, emoji: '🌸' },
  { re: /\b(pannolino|pampers|huggies)\b/i, emoji: '👶' },

  // ── Rasoi & Depilazione ────────────────────────────────────────────────────
  { re: /\b(rasoio|epilatore|depilatore|regolabarba|braun.{0,10}(serie|silk)|philips.{0,10}(oneblade|aquatouch))\b/i, emoji: '🪒' },

  // ── Igiene orale ──────────────────────────────────────────────────────────
  { re: /\b(spazzolino|dentifricio|oral.?b|irrigatore.{0,10}dentale|igiene.{0,10}dentale|collutorio)\b/i, emoji: '🪥' },

  // ── Profumi ────────────────────────────────────────────────────────────────
  { re: /\b(profumo|eau de|parfum|colonia).{0,20}(uomo|donna|ml)\b/i, emoji: '🌺' },

  // ── Skincare & Crema ──────────────────────────────────────────────────────
  { re: /\b(crema|siero|contorno.{0,10}(occhi|viso)|idratante|struccante|skincare|toner.{0,10}(viso|pelle)|moisturizer)\b/i, emoji: '🧴' },

  // ── Shampoo & Doccia ──────────────────────────────────────────────────────
  { re: /\b(shampoo|balsamo|doccia.?schiuma|bagnoschiuma|sapone|deodorante.{0,10}(spray|roll|stick))\b/i, emoji: '🧴' },

  // ── Make-up ────────────────────────────────────────────────────────────────
  { re: /\b(rossetto|mascara|fondotinta|correttore|blush|cipria|palette|ombretto|kajal|eyeliner)\b/i, emoji: '💄' },

  // ── Sport & Fitness ────────────────────────────────────────────────────────
  { re: /\b(e-bike|bicicletta.{0,10}elettrica)\b/i, emoji: '⚡' },
  { re: /\b(bici|bicicletta|mountain bike|road bike|ciclismo)\b/i, emoji: '🚴' },
  { re: /\b(tapis roulant|cyclette|vogatore|ellittica|spin bike)\b/i, emoji: '🏃' },
  { re: /\b(manubri|pesi|bilanciere|kettlebell|rack|panca.{0,10}pesi|palestra.{0,10}casa)\b/i, emoji: '🏋️' },
  { re: /\b(yoga|pilates|tappetino.{0,10}(yoga|fitness|palestra))\b/i, emoji: '🧘' },
  { re: /\b(nuoto|muta.{0,10}(mare|piscina)|occhialini.{0,10}(nuoto|piscina))\b/i, emoji: '🏊' },
  { re: /\b(tenda.{0,10}campeggio|sacco.{0,10}pelo|zaino.{0,10}trekking|escursionismo|campeggio)\b/i, emoji: '⛺' },
  { re: /\b(calcio|pallone|maglia.{0,10}calcio|pallone)\b/i, emoji: '⚽' },
  { re: /\b(tennis|padel|racchetta)\b/i, emoji: '🎾' },
  { re: /\b(basket|pallacanestro)\b/i, emoji: '🏀' },
  { re: /\b(sci|snowboard|sciistica|discesa)\b/i, emoji: '⛷️' },
  { re: /\b(pattini|pattinaggio)\b/i, emoji: '⛸️' },
  { re: /\b(monopattino|scooter.{0,10}elettrico)\b/i, emoji: '🛴' },

  // ── Scarpe sport (prima di abbigliamento generico) ─────────────────────────
  { re: /\b(scarpe.{0,20}(running|trail|tennis|calcio|basket|sport|palestra|ginnastica|fitness)|sneakers?)\b/i, emoji: '👟' },
  { re: /\b(nike|adidas|new balance|asics|converse|vans|puma).{0,30}(scarpe|sneakers?|running|trail|basket|tennis|sport)\b/i, emoji: '👟' },

  // ── Abbigliamento ─────────────────────────────────────────────────────────
  { re: /\b(giacca|giubbotto|cappotto|parka|piumino).{0,20}(uomo|donna|taglia|invernale)\b/i, emoji: '🧥' },
  { re: /\b(scarpe.{0,25}(donna|tacco|col\s+tacco)|tacchi|decollete|ballerine|stiletto)\b/i, emoji: '👠' },
  { re: /\b(scarpe.{0,25}uomo|mocassini)\b/i, emoji: '👞' },
  { re: /\b(stivali)\b/i, emoji: '👢' },
  { re: /\b(scarpe|sandali)\b/i, emoji: '👟' },
  { re: /\b(borsa|borsetta|clutch|pochette|shopper)\b/i, emoji: '👜' },
  { re: /\b(zaino.{0,10}(scuola|lavoro|viaggio|urban))\b/i, emoji: '🎒' },
  { re: /\b(portafoglio|portafogli)\b/i, emoji: '👛' },
  { re: /\b(cappello|berretto|cappellino|beanie)\b/i, emoji: '🧢' },
  { re: /\b(occhiali.{0,10}(sole|vista|lettura))\b/i, emoji: '🕶️' },
  { re: /\b(maglia|maglione|pullover|cardigan)\b/i, emoji: '🧶' },
  { re: /\b(maglietta|t-shirt|felpa)\b/i, emoji: '👕' },
  { re: /\b(pantaloni|jeans|shorts|bermuda|leggings)\b/i, emoji: '👖' },
  { re: /\b(costume.{0,10}bagno|bikini|trikini)\b/i, emoji: '👙' },
  { re: /\b(cintura|cinture)\b/i, emoji: '👔' },
  { re: /\b(gioiello|gioielli|collana|bracciale|anello|orecchini|ciondolo)\b/i, emoji: '💍' },
  { re: /\b(nike|adidas|new balance|asics|converse|vans|puma)\b/i, emoji: '👟' },

  // ── Alimentari ────────────────────────────────────────────────────────────
  { re: /\b(caffè|caffe|espresso.{0,10}(capsule|cialde)|nescafe|lavazza|illy|borbone)\b/i, emoji: '☕' },
  { re: /\b(cioccolato|cacao|lindt|ferrero|nutella|kinder)\b/i, emoji: '🍫' },
  { re: /\b(biscotti|cookies|crackers|wafer|frollini)\b/i, emoji: '🍪' },
  { re: /\b(pasta|spaghetti|rigatoni|penne|fusilli|riso.{0,10}(barilla|gallo|acquerello))\b/i, emoji: '🍝' },
  { re: /\b(olio.{0,10}oliva|olio.{0,10}evo|extravergine)\b/i, emoji: '🫒' },
  { re: /\b(vino|prosecco|spumante|champagne)\b/i, emoji: '🍷' },
  { re: /\b(birra|craft beer)\b/i, emoji: '🍺' },
  { re: /\b(integratore|vitamina|omega.3|proteina|creatina|collagene|multivitaminico)\b/i, emoji: '💊' },
  { re: /\b(acqua.{0,10}(minerale|frizzante)|bevanda|succo|tè|te |infuso|tisana)\b/i, emoji: '🥤' },
  { re: /\b(snack|patatine|pop.?corn|frutta secca|noci|mandorle)\b/i, emoji: '🍿' },
  { re: /\b(gelato|ghiacciolo|sorbetto)\b/i, emoji: '🍦' },
  { re: /\b(carne|pollo|prosciutto|salame|mortadella|pesce)\b/i, emoji: '🥩' },

  // ── Bambini ───────────────────────────────────────────────────────────────
  { re: /\b(lego|duplo|mattoncini.{0,10}costruzione)\b/i, emoji: '🧱' },
  { re: /\b(bambola|barbie|hot wheels|action figure|playmobil)\b/i, emoji: '🧸' },
  { re: /\b(passeggino|carrozzina|seggiolino|ovetto|neonato|baby monitor)\b/i, emoji: '🍼' },
  { re: /\b(giocattolo|gioco.{0,10}(tavolo|da tavolo|societario)|puzzle|costruzioni)\b/i, emoji: '🎲' },

  // ── Libri ─────────────────────────────────────────────────────────────────
  { re: /\b(libro|romanzo|saggio|manuale|enciclopedia|fumetto|graphic novel)\b/i, emoji: '📚' },

  // ── Musica & Strumenti ────────────────────────────────────────────────────
  { re: /\b(chitarra|pianoforte|tastiera.{0,10}musicale|violino|batteria.{0,10}(elettronica|acustica))\b/i, emoji: '🎸' },

  // ── Salute & Medicale ─────────────────────────────────────────────────────
  { re: /\b(termometro|misuratore.{0,10}pressione|saturimetro|sfigmomanometro|glucometro)\b/i, emoji: '🩺' },
  { re: /\b(maschera.{0,10}facciale|mascherina|ffp2|ffp3)\b/i, emoji: '😷' },

  // ── Animali ───────────────────────────────────────────────────────────────
  { re: /\b(cibo.{0,10}(cane|gatto)|croccantini|pedigree|whiskas|royal canin|hill.?s)\b/i, emoji: '🐾' },
  { re: /\b(cuccia|lettiera|guinzaglio|collare.{0,10}(cane|gatto)|gioco.{0,10}(cane|gatto))\b/i, emoji: '🐾' },
  { re: /\b(pesci|acquario|tartaruga|uccelli.{0,10}(gabbia|cibo))\b/i, emoji: '🐾' },

  // ── Automotive ────────────────────────────────────────────────────────────
  { re: /\b(navigatore.{0,10}(gps|auto)|gps.{0,10}auto|dash.?cam|telepass)\b/i, emoji: '🗺️' },
  { re: /\b(pneumatico|gomme.{0,10}auto|cerchi.{0,10}auto)\b/i, emoji: '🔧' },
  { re: /\b(seggiolino.{0,10}auto|baby.{0,10}seat|car seat)\b/i, emoji: '🚗' },
  { re: /\b(caricatore.{0,10}auto|inverter.{0,10}auto)\b/i, emoji: '🚗' },
  { re: /\b(moto|scooter|motociclo|casco.{0,10}moto)\b/i, emoji: '🏍️' },

  // ── Giardinaggio ──────────────────────────────────────────────────────────
  { re: /\b(tagliaerba|tosasiepe|decespugliatore|soffiatore.{0,10}foglie)\b/i, emoji: '🌿' },
  { re: /\b(pianta|fiore|seme|terriccio|vaso|fioriera)\b/i, emoji: '🌱' },
  { re: /\b(barbecue|griglia.{0,10}(carbone|gas|elettrica)|grill)\b/i, emoji: '🔥' },
  { re: /\b(tosaerba|irrigatore|tubo.{0,10}(giardino|innaffiare))\b/i, emoji: '🌿' },

  // ── Ufficio & Cancelleria ─────────────────────────────────────────────────
  { re: /\b(sedia.{0,10}ufficio|poltrona.{0,10}ufficio|sedia.{0,10}ergonomica|gaming chair)\b/i, emoji: '🪑' },
  { re: /\b(penna|matita|evidenziatore|quaderno|taccuino|agenda|blocco.?notes)\b/i, emoji: '✏️' },
  { re: /\b(distruggi.?documenti|timbro|cucitrice|perforatrice)\b/i, emoji: '📎' },

  // ── Pulizia casa ──────────────────────────────────────────────────────────
  { re: /\b(detersivo|ammorbidente|candeggina|anticalcare|sgrassatore)\b/i, emoji: '🧽' },
  { re: /\b(sacchi.{0,10}(spazzatura|immondizia)|sacchetti.{0,10}(rifiuti|pattumiera))\b/i, emoji: '🗑️' },
  { re: /\b(carta.{0,10}igienica|fazzoletti|scottex|veline|carta.{0,8}casa)\b/i, emoji: '🧻' },
];

// Regole sulla categoria Amazon/AliExpress (fallback se nessuna keyword matcha)
const CAT_RULES: Array<{ re: RegExp; emoji: string }> = [
  { re: /elettronica|high.tech|informatica/i, emoji: '💻' },
  { re: /telefoni|smartphone|cellulari/i, emoji: '📱' },
  { re: /tv|televisori|home.?video/i, emoji: '📺' },
  { re: /fotografia|videocamere/i, emoji: '📷' },
  { re: /videogiochi|gaming/i, emoji: '🎮' },
  { re: /audio|hi-fi|altoparlanti/i, emoji: '🔊' },
  { re: /grandi.?elettrodomestici/i, emoji: '🧺' },
  { re: /piccoli.?elettrodomestici/i, emoji: '🍳' },
  { re: /casa|cucina|giardino|bricolage|fai.da.te/i, emoji: '🏠' },
  { re: /abbigliamento|moda|scarpe|borse/i, emoji: '👕' },
  { re: /gioielli|orologi/i, emoji: '💍' },
  { re: /alimentar|gastronomia|cibo|bevande|grocery/i, emoji: '🛒' },
  { re: /salute|bellezza|cura.persona|igiene|beauty/i, emoji: '🧴' },
  { re: /sport|outdoor|fitness|palestra/i, emoji: '🏃' },
  { re: /bambini|giocattoli|neonati|kids|toys/i, emoji: '🧸' },
  { re: /libri|ebook|books/i, emoji: '📚' },
  { re: /auto|moto|veicoli|automotive/i, emoji: '🚗' },
  { re: /animali|pet|animals/i, emoji: '🐾' },
  { re: /ufficio|cancelleria|lavoro|office/i, emoji: '💼' },
  { re: /musica|strumenti/i, emoji: '🎵' },
  { re: /garden|patio|lawn/i, emoji: '🌱' },
];

export function getProductEmoji(title: string, cat?: string): string {
  for (const { re, emoji } of KEYWORD_RULES) {
    if (re.test(title)) return emoji;
  }
  if (cat) {
    for (const { re, emoji } of CAT_RULES) {
      if (re.test(cat)) return emoji;
    }
  }
  return '📦';
}

export function shortenTitle(title: string): string {
  if (title.length <= 80) return title;
  for (const sep of [';', ',']) {
    const idx = title.indexOf(sep, 35);
    if (idx !== -1 && idx <= 90) return title.slice(0, idx).trim();
  }
  const cut = title.slice(0, 80);
  const sp = cut.lastIndexOf(' ');
  return sp > 30 ? cut.slice(0, sp).trim() : cut.trim();
}
