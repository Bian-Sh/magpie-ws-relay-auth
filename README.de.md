# Codex Proxy RS (WS) · Responses WebSocket Relay

> [!TIP]
> Ein magpie-/OpenCode-Provider-Plugin, das die Frames eines Responses-WebSocket-Relays in SSE übersetzt. Mit ausgeschaltetem Schalter wird daraus ein gewöhnlicher HTTP/SSE-Anbieter. magpie selbst bleibt unverändert.

[简体中文](./README.md) · [English](./README.en.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · **Deutsch**

## Was es tut

Viele Relays stellen dieselbe Responses API auf zwei Wegen bereit:

| Weg | Ohne Plugin nutzbar? | Dieses Plugin |
| --- | --- | --- |
| `POST /v1/responses` über HTTP/SSE | Ja, als benutzerdefinierter Anbieter | Bei ausgeschaltetem Schalter unverändert durchgereicht |
| `GET /v1/responses` per WebSocket Upgrade | Nein, ausgehende Anfragen sind HTTP | Baut ws auf, sendet ein `response.create`-Frame, wandelt jedes Frame in SSE |

Es ist eine **optionale Ergänzung**, keine Voraussetzung. Der WebSocket-Weg trägt den offiziellen Codex/Responses-Fingerabdruck (ein Request-Frame, `response.*`-Events, kein `[DONE]`, verbindungsbezogene Metadaten); HTTP/SSE bleibt immer als Rückfallweg.

Kompatibel mit jedem Relay, das OpenAIs offizielles Responses-WebSocket-Protokoll spricht, u. a. [zyycn/codex-proxy-rs](https://github.com/zyycn/codex-proxy-rs) und kompatible Gateways. Keine fest verdrahtete Domain, keine Prüfung eines Anbieternamens. Getestet gegen ein kompatibles Gateway (101-Handshake, 13 Events, Fehler-Frames, `previous_response_id`).

> [!WARNING]
> Plugins sind fremder Code: Sie melden sich an und senden Anfragen, sehen also Gespräch, Werkzeuge und Ergebnisse. Nur eigene, vertrauenswürdige Relays eintragen. Schlüssel bleiben lokal; das Plugin schreibt keine Logs.

## Anmeldung und Speicherung

| Punkt | Inhalt |
| --- | --- |
| Methode | API-Key (`Client API key`, Platzhalter `sk-…`) |
| Abfragen | Nur eine: die Relay-Basis-URL (leer = `http://127.0.0.1:8080/v1`), dann der Schlüssel — **zwei Schritte insgesamt**. Kartenname, Modelle, Katalog-URL und Guthaben werden bei der Anmeldung nicht gefragt (siehe „Erweiterte Konfiguration") |
| Schlüssel | `plugin-auth.json` im magpie-Konfigurationsverzeichnis, Modus 600, von magpie verwaltet |
| Antworten | In `metadata` des jeweiligen Kontos, zusammen mit dem Schlüssel |
| Mehrere Konten | Mehrfach unter demselben Anbieter anmelden (`id#xxxxxx`). **Jedes Konto hat eigene Basis-URL, Namen, Modellliste und Guthaben-Konfiguration**; Loader laufen im Konten-Scope |
| Kontingent / Guthaben | `auth.usage`-Hook meldet Guthaben bei Konfiguration; sonst keine Anzeige (siehe unten) |
| Icon | Karten-Icon aus `auth.icon` (eingebautes lila Inline-SVG), `package.json`-`magpie.icon` als Fallback; beide akzeptieren https-Link oder `data:image` |
| Proxy | HTTP nutzt magpies Proxy-Einstellungen; WebSocket liest `HTTPS_PROXY` / `HTTP_PROXY`, Loopback bleibt direkt |

### Erweiterte Konfiguration (Kartenname / Modelle / Katalog-URL / Guthaben)

Die Anmeldung fragt nur Adresse und Schlüssel. Alles andere kommt aus zwei Quellen, die die Anmeldung nie unterbrechen:

| Einstellung | Umgebungsvariable ( installationsweit, alle Konten) | Legacy-Konto (pro Konto) |
| --- | --- | --- |
| Kartenname | `MAGPIE_WS_RELAY_NAME` | eine von einer älteren Anmeldung gespeicherte `display_name` |
| Manuelle Modell-IDs | `MAGPIE_WS_RELAY_MODELS` | gespeicherte `models` |
| Modellkatalog-URL | `MAGPIE_WS_RELAY_MODELS_URL` | gespeicherte `models_url` |
| Guthaben-Endpunkt | `MAGPIE_WS_RELAY_BALANCE_URL` | gespeicherte `balance_url` |
| Guthaben-Methode | `MAGPIE_WS_RELAY_BALANCE_METHOD` (GET/POST) | `balance_method` |
| Guthaben-POST-Body | `MAGPIE_WS_RELAY_BALANCE_QUERY` (`{key}` = der Schlüssel) | `balance_query` |
| Guthaben-JSON-Pfad | `MAGPIE_WS_RELAY_BALANCE_PATH` (leer = automatisch) | `balance_path` |
| Guthaben-Einheit | `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | `balance_currency` |

Reihenfolge: **Konto-Metadaten (von einer älteren Anmeldung) > Umgebungsvariable > Standard**. Mit 0.4.0 oder früher angemeldete Konten brauchen nichts; env-Änderungen gelten nach dem nächsten Host-Reload. `MAGPIE_WS_RELAY_ACTOR_AUTH` auf leer setzen, um den `x-openai-actor-authorization`-Handshake-Header wegzulassen (alte Namen `MAGPIE_CODEX_PROXY_*` gelten weiter).

> [!TIP]
> **Warum kann die Anmeldung nicht ein Formular wie der eingebaute „Benutzerdefinierter Anbieter" sein?** magpies Plugin-Anmeldeprotokoll (`nextPrompt` in `host.js`) rendert eine Frage pro Schritt, prüft die Antwort und fragt dann die nächste (das OpenCode-`auth login`-Muster) — ein Plugin kann kein mehrfeldriges Formular zeichnen. `magpie.panels`-Panels betten sich zwar in den Anbieter-Editor ein, aber einem sandboxed Panel fehlt jeder Weg, einen String zu speichern (Options sind nur Booleans, die CSP blockiert das Netz). Daher schneidet dieses Plugin die Fragen auf das Minimum: **Adresse + Schlüssel, zwei Schritte**, so lang wie die zwei Pflichtfelder des eingebauten Formulars. Der Rest bleibt default, bei Bedarf per Umgebungsvariable.

Headless-Installationen können komplett über die Umgebung laufen; `MAGPIE_WS_RELAY_BASE_URL` vertritt die Adressfrage.

## Modelle

| Quelle | Verhalten |
| --- | --- |
| Bei Anmeldung eingegebene IDs | Vorrang, Komma-getrennt, z. B. `gpt-5.6-terra, gpt-5.6` |
| Leer | Pro Konto einmal `{base}/models`, OpenAI-kompatibles `{"data":[{"id":…}]}` |
| Fehler / vor Anmeldung | magpies bestehende Liste (erstmal `gpt-5.6-terra`) |

Modelle haben standardmäßig `limit: { context: 272000, output: 128000 }`. Abweichende Fenster in `plugins.json` überschreiben.

### Eigene Modellkatalog-URL

magpies eingebauter Custom Provider erlaubt eine Modellkatalog-URL; dieses Plugin ebenso: die Umgebungsvariable **`MAGPIE_WS_RELAY_MODELS_URL`** (absolute URL, z. B. `https://relay.example/v1/models`; eine von einer älteren Anmeldung gespeicherte `models_url` gewinnt pro Konto). Leer nutzt `{base}/models`; beide fehlgeschlagen behält magpies Liste. Reihenfolge: manuell > `models_url` > `/models`.

### Anbieter-Kartenname anpassen

Der eingebaute Custom Provider hat ein Namensfeld; Plugin-Provider haben keinen nativen Editor (der Kartenname kommt vom `config`-Hook). Daher liest dieses Plugin den Namen aus der Umgebungsvariablen **`MAGPIE_WS_RELAY_NAME`** (eine von einer älteren Anmeldung gespeicherte `display_name` gewinnt pro Konto). Wirksam nach dem nächsten Host-Reload. Ohne beides bleibt es „Codex Proxy RS (WS)".

> [!TIP]
> Sofort wirksam: Nach dem Eingeben des Namens das Plugin in der App aus- und wieder einschalten (das Terminal-`magpie` liest bei jedem Start die aktuelle Datei). Vor der ersten Anmeldung heißt die Karte defaultmäßig; nach Anmeldung und Reload zeigt sie den eingegebenen Namen.

### Relay-Guthaben: Anschluss und Rolle in der App

magpies Custom Provider kann einen Guthaben-Endpunkt setzen; dieses Plugin macht das über den **`auth.usage`-Hook**, konfiguriert per Umgebungsvariablen (gleichnamige gespeicherte Metadaten gewinnen pro Konto):

| Umgebungsvariable | Zweck |
| --- | --- |
| `MAGPIE_WS_RELAY_BALANCE_URL` | GET/POST-Endpunkt für Guthaben; **nicht gesetzt = keine Anzeige** (kein Fehler) |
| `MAGPIE_WS_RELAY_BALANCE_METHOD` | `GET` (Standard) oder `POST` |
| `MAGPIE_WS_RELAY_BALANCE_QUERY` | POST-Body, `{key}` wird durch den Client Key ersetzt |
| `MAGPIE_WS_RELAY_BALANCE_PATH` | Punkt-Pfad ins JSON, z. B. `data.balance`, `wallet.credits`; leer = größtes Zahlenfeld automatisch |
| `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | Einheit, z. B. `USD` / `Punkte`; nur Anzeige, z. B. `123.45 USD` |

Datenfluss in der App (wie bei magpie):

1. **Manuell aktualisieren**: „Allowance aktualisieren / Refresh allowance" auf der Karte ruft `auth.usage` und schreibt das Ergebnis in die Konten-Nutzung.
2. **Kartenanzeige**: Das Guthaben erscheint als `balance` des Anbieters auf der Karte, neben Tarifnutzung und Rate-Limit-Fenstern.
3. **Nutzungsstatistik / Routing**: `balance` ist ein **prepaid wallet** (ohne Gesamtbetrag). magpie probiert unter eines Anbieters Konten das mit der meisten Balance in derselben Einheit zuerst (#3950). Es ist **kein Verbrauchszähler** — magpie zieht nach jeder Anfrage nichts ab, sondern liest, zeigt und sortiert nur.
4. **Optionales Fenster**: Liefert das Relay ein „genutzt/Gesamt"-Rate-Limit statt reinem Guthaben, kann `auth.usage` stattdessen `windows` (`used` / `limit` / `unit`) zurückgeben. Die aktuelle Version gibt standardmäßig nur `balance` zurück — genug für die meisten Wallet-Fälle.

> [!NOTE]
> `auth.usage` liest nur, schreibt nicht: Es ändert keinen Zustand auf dem Relay. Bei Fehlern wird `{ error }` zurückgegeben; die Karte zeigt „Lesefehler" statt abzustürzen.

### Woher das Icon kommt

Das Karten-Icon ist `auth.icon` (eingebautes lila Inline-SVG). magpie bevorzugt `auth.icon`, dann `package.json`-`magpie.icon`; beide akzeptieren `https://`-Link oder `data:image/…`-Inline (≤1,5 MB). Eigenes Icon: die `ICON`-Konstante in `index.js` oder `magpie.icon` in `package.json` ändern.

## Installation

Ordnerweise (Entwicklung, Eigenbedarf):

```sh
magpie plugin add ./ws-relay-plugin
magpie plugin login codex-proxy-ws      # Client Key, Relay-URL, Modell-IDs
magpie provider test codex-proxy-ws
```

In der App: Plugins → hinzufügen → Ordnerpfad → **Codex Proxy RS (WS)** unter „Von Plugins" → anmelden.

> [!TIP]
> Ordner-Plugins werden über ihren absoluten Pfad registriert: Verzeichnis danach nicht verschieben oder umbenennen. Nach Änderungen an `index.js` / `package.json` das Plugin aus- und wieder einschalten (das Terminal-`magpie` liest bei jedem Aufruf die aktuelle Datei).

### Der Schalter

Anbieter bearbeiten → **Plugin-Optionen → WebSocket-Relay verwenden → Aus / An**. Über `auth.options` deklariert, pro Anbieter-ID in `settings.json` unter `pluginOptions` gespeichert und bei jedem Request neu gelesen — **ohne Neustart** (Standard: an).

| Zustand | Verhalten |
| --- | --- |
| An | `POST /responses` über WebSocket; alles andere, Nicht-http(s)-URLs und fehlgeschlagene Handshakes fallen auf HTTP zurück |
| Aus | Alle Anfragen per `fetch`, kein Socket |

```sh
magpie plugin options codex-proxy-ws '{"ws": false}'
magpie plugin options codex-proxy-ws off     # Plugin-Standard wiederherstellen
```

> [!NOTE]
> Bezeichnung, Beschreibung und Bestätigung sind für `zh`, `zh-TW`, `ja` und `de` übersetzt; Englisch ist der Fallback.

## Protokoll

| Schritt | Konvention |
| --- | --- |
| Handshake | `GET {base}/responses` Upgrade, `Authorization: Bearer <key>`, `OpenAI-Beta: responses_websockets=2026-02-06` |
| Anfrage | Ein Text-Frame `{"type":"response.create", ...body}`, `stream: true` erzwungen |
| `previous_response_id` | Nur innerhalb einer Verbindung gültig; neue Sockets würden 400 `previous_response_not_found` liefern. Das Plugin entfernt das Feld und sendet die vollständige Historie |
| Antwort | Ein JSON-Event pro Frame; Frame-Inhalt wird `data:`, `type` wird `event:`. `usage`, `id`, `model` und Ratenlimit-Header bleiben erhalten |
| Vorspann | `response.metadata` / `codex.response.metadata` / `codex.rate_limits` / `response.created` / `response.in_progress` werden ebenfalls als SSE ausgegeben (für Quota-Buchhaltung) |
| Ende | `response.completed` / `failed` / `incomplete` / `done` / `error`. **Kein `[DONE]` wird erzeugt** |
| Fehler | Ein `{"type":"error","status":503,…}` vor dem ersten Event wird zum HTTP-Fehler mit `Retry-After` / `x-request-id`, damit Failover greift |
| Heartbeat | Ping/Pong durch Relay und Bun, nie als SSE |
| Lebensdauer | Eine Verbindung pro Turn, kein Replay nach Output-Beginn, AbortSignal schließt den Socket |

## Tipps und FAQ

> [!TIP]
> **Warum steht der Schalter nicht auf der Seite „Benutzerdefinierter Anbieter"?** Dort bearbeitet magpie seine eigenen Anbieter (`providers.json`) mit gemeinsamen Feldern. Plugin-Optionen gehören zu `pluginOptions`, gespeichert nach der vom Plugin registrierten Anbieter-ID. Ein Schalter in der eingebauten Seite würde die Kern-Konfigurationslogik für alle Anbieter verändern und einen Filter „welcher Anbieter zeigt das?" nötig machen. Dieses Plugin bleibt bewusst nicht-invasiv.

> [!TIP]
> **Warum sieht der obere Teil meiner Plugin-Detailseite anders aus als bei einem veröffentlichten (npm) Plugin?** Es ist die **Metadatenquelle**, nicht ein Bug.
> - Ein **über npm veröffentlichtes** Plugin bezieht den oberen Teil (Autor, `vX.Y.Z`, wöchentliche Downloads, Lizenz, „aktualisiert", npm/Quellcode-Buttons) aus **npm registry + magpies Community-Manifest** (`market.json` / `registry.json`); ein lokales Plugin ohne diese Daten zeigt sie nicht.
> - Ein **über Ordnerpfad** (absolut) installiertes Plugin rendert nur eine `README.md`; „aktualisiert" ist deren mtime, alle anderen Metadaten fehlen — man sieht also Icon + Name + Pfad + aktualisiert + README-Text.
> - Vor dem Angleichen ausfüllen: `description` / `author` / `license` / `repository` / `homepage` und `magpie.icon` in `package.json` werden **lokal** angezeigt; wöchentliche Downloads und npm/Quellcode-Buttons erscheinen erst nach npm-Veröffentlichung (siehe [PUBLISHING.md](./PUBLISHING.md)).
> - Fazit: Der Unterschied im oberen Teil ist der inhärente „Ordner- vs. npm-Installation", kein fehlendes Feature. Für volle Angleichung den npm-Publish-Pfad in [PUBLISHING.md](./PUBLISHING.md) gehen.

> [!TIP]
> **Mehrere Relays oder Provider?** Es ist keine Domain fest verdrahtet. Mehrere Konten unter einem Anbieter anlegen, jedes mit eigener URL; magpie baut die Request-URL pro Konto. Für getrennte Schalter das Paket kopieren und die Konstante `ID` ändern.

> [!TIP]
> **Wenn HTTP/SSE reicht, brauchst du kein WebSocket.** Der duale HTTP-Stack ist meist stabiler und einfacher zu debuggen. Schalte ws nur ein, wenn du den offiziellen Codex-Fingerabdruck, verbindungsbezogene Metadaten oder die langlebigen Verbindungen brauchst.

> [!WARNING]
> `e2e.mjs` braucht **Bun** (magpie bringt es mit). Node's globales `WebSocket` kann keine eigenen Handshake-Header senden, `Authorization` ginge verloren. `test.mjs` nutzt einen Mock und läuft unter Node.

> [!WARNING]
> Bekannte Grenzen: eine Verbindung pro Turn (kein In-Connection-Continue), keine Preise/`serviceTiers`, keine konto-spezifische WebSocket-Proxy-Einstellung. `magpie.panels`-Panels wurden im Quelltext verifiziert: ihnen fehlt jeder Weg, einen String zu speichern (Options nur Boolean, die Sandbox-CSP blockiert das Netz) — darum nicht als Konfigurationsfläche. Die erweiterten Umgebungsvariablen gelten **installationsweit** (alle Konten dieses magpie); konto-spezifische Guthaben-/Namenssettings stammen nur aus Metadaten älterer Anmeldungen. Guthaben ist „anzeigen + routen"; `auth.usage` ist implementiert, aber magpie **zieht nach jeder Anfrage nichts ab** (die Guthaben-Semantik ist kein Verbrauchszähler).

## Tests

```sh
node test.mjs                      # 23 Szenarien (Protokoll/Schalter/Konten/Modelle/Name/Guthaben/env), kein Netz nötig
CPRS_KEY=sk-… CPRS_BASE=https://your-relay/v1 bun run e2e.mjs
```

Der Live-Test sendet vier kurze, kostenpflichtige Anfragen: ws an, ws aus, Upstream-Fehlerframe, `previous_response_id`. Der Schlüssel kommt ausschließlich aus der Umgebung.

## Veröffentlichung

Siehe [PUBLISHING.md](./PUBLISHING.md) für npm, das GitHub-Topic `magpie-plugin` und die Community-Liste `registry.json` (samt Zugangsbedingungen der „Entdecken"-Seite). Dieses Paket ist **weder veröffentlicht noch zu GitHub gepusht** und wird nur lokal aus einem Ordner installiert.

## Lizenz

MIT
