# Prepara multimèdia i publica contingut

El centre multimèdia conserva recursos reutilitzables. La publicació social prepara i envia contingut a les xarxes configurades.

## Abans de començar {#before-you-begin}

Activa Publicació social i connecta la xarxa de destinació amb permisos de publicació. Aprèn amb un esborrany de prova.

## Passos {#steps}

1. Obre Multimèdia, afegeix una imatge que puguis utilitzar i revisa’n les metadades. Obre l’original per comprovar qualitat i disponibilitat.

2. Obre el compositor social i selecciona xarxa i compte. Escriu un esborrany i adjunta el recurs.

3. Revisa la previsualització de cada destinació, incloent-hi límits de text i fitxers. Adapta el contingut si els requisits difereixen.

4. Tria publicació immediata o una programació explícita. Comprova destinació, dia i hora abans de confirmar; preparar no publica.

5. Després de l’execució, obre l’historial i comprova el resultat de cada xarxa i l’enllaç remot.

6. Si falla una destinació, inspecciona’n el resultat abans de reintentar. Exclou les destinacions correctes del reintent per evitar duplicats.

## Resultat esperat {#expected-result}

L’esborrany té una destinació comprovada i, un cop publicat, un resultat verificable per xarxa.

## Si alguna cosa falla {#troubleshooting}

Les credencials caducades i els límits del proveïdor poden bloquejar la publicació. Una miniatura no recupera l’original. La programació depèn que el complement, el compte i el servei continuïn disponibles.

## Guies relacionades {#related-guides}

- [Activa complements, connecta serveis i automatitza](integrations-automations.md)
- [Preguntes freqüents i recuperació](troubleshooting.md)

## Publicar un web

Activa **Webs**, obre’l des de la barra lateral i crea o selecciona un web. Tria les taules i les pàgines d’origen i configura la navegació i l’aparença. Puja un logotip, una icona de pestanya o una tipografia amb els controls d’aparença. Només els recursos seleccionats s’inclouen al web publicat; pujar un fitxer no el publica. Les tipografies del sistema depenen del dispositiu del visitant.

La configuració es desa automàticament. Comprova l’estat del desament abans de revisar i publicar a la destinació seleccionada. La publicació és una acció explícita. Si el desament falla, conserva l’esborrany i torna-ho a provar abans de publicar. Les credencials dels serveis privats i els esborranys de butlletins estan separats del web públic; enviar una campanya requereix una revisió i una acció explícita pròpies.

### Revisió, historial de versions i butlletins de prova

A Continguts, tria una font abans d’afegir-la; selecciona explícitament els camps públics, el cos i els adjunts. Fes servir Pàgines per al contingut manual i Navegació per als menús.

La configuració es desa automàticament. Comprova l’estat de desament i resol els errors abans de sortir. Revisa una instantània, els canvis i la previsualització d’escriptori i mòbil abans de publicar la versió revisada. Els canvis de fonts o configuració requereixen una nova revisió. Comprova el resultat de la tasca i l’historial de versions; la reversió restaura una versió del web, mentre que els missatges, els subscriptors i les campanyes es mantenen separats.

A Butlletins, tria la destinació i l’idioma i afegeix continguts ja publicats a un esborrany de resum o lectura destacada. La llista mostra primer els continguts més nous. Ordena fins a vint pàgines úniques, afegeix una introducció i revisa l’HTML, el text pla i els destinataris abans de posar explícitament una prova a la cua. Els esborranys es desen automàticament per web i destinació; els canvis de publicació o d’esborrany requereixen una nova revisió. Pots llegir els correus de prova capturats des de la cua d’enviament; llegir-los no activa els enllaços de confirmació o baixa. Fes servir els controls explícits de prova d’enllaços quan calgui.

El pilot actual només permet publicar a l’espai de proves protegit i capturar correus per a destinataris sintètics. La publicació a producció i l’enviament real estan desactivats. Cada destinació també necessita les dependències de generació del web i del servei privat; comprova’n la connexió abans de publicar. Si el resultat d’una acció és incert, actualitza’n l’estat abans de reintentar-la.

### Importar un web i configurar-ne la connexió

A **Crear web**, tria un web buit o la importació per URL. Indica l’adreça pública, analitza-la i revisa les pàgines, els idiomes i els avisos abans d’importar la selecció. Es creen pàgines editables sense publicar-les. Els formularis i serveis originals del servidor no es migren automàticament.

A **Allotjament**, configura el servidor, port, usuari, carpetes i autenticació amb agent SSH, clau del dispositiu o contrasenya. Pots transferir els fitxers per SSH o SFTP; la contrasenya es desa només al gestor de credencials del dispositiu. Comprova la connexió: publicar amb el servei privat també requereix ordres SSH, PHP i SQLite. Una connexió només SFTP pot quedar verificada sense disposar d’aquests requisits de publicació.

A **Formularis de contacte**, afegeix, ordena o elimina camps i edita els textos per idioma, inclosos consentiments, errors i confirmació. Deixa els textos opcionals buits per conservar els valors predeterminats. Revisa el resultat abans de publicar.

La previsualització dels registres evita tornar a generar repetidament el mateix web. Cada previsualització nova llegeix les notes actuals i torna a comprovar el registre després de generar-la. Si canvia durant la revisió, torna a revisar-lo. Preparar o reobrir una previsualització no publica ni canvia el contingut seleccionat.

Per als adjunts descarregats que no han canviat, la previsualització reutilitza una còpia local comprovada. Les notes es tornen a llegir. Si un fitxer al núvol no es pot llegir a temps, la revisió s’atura: descarrega’l i torna-ho a provar. La confirmació torna a comprovar els originals abans de publicar.
