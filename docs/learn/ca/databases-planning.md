# Organitza registres i planifica la feina

Una base de dades agrupa taules. Una taula defineix propietats dels registres, que són pàgines; les vistes mostren els mateixos registres de maneres diferents.

## Abans de començar {#before-you-begin}

Un Vault amb escriptura. Les vistes generals formen part del coneixement; la programació avançada de projectes requereix Planificació.

## Passos {#steps}

1. A Coneixement, tria **Crea una BD** o **Afegeix una base de dades** i anomena-la “Projecte de lectura”. Dins seu crea la taula “Fonts”: crear el grup no crea una taula.

2. Afegeix propietats com estat i data. Utilitza estats coherents, per exemple “Per llegir”, “En lectura” i “Llegit”.

3. Crea dos registres i omple’n les propietats. Desplega **Contingut** sota la taula per obrir les pàgines i **Vistes** per trobar les vistes desades.

4. Crea una vista filtrada de fonts pendents. Tria un tauler o un calendari quan les propietats d’estat o data ho permetin i comprova els registres que coincideixen amb el filtre.

5. Per programar tasques, activa Planificació i configura setmana laboral i festius. Prova inici, durada i dependències en un exemple petit abans d’aplicar-ho a un projecte real.

6. Consulta l’ajuda al costat de la restricció de data per entendre la regla seleccionada. Comprova la data final calculada segons els dies laborables.

Per llegir les notes seguides, obre la configuració de la galeria i tria **Mida de les targetes → Ample complet** i **Previsualització → Contingut**. Les targetes ocupen tot l’ample de la vista, queden una sota l’altra i creixen segons el text. En una galeria agrupada, **Espai** desplega el grup enfocat i entra a la primera nota; **Esc** des d’una nota torna a la capçalera del grup i el plega. Un segon **Esc** torna a la vista. El clic a la capçalera continua plegant i desplegant el grup.

Al **cronograma**, tria **Dia**, **Setmana** o **Mes**, **Any**, **Avui** o **Enquadra el projecte**. Pots ajustar l’amplada dels títols i plegar les fases. Amb un període o camps d’inici i final editables, arrossega el cos d’una barra per moure la tasca i els extrems per allargar-la o escurçar-la. Arrossega el punt de connexió del final d’una tasca fins a la barra d’una successora per afegir una dependència de final a inici. Els canvis es desen als registres compartits amb la taula; les successores afectades es recalculen, encara que estiguin ocultes pels filtres. Els cicles es rebutgen. **Desfés el canvi del cronograma** restaura l’última operació durant la sessió de la vista. **Esc** cancel·la un arrossegament. Amb una barra enfocada, les fletxes la mouen i **Majúscules + fletxa** ajusta el final. Els registres sense dates mostren **Defineix les dates**; les fites tenen forma de rombe.

## Resultat esperat {#expected-result}

Pots consultar els registres en diferents vistes i explicar la data calculada d’una tasca.

## Si alguna cosa falla {#troubleshooting}

Una vista buida pot tenir un filtre massa restrictiu. Revisa dates, estats i dependències abans de recrear registres. Les dates de creació i modificació les manté Gnosi i no són dates de planificació editables.

## Guies relacionades {#related-guides}

- [Crea pàgines, enllaços i adjunts](pages-files.md)
- [Activa complements, connecta serveis i automatitza](integrations-automations.md)
