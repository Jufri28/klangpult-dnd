# Klangpult DnD

Klangpult DnD ist ein lokales, für Tablets optimiertes Spielleiter-Dashboard für Pen-&-Paper-Runden. Es kombiniert ein Audio-Soundboard mit Heldenverwaltung, Effekt-Timern und einer Würfelkonsole.

## Funktionen

- automatische Erkennung von Hintergrundmusik und Dialogen
- Crossfade zwischen Hintergrundtiteln
- getrennte Lautstärke für Hintergrund und Sprache
- Heldenkarten mit Initiative, Lebenspunkten, Rüstungsklasse und Attributen
- bis zu fünf Echtzeit- oder Rundeneffekte pro Held
- serverseitig weiterlaufende Echtzeit-Timer
- fünfsekündiger Fantasy-Glockenklang beim Ablauf eines Timers
- temporäre Attributsmodifikatoren und wiederkehrender Schaden oder Heilung
- eigene freie Würfelkonsole auf jeder Charakterkarte
- W4, W6, W8, W10, W12, W20 und W100 mit frei wählbarer Anzahl und Modifikator
- Formeln wie `3W6+2`, Bezeichnung sowie Vorteil und Nachteil für 1W20
- dauerhaftes Gesamtprotokoll und gefilterter Verlauf je Charakter
- eigenes Abenteuerbild und anpassbarer Titel
- dauerhafte Speicherung außerhalb des Container-Images

## Docker-Image

Das fertige Image wird bei jeder geprüften Änderung automatisch erstellt:

```text
ghcr.io/jufri28/klangpult-dnd:latest
```

Unterstützte Plattform:

```text
linux/amd64
```

## Unraid

Eine vorbereitete Unraid-Vorlage befindet sich unter:

```text
https://raw.githubusercontent.com/Jufri28/klangpult-dnd/main/unraid/klangpult-dnd.xml
```

Die Vorlage richtet folgende Einbindungen ein:

| Containerpfad | Verwendung | Modus |
|---|---|---|
| `/audio` | Musik, Erzählertexte und Dialoge | nur lesen |
| `/backgrounds` | Abenteuerbilder | nur lesen |
| `/data` | Helden, Timer, Runde und Würfelverlauf | lesen/schreiben |

Die zugehörigen Host-Verzeichnisse können bei der Installation frei gewählt werden. Weil alle veränderlichen Daten außerhalb des Images liegen, bleiben sie bei einem Container-Update erhalten.

Nach der einmaligen Einrichtung erkennt Unraid neue `latest`-Images über **Nach Updates suchen**. Das Update wird anschließend über **Update** eingespielt.

## Audioordner

Jeder Schauplatz besitzt Unterordner für Hintergrund und Sprache:

```text
audio/
└── Taverne/
    ├── hintergrund/
    └── dialog/
```

- `hintergrund`: Endlosschleife mit sanftem Wechsel
- `dialog`: einmalige Wiedergabe; ein neuer Dialog ersetzt den vorherigen
- unterstützt: MP3, WAV, M4A, AAC, OGG und FLAC

Unterstriche in Dateinamen werden in der Oberfläche als Leerzeichen angezeigt. Weitere Schauplätze erscheinen automatisch, sobald dort mindestens eine Audiodatei liegt.

## Abenteuerbilder

JPG-, PNG- und WebP-Dateien im eingebundenen Verzeichnis `/backgrounds` können im Bereich **Helden & Würfel → Abenteuerbild** ausgewählt werden.

## Charakterwürfel und Spielprotokoll

Jeder Charakter besitzt eine eigene Würfelkonsole. Anzahl, Würfelart, Zahlenmodifikator und Bezeichnung können vor jedem Wurf frei gewählt werden. Vorteil und Nachteil stehen für `1W20` zur Verfügung.

Das Gesamtprotokoll dokumentiert dauerhaft:

- Würfelformel, sämtliche Einzelwürfel, Modifikator und Gesamtergebnis
- Schaden und Heilung mit altem und neuem LP-Stand
- Start, Pause, Fortsetzung, Verlängerung, Ablauf und Entfernung von Effekten
- automatische und manuelle Timerereignisse
- jeden Rundenwechsel

Auf jeder Charakterkarte lässt sich zusätzlich ein gefilterter Verlauf öffnen. Das vollständige Protokoll wird nur über die Schaltfläche **Protokoll löschen** und nach einer zusätzlichen Bestätigung entfernt.

## Persistente Daten

Der aktuelle Spielstand einschließlich des vollständigen Protokolls wird unter `/data/state.json` im eingebundenen Datenverzeichnis gespeichert. Echtzeit-Timer laufen im Container weiter, auch wenn der Browser geschlossen wird.

## Lokaler Start mit Docker Compose

```bash
docker compose up -d
```

Standardmäßig ist die Anwendung anschließend über Port `8095` erreichbar. Die Host-Verzeichnisse werden relativ zum Projektordner aus `audio`, `backgrounds` und `data` eingebunden.

## Entwicklung und Prüfung

Die Anwendung besteht aus einem schlanken Node.js-Server und einem vorgebauten statischen Browser-Client. Vor jeder Image-Veröffentlichung werden Syntax- und Regressionstests ausgeführt.

```bash
node --check local-server.mjs
node --test tests/klangpult-v2.3.test.mjs
```

## Sicherheit

Das Dashboard ist für die Verwendung im privaten Heimnetz gedacht. Es besitzt keine Benutzeranmeldung und sollte nicht direkt aus dem Internet erreichbar gemacht werden.

## Version

Aktueller Stand: **2.3.0**
