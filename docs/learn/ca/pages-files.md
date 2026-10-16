# Crea pàgines, enllaços i adjunts

Utilitza pàgines per a les idees pròpies i conserva a prop el material que les sustenta. Gnosi desa el coneixement en fitxers Markdown i YAML.

## Abans de començar {#before-you-begin}

Un Vault actiu amb permisos d’escriptura. La IA és opcional; compartir i traduir requereix els complements corresponents.

## Passos {#steps}

1. Obre Coneixement i crea “Projecte de lectura”. Afegeix un títol, un paràgraf i una llista de preguntes amb l’editor de blocs.

2. Crea “Notes de la font”. Insereix-hi un enllaç des de la primera pàgina amb el selector de pàgines; comprova el resultat si hi ha títols semblants.

3. Adjunta un document petit amb els controls de l’editor. Torna’l a obrir per comprovar que el fitxer original és accessible.

4. Afegeix una citació textual amb la font i la localització. Separa-la de la teva interpretació per poder-la rastrejar després.

5. Surt de la pàgina i torna-la a obrir per verificar el desament automàtic. Recupera-la amb la cerca o la barra lateral i comprova l’enllaç.

### Taules amples

Al menú **⋯** de la pàgina, activa **Amplada lliure** perquè les taules es puguin expandir i desplaçar horitzontalment. Els paràgrafs mantenen una amplada llegible. La preferència es recorda per pàgina en aquest dispositiu i no modifica el Markdown. Torna a desactivar-la al mateix menú per recuperar la visualització habitual.

### Cercar notes completes i reutilitzar contingut

La cerca global troba paraules a qualsevol part d'una nota i en mostra un
fragment. Pots escriure `"frase exacta"`, `(vermell OR blau) -verd`,
`tag:recerca`, `content:"memòria de treball"`, `task-todo:revisar` o
`[estat:Esborrany]`. `line:(guineu vermella)`, `block:(guineu vermella)` i
`section:(guineu vermella)` exigeixen que les paraules siguin a la mateixa
línia, bloc o secció. Una consulta incorrecta mostra un error per poder-la
corregir. El bloc **Resultats de cerca**, o un bloc de codi Markdown amb llenguatge
`query`, manté resultats de cerca vius dins d'una nota.

Escriu `![[Notes de la font]]` per mostrar-ne tot el contingut amb format.
`![[Notes de la font#Encapçalament]]` i `![[Notes de la font#^id-bloc]]`
incrusten una part concreta. S'hi mostren taules, codi i notes imbricades; les
referències circulars s'aturen amb una explicació. La font continua sent una
nota independent i la transclusió s'actualitza després dels canvis.

L'editor de font Markdown incorpora ressaltat, múltiples cursors, mode Vim i
previsualització. Configura les dreceres als paràmetres i desa temes o fragments
CSS a Aparença. Si un fragment dificulta l'ús de la interfície, obre Gnosi amb
`?gnosi-safe-appearance=1` i restableix l'aparença.

### Combina notes i desa accessos

Al menú **⋯** d’una nota, tria **Combina i extreu notes**. Selecciona la nota completa, un encapçalament o línies Markdown completes i tria una nota nova o una destinació existent. **Previsualitza els canvis** mostra l’origen, la destinació i els enllaços afectats. Revisa tots els canvis abans d’aplicar-los. L’origen conserva una transclusió i l’historial. Si un altre editor modifica un fitxer, prepara una previsualització nova.

A **Marcadors** de la barra lateral, desa notes, seccions, cerques, vistes de graf o enllaços web i assigna’ls un grup. L’estrella d’una nota l’afegeix o la treu d’aquesta mateixa llista. Els antics favorits i els marcadors d’aquest dispositiu s’importen automàticament, conservant els noms propis i els grups. Els marcadors pertanyen al compte, l’espai de treball i el Vault seleccionats. Se sincronitzen mitjançant el mateix servidor Gnosi o quan la carpeta del mateix Vault se sincronitza entre dispositius. Els canvis s’actualitzen periòdicament i en tornar a l’aplicació; prem Actualitza per comprovar-los immediatament. Si la sincronització falla, es conserven els elements desats i els canvis en edició perquè ho puguis tornar a provar.

Fes servir **Desa la vista actual** per afegir una taula, una vista desada, un dibuix o una altra vista estable de Gnosi. Les adreces de les vistes es desen en relació amb el Vault perquè cada dispositiu pugui fer servir la seva adreça local. Els taulells, registres i plantilles fan servir el mateix tipus de marcador de pàgina; el catàleg de Taulells continua disponible.

## Resultat esperat {#expected-result}

La nota conté text llegible, un enllaç i un adjunt accessible.

## Si alguna cosa falla {#troubleshooting}

Si apareix un conflicte de desament, conserva el text pendent i compara’l amb la versió més recent abans de tornar-ho a provar. Si falta un adjunt, comprova l’original i el Vault actiu; una miniatura no és una còpia de seguretat.

## Guies relacionades {#related-guides}

- [Captura fonts, llegeix i cita](reading-references.md)
- [Organitza registres i planifica la feina](databases-planning.md)
